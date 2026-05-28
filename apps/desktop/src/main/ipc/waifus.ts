const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

import {
  copyDirRecursive,
  deepMergePlainObjects,
  ensureDir,
  extractZipSafely,
  findLive2DModelJson,
  slugifyModelName,
} from '@syntax-senpai/agent-tools'
import {
  copyCubismCoreInto,
  downloadCubismCore,
  ensureCubismCore,
  getCubismCoreStatus,
} from '../live2d-sdk'

const { ipcMain, app, dialog } = electronModule

let registered = false

function waifuDir(): string {
  return path.join(app.getPath('userData'), 'waifus')
}

function live2dDir(): string {
  return path.join(app.getPath('userData'), 'live2d-models')
}

/**
 * Find a safe filename for a waifu id. We only allow slug-like ids so
 * the filename is just `<id>.json`, but we still guard against path
 * traversal defensively.
 */
function waifuFilePath(id: string): string {
  if (!/^[a-z0-9_-]+$/i.test(id)) {
    throw new Error(`Invalid waifu id: ${id}`)
  }
  return path.join(waifuDir(), `${id}.json`)
}

function writeWaifuFileAtomic(id: string, payload: any) {
  ensureDir(waifuDir())
  const filePath = waifuFilePath(id)
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
  return filePath
}

