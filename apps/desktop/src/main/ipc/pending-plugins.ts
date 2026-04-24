/**
 * Pending-plugins IPC — AI-authored tool proposals awaiting user approval.
 *
 * The waifu uses the `propose_tool` agent tool to write a plugin bundle
 * to `<userData>/pending-plugins/<slug>/`. She CANNOT activate it; the
 * user must open Settings → Plugins → Pending and explicitly approve,
 * which moves the bundle to the active plugins directory. Takes effect
 * after restart — same UX contract as the existing plugins system.
 */

const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')

import { mainLogger } from '../logger'

const { ipcMain, app } = electronModule

let registered = false

function pendingDir(): string {
  return path.join(app.getPath('userData'), 'pending-plugins')
}

function activePluginsDir(): string {
  // Same precedence as ipc/plugins.ts::resolvePluginDir — for approvals,
  // we always target userData/plugins so repo-local plugins aren't
  // mutated by the app.
  return path.join(app.getPath('userData'), 'plugins')
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i

function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= 64 && SLUG_RE.test(slug)
}

export interface PendingPluginSummary {
  slug: string
  name: string
  version: string
  description?: string
  manifest: any
  code: string
  createdAt: string
}

function readPending(slug: string): PendingPluginSummary | null {
  if (!isValidSlug(slug)) return null
  const dir = path.join(pendingDir(), slug)
  const manifestPath = path.join(dir, 'plugin.json')
  const codePath = path.join(dir, 'index.js')
  if (!fs.existsSync(manifestPath) || !fs.existsSync(codePath)) return null
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const code = fs.readFileSync(codePath, 'utf8')
    const stat = fs.statSync(manifestPath)
    return {
      slug,
      name: String(manifest.name || slug),
      version: String(manifest.version || '0.0.0'),
      description: manifest.description,
      manifest,
      code,
      createdAt: stat.birthtime.toISOString(),
    }
  } catch {
    return null
  }
}

export function registerPendingPluginsIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('pending-plugins:list', async () => {
    try {
      const dir = pendingDir()
      if (!fs.existsSync(dir)) return { success: true, directory: dir, pending: [] }
      const pending: PendingPluginSummary[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const summary = readPending(entry.name)
        if (summary) pending.push(summary)
      }
      return { success: true, directory: dir, pending }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  // Called by the propose_tool agent tool. Validates inputs, writes the
  // pending bundle atomically, and returns the written paths.
  ipcMain.handle(
    'pending-plugins:write',
    async (
      _e: any,
      payload: {
        slug: string
        name: string
        version?: string
        description?: string
        code: string
      },
    ) => {
      try {
        const { slug, name, version = '0.1.0', description, code } = payload || ({} as any)
        if (!isValidSlug(slug)) {
          return { success: false, error: 'slug must be a-z, 0-9, _ or - (<= 64 chars, no traversal)' }
        }
        if (typeof name !== 'string' || !name.trim()) return { success: false, error: 'name is required' }
        if (typeof code !== 'string' || !code.trim()) return { success: false, error: 'code is required' }
        if (code.length > 64 * 1024) return { success: false, error: 'code exceeds 64 KB limit' }

        const dir = path.join(pendingDir(), slug)
        fs.mkdirSync(dir, { recursive: true })

        const manifest = {
          name,
          version: String(version),
          description: typeof description === 'string' ? description : undefined,
          main: 'index.js',
          enabled: true,
          // Mark as AI-authored so the UI can surface a clear "review
          // this code before approving" warning — matches the gate
          // already described in propose_tool's tool description.
          aiAuthored: true,
        }

        const manifestPath = path.join(dir, 'plugin.json')
        const codePath = path.join(dir, 'index.js')

        const manifestTmp = manifestPath + '.tmp'
        const codeTmp = codePath + '.tmp'
        fs.writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2), 'utf8')
        fs.renameSync(manifestTmp, manifestPath)
        fs.writeFileSync(codeTmp, code, 'utf8')
        fs.renameSync(codeTmp, codePath)

        mainLogger.info({ slug, name, bytes: code.length }, 'pending plugin written')
        return { success: true, slug, manifestPath, codePath }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    },
  )

  ipcMain.handle('pending-plugins:approve', async (_e: any, slug: string) => {
    try {
      if (!isValidSlug(slug)) return { success: false, error: 'Invalid slug' }
      const srcDir = path.join(pendingDir(), slug)
      if (!fs.existsSync(srcDir)) return { success: false, error: 'No pending plugin with that slug' }
      const dstRoot = activePluginsDir()
      fs.mkdirSync(dstRoot, { recursive: true })
      const dstDir = path.join(dstRoot, slug)
      if (fs.existsSync(dstDir)) {
        return { success: false, error: `A plugin named ${slug} is already installed — remove it first` }
      }
      fs.cpSync(srcDir, dstDir, { recursive: true })
      fs.rmSync(srcDir, { recursive: true, force: true })
      mainLogger.info({ slug, dst: dstDir }, 'pending plugin approved')
      return { success: true, slug, installedTo: dstDir }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('pending-plugins:reject', async (_e: any, slug: string) => {
    try {
      if (!isValidSlug(slug)) return { success: false, error: 'Invalid slug' }
      const dir = path.join(pendingDir(), slug)
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
      mainLogger.info({ slug }, 'pending plugin rejected')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}

module.exports = { registerPendingPluginsIpc }

export {}
