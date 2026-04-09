const electronModule = require('electron')
const fs = require('fs').promises
const path = require('path')

const { ipcMain, dialog, app } = electronModule

let registered = false

function defaultExportPath() {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(app.getPath('documents'), `syntax-senpai-export-${date}.json`)
}

export function registerExportIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('export:openJson', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import SyntaxSenpai data',
        buttonLabel: 'Import',
        filters: [
          { name: 'JSON', extensions: ['json'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || !result.filePaths?.[0]) {
        return { success: false, canceled: true }
      }

      const filePath = result.filePaths[0]
      const raw = await fs.readFile(filePath, 'utf-8')
      return {
        success: true,
        filePath,
        payload: JSON.parse(raw),
      }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('export:saveJson', async (_event: any, payload: unknown, suggestedFileName?: string) => {
    try {
      const defaultPath = suggestedFileName
        ? path.join(app.getPath('documents'), suggestedFileName)
        : defaultExportPath()

      const result = await dialog.showSaveDialog({
        title: 'Export SyntaxSenpai data',
        defaultPath,
        buttonLabel: 'Save Export',
        filters: [
          { name: 'JSON', extensions: ['json'] },
        ],
        showOverwriteConfirmation: true,
      })

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true }
      }

      const json = JSON.stringify(payload, null, 2)
      await fs.writeFile(result.filePath, `${json}\n`, 'utf-8')

      return {
        success: true,
        filePath: result.filePath,
      }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

module.exports = { registerExportIpc }

export {}
