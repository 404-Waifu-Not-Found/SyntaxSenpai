const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const { ipcMain, app, dialog } = electronModule

let registered = false

function waifuDir(): string {
  return path.join(app.getPath('userData'), 'waifus')
}

function live2dDir(): string {
  return path.join(app.getPath('userData'), 'live2d-models')
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function copyDirRecursive(src: string, dest: string) {
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
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
      ensureDir(waifuDir())
      const filePath = waifuFilePath(waifu.id)
      const tmp = filePath + '.tmp'
      const payload = JSON.stringify({ ...waifu, isBuiltIn: false }, null, 2)
      fs.writeFileSync(tmp, payload, 'utf8')
      fs.renameSync(tmp, filePath)
      return { success: true, filePath }
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
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Live2D model file',
        buttonLabel: 'Import',
        filters: [
          { name: 'Live2D Model', extensions: ['model3.json', 'model.json', 'json'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths.length) {
        return { success: false, canceled: true }
      }

      const modelJsonPath = result.filePaths[0]
      const modelDir = path.dirname(modelJsonPath)
      const modelName = path.basename(modelDir)

      // Slug: keep only safe characters
      const slug = modelName.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
      const destDir = path.join(live2dDir(), slug)

      // Guard: make sure the selected file is inside modelDir (no traversal)
      const resolved = path.resolve(modelJsonPath)
      if (!resolved.startsWith(path.resolve(modelDir))) {
        return { success: false, error: 'Invalid model path' }
      }

      copyDirRecursive(modelDir, destDir)

      const destModelJson = path.join(destDir, path.basename(modelJsonPath))
      // Return a userdata:// URL so the renderer can fetch it in both dev
      // and production without running into file:// CORS restrictions.
      const relPath = path.relative(app.getPath('userData'), destModelJson).replace(/\\/g, '/')
      const modelJsonUrl = `userdata://${relPath}`
      return { success: true, slug, displayName: modelName, modelJsonPath: modelJsonUrl }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
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
}

module.exports = { registerWaifusIpc }

export {}
