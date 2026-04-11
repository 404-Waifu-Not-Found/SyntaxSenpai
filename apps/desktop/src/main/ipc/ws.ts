const { ipcMain } = require('electron')
import { startWsServer, stopWsServer, getQrData, getPairingStatus, setDesktopRuntimeConfig } from '../ws-server'

let registered = false

export function registerWsIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('ws:start', async () => {
    try {
      const data = await startWsServer()
      return { success: true, ...data }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('ws:stop', async () => {
    try {
      stopWsServer()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('ws:getQrData', async () => {
    try {
      const data = await getQrData()
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('ws:getPairingStatus', async () => {
    try {
      const status = getPairingStatus()
      return { success: true, ...status }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('ws:updateRuntimeConfig', async (_event: unknown, config: { provider: string; model: string; apiKey?: string } | null) => {
    try {
      setDesktopRuntimeConfig(config)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

module.exports = { registerWsIpc }

export {}
