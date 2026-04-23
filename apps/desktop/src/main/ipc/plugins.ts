const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')

import { ToolRegistry, loadToolPlugins } from '@syntax-senpai/agent-tools'
import type { ToolExecutionContext } from '@syntax-senpai/agent-tools'
import { mainLogger } from '../logger'

const { ipcMain, app } = electronModule

const DISABLED_STORAGE_KEY = 'syntax-senpai-disabled-plugins'

let registered = false

// Module-level registry: populated once at IPC-register time by
// initPluginRegistry(). Kept in main so plugins run with full Node
// privileges (fetch, child_process if they need it) and the renderer
// only sees their ToolDefinitions + execution results.
const pluginRegistry = new ToolRegistry()
let pluginRegistryInitialized = false

/**
 * Broadly-permissive execution context. Plugins are user-installed
 * and the user can toggle any of them off in Settings; gating each
 * call per-permission would be security theater without a meaningful
 * UI to grant/revoke permissions per-plugin.
 */
function buildPluginExecContext(): ToolExecutionContext {
  return {
    platform: 'desktop',
    userId: 'local-user',
    waifuId: '',
    permissions: {
      fileRead: true,
      fileWrite: true,
      shellExec: true,
      networkAccess: true,
    },
  }
}

/**
 * Resolve the plugins directory. Precedence:
 *   1. env SYNTAX_SENPAI_PLUGIN_DIR
 *   2. repo-local plugins/ (dev)
 *   3. <userData>/plugins/ (packaged app)
 */
function resolvePluginDir(): string {
  if (process.env.SYNTAX_SENPAI_PLUGIN_DIR) return process.env.SYNTAX_SENPAI_PLUGIN_DIR
  // dev: two levels up from apps/desktop
  const repoLocal = path.resolve(__dirname, '..', '..', '..', '..', '..', 'plugins')
  if (fs.existsSync(repoLocal)) return repoLocal
  try {
    return path.join(app.getPath('userData'), 'plugins')
  } catch {
    return path.resolve(process.cwd(), 'plugins')
  }
}

interface DesktopPluginManifest {
  name: string
  version: string
  description?: string
  main: string
  enabled: boolean
  directory: string
  error?: string
  disabled?: boolean
}

function readDisabledList(): string[] {
  const file = path.join(app.getPath('userData'), `${DISABLED_STORAGE_KEY}.json`)
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeDisabledList(names: string[]) {
  const file = path.join(app.getPath('userData'), `${DISABLED_STORAGE_KEY}.json`)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(names), 'utf8')
  } catch {
    /* best effort */
  }
}

function listPluginManifests(pluginDir: string): DesktopPluginManifest[] {
  if (!fs.existsSync(pluginDir)) return []
  const disabled = new Set(readDisabledList())
  const manifests: DesktopPluginManifest[] = []
  for (const entry of fs.readdirSync(pluginDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(pluginDir, entry.name)
    const manifestPath = path.join(dir, 'plugin.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      manifests.push({
        name: String(manifest.name || entry.name),
        version: String(manifest.version || '0.0.0'),
        description: manifest.description,
        main: String(manifest.main || 'index.js'),
        enabled: manifest.enabled !== false,
        directory: dir,
        disabled: disabled.has(manifest.name || entry.name)
      })
    } catch (error) {
      manifests.push({
        name: entry.name,
        version: '0.0.0',
        main: 'index.js',
        enabled: false,
        directory: dir,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return manifests
}

/**
 * Load every plugin manifest in the plugins directory once and activate
 * the ones the user hasn't disabled. Tools land in pluginRegistry and
 * are exposed through plugins:listTools / plugins:execTool. Toggling a
 * plugin in Settings persists the disabled list but won't re-load until
 * the next launch — matches the "restart to apply" UX the Settings tab
 * already advertises.
 */
async function initPluginRegistry() {
  if (pluginRegistryInitialized) return
  pluginRegistryInitialized = true
  try {
    const pluginDir = resolvePluginDir()
    const disabled = new Set(readDisabledList())
    const loaded = await loadToolPlugins({
      directory: pluginDir,
      registry: pluginRegistry,
      logger: {
        info: (msg: string) => mainLogger.info({ pluginDir }, msg),
        warn: (msg: string) => mainLogger.warn({ pluginDir }, msg),
        error: (msg: string) => mainLogger.error({ pluginDir }, msg),
      },
      isDisabled: (name: string) => disabled.has(name),
    })
    mainLogger.info(
      { count: loaded.length, tools: pluginRegistry.getAll().map((t) => t.definition.name) },
      'plugins initialized',
    )
  } catch (err: any) {
    mainLogger.error({ err: err?.message || String(err) }, 'plugin init failed')
  }
}

export function registerPluginsIpc() {
  if (registered) return
  registered = true

  // Kick off plugin load in the background — the renderer can still
  // call plugins:list (which only reads manifests) before tools are
  // ready, and plugins:listTools will simply return [] until the load
  // promise resolves. First sendMessage happens well after activation.
  initPluginRegistry()

  ipcMain.handle('plugins:list', () => {
    try {
      const pluginDir = resolvePluginDir()
      const manifests = listPluginManifests(pluginDir)
      return { success: true, pluginDir, plugins: manifests }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('plugins:setDisabled', (_e: any, name: string, disabled: boolean) => {
    try {
      if (typeof name !== 'string' || !name) {
        return { success: false, error: 'Plugin name is required' }
      }
      const current = new Set(readDisabledList())
      if (disabled) current.add(name)
      else current.delete(name)
      writeDisabledList(Array.from(current))
      return { success: true, disabled }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('plugins:listTools', () => {
    try {
      return { success: true, tools: pluginRegistry.getDefinitions() }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle(
    'plugins:execTool',
    async (_e: any, toolName: string, toolArgs: Record<string, unknown>) => {
      try {
        if (typeof toolName !== 'string' || !toolName) {
          return { success: false, error: 'Tool name is required' }
        }
        const result = await pluginRegistry.execute(
          {
            id: `plugin-call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: toolName,
            arguments: toolArgs || {},
          },
          buildPluginExecContext(),
        )
        return result
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    },
  )
}

module.exports = { registerPluginsIpc }

export {}
