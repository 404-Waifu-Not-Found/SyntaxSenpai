const { ipcMain } = require('electron')
let keytar: any
try {
  keytar = require('keytar')
} catch (err: any) {
  console.warn('keytar not available in this environment:', err && err.message)
  keytar = null
}

const SERVICE = 'syntax-senpai-keys'
let registered = false

export function registerKeystoreIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('keystore:set', async (event: any, provider: string, key: string) => {
    try {
      if (!keytar) throw new Error('keytar not available')
      await keytar.setPassword(SERVICE, provider, key)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('keystore:get', async (event: any, provider: string) => {
    try {
      if (!keytar) throw new Error('keytar not available')
      const k = await keytar.getPassword(SERVICE, provider)
      return { success: true, key: k }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('keystore:delete', async (event: any, provider: string) => {
    try {
      if (!keytar) throw new Error('keytar not available')
      const deleted = await keytar.deletePassword(SERVICE, provider)
      return { success: true, deleted }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

module.exports = { registerKeystoreIpc }

export {}
