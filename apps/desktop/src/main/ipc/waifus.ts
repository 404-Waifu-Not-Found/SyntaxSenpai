const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const { ipcMain, app } = electronModule

let registered = false

function waifuDir(): string {
  return path.join(app.getPath('userData'), 'waifus')
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Find a safe filename for a waifu id. We only allow slug-like ids so
 * the filename is just `<id>.json` — but we still guard against path
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
}

module.exports = { registerWaifusIpc }

export {}