function readWaifuFile(id: string): Record<string, unknown> | null {
  const filePath = waifuFilePath(id)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function registerWaifusIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('waifus:list', async () => {
    try {
      const dir = waifuDir()
      ensureDir(dir)
      const files = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e: any) => e.isFile() && e.name.endsWith('.json'))
        .map((e: any) => e.name)
      const waifus: any[] = []
      const errors: Array<{ file: string; reason: string }> = []
      for (const name of files) {
        const full = path.join(dir, name)
        try {
          const raw = JSON.parse(fs.readFileSync(full, 'utf8'))
          waifus.push({ ...raw, isBuiltIn: false })
        } catch (err: any) {
          errors.push({ file: name, reason: err?.message || String(err) })
        }
      }
      return { success: true, directory: dir, waifus, errors }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('waifus:write', async (_e: any, waifu: any) => {
    try {
      if (!waifu || typeof waifu !== 'object' || typeof waifu.id !== 'string') {
        return { success: false, error: 'Waifu payload is missing a valid id' }
      }
      const filePath = writeWaifuFileAtomic(waifu.id, { ...waifu, isBuiltIn: false })
      return { success: true, filePath }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  /**
   * Partial update of a waifu.
   *
   * Used by the Live2D assign / remove flow (renderer sends `{ id, avatar: {...} }`)
   * and by anything else that wants to patch fields without rebuilding the full
   * waifu payload.
   *
   * Built-in waifus live in code (no on-disk file). For them, this handler
   * creates a sparse shadow file in `<userData>/waifus/<id>.json` carrying just
   * the patched fields; the renderer's `allWaifus` merges that shadow on top
   * of the built-in defaults so the override is visible.
   */
  ipcMain.handle('waifus:update', async (_e: any, partial: any) => {
    try {
      if (!partial || typeof partial !== 'object' || typeof partial.id !== 'string') {
        return { success: false, error: 'Update payload is missing a valid id' }
      }
      const existing = readWaifuFile(partial.id) ?? { id: partial.id, isBuiltIn: false }
      const merged = deepMergePlainObjects(existing, { ...partial, isBuiltIn: false })
      const filePath = writeWaifuFileAtomic(partial.id, merged)
      return { success: true, filePath, waifu: merged }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('waifus:delete', async (_e: any, id: string) => {
    try {
      const filePath = waifuFilePath(id)
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  // Live2D model management

  ipcMain.handle('waifus:importLive2DModel', async () => {
    let tempDir: string | null = null
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Live2D model file or zip',
        buttonLabel: 'Import',
        filters: [
          { name: 'Live2D Model (folder file or .zip)', extensions: ['zip', 'model3.json', 'model.json', 'json'] },
          { name: 'Zip archive', extensions: ['zip'] },
          { name: 'Live2D model JSON', extensions: ['json'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths.length) {
        return { success: false, canceled: true }
      }

      const pickedPath = result.filePaths[0]
      const isZip = pickedPath.toLowerCase().endsWith('.zip')

      let modelJsonPath: string
      let modelDir: string
      let modelName: string

      if (isZip) {
        const t = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-senpai-live2d-'))
        tempDir = t
        extractZipSafely(pickedPath, t)
        const found = findLive2DModelJson(t)
        if (!found) {
          return { success: false, error: 'No .model3.json (or .model.json) found inside the zip' }
        }
        modelJsonPath = found
        modelDir = path.dirname(modelJsonPath)
        // Prefer the zip filename for the slug — stable across re-imports
        // and unaffected by which subfolder the .model3.json sits in.
        modelName = path.basename(pickedPath, path.extname(pickedPath))
      } else {
        modelJsonPath = pickedPath
        modelDir = path.dirname(modelJsonPath)
        modelName = path.basename(modelDir)

        // Guard: make sure the selected file is inside modelDir (no traversal)
        const resolved = path.resolve(modelJsonPath)
        if (!resolved.startsWith(path.resolve(modelDir))) {
          return { success: false, error: 'Invalid model path' }
        }
      }

      const slug = slugifyModelName(modelName)
      if (!slug) {
        return { success: false, error: 'Could not derive a valid name for this model' }
      }
      const destDir = path.join(live2dDir(), slug)

      // If a model with this slug already exists, replace it so re-imports work cleanly.
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
      }

      copyDirRecursive(modelDir, destDir)

      // Best-effort: make sure the Cubism Core JS exists in the shared
      // <userData>/live2d-sdk cache, then mirror it into the model folder
      // so the per-model URL the renderer derives also resolves. Failures
      // are non-fatal — the renderer falls back to the shared location.
      try {
        await ensureCubismCore(app.getPath('userData'))
        copyCubismCoreInto(app.getPath('userData'), destDir)
      } catch {
        /* offline first-import is OK — UI offers a manual install button */
      }

      const destModelJson = path.join(destDir, path.basename(modelJsonPath))
      // Return a userdata:// URL so the renderer can fetch it in both dev
      // and production without running into file:// CORS restrictions.
      const relPath = path.relative(app.getPath('userData'), destModelJson).replace(/\\/g, '/')
      const modelJsonUrl = `userdata://${relPath}`
      return { success: true, slug, displayName: modelName, modelJsonPath: modelJsonUrl }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    } finally {
      if (tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true })
        } catch {
          // best effort — temp dirs get cleaned by the OS anyway
        }
      }
    }
  })

  ipcMain.handle('waifus:listLive2DModels', async () => {
    try {
      const dir = live2dDir()
      ensureDir(dir)
      const models: Array<{ slug: string; displayName: string; modelJsonPath: string }> = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const modelDir = path.join(dir, entry.name)
        // Find the .model3.json or .model.json inside
        const files = fs.readdirSync(modelDir) as string[]
        const jsonFile = files.find((f: string) => f.endsWith('.model3.json') || f.endsWith('.model.json'))
        if (jsonFile) {
          const absPath = path.join(modelDir, jsonFile)
          const relPath = path.relative(app.getPath('userData'), absPath).replace(/\\/g, '/')
          models.push({
            slug: entry.name,
            displayName: entry.name,
            modelJsonPath: `userdata://${relPath}`,
          })
        }
      }
      return { success: true, models }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('waifus:deleteLive2DModel', async (_e: any, slug: string) => {
    try {
      if (!/^[a-z0-9_-]+$/i.test(slug)) {
        return { success: false, error: 'Invalid slug' }
      }
      const modelDir = path.join(live2dDir(), slug)
      if (fs.existsSync(modelDir)) {
        fs.rmSync(modelDir, { recursive: true, force: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  // Cubism Core SDK lifecycle (download + status)

  ipcMain.handle('waifus:getCubismCoreStatus', async () => {
    try {
      return { success: true, ...getCubismCoreStatus(app.getPath('userData')) }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('waifus:installCubismCore', async (_e: any, opts: any) => {
    try {
      const userData = app.getPath('userData')
      const force = Boolean(opts && opts.force)
      const result = force
        ? await downloadCubismCore(userData)
        : await ensureCubismCore(userData)
      if (!result.success) {
        return { success: false, error: result.error || 'Cubism Core install failed' }
      }
      // Backfill the SDK file into every already-imported model so existing
      // models stop showing the "Cubism Core not found" error after an install.
      try {
        const modelsRoot = live2dDir()
        if (fs.existsSync(modelsRoot)) {
          for (const entry of fs.readdirSync(modelsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            copyCubismCoreInto(userData, path.join(modelsRoot, entry.name))
          }
        }
      } catch {
        /* best effort */
      }
      return {
        success: true,
        path: result.path,
        size: result.size,
        fromCache: result.fromCache ?? false,
      }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}

module.exports = { registerWaifusIpc }

export {}
