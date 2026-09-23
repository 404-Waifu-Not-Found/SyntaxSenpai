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

/** Read provider credentials in the main process without returning them to the renderer. */
export async function getStoredApiKey(provider: string): Promise<string | null> {
  if (!keytar || typeof keytar.getPassword !== 'function') throw new Error('Secure key storage is unavailable.')
  return keytar.getPassword(SERVICE, provider)
}

export async function exportStoredApiKeys(): Promise<Record<string, string>> {
  if (!keytar || typeof keytar.findCredentials !== 'function') return {}
  const credentials = await keytar.findCredentials(SERVICE)
  return Object.fromEntries(
    (Array.isArray(credentials) ? credentials : [])
      .filter((entry: any) => typeof entry?.account === 'string' && typeof entry?.password === 'string')
      .map((entry: any) => [entry.account, entry.password]),
  )
}

export async function importStoredApiKeys(keys: unknown): Promise<{ imported: string[]; skipped: string[] }> {
  if (!keytar) throw new Error('keytar not available')
  const imported: string[] = []
  const skipped: string[] = []
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return { imported, skipped }

  for (const [provider, secret] of Object.entries(keys as Record<string, unknown>)) {
    if (!/^[a-z0-9._-]{1,80}$/i.test(provider) || typeof secret !== 'string' || !secret) {
      skipped.push(provider)
      continue
    }
    await keytar.setPassword(SERVICE, provider, secret)
    imported.push(provider)
  }
  return { imported, skipped }
}

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

  ipcMain.handle('keystore:export', async () => {
    try {
      return { success: true, keys: await exportStoredApiKeys() }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

module.exports = { registerKeystoreIpc, getStoredApiKey }

export {}
