const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const { ipcMain, app } = electronModule

const DISABLED_STORAGE_KEY = 'syntax-senpai-disabled-plugins'

let registered = false

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

export function registerPluginsIpc() {
  if (registered) return
  registered = true

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
}

module.exports = { registerPluginsIpc }

export {}
