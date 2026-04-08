import { useIpc } from './use-ipc'

const SERVICE = 'syntax-senpai-keys'

export function useKeyManager() {
  const { invoke } = useIpc()

  async function setKey(provider: string, key: string): Promise<void> {
    try {
      const res = await invoke('keystore:set', provider, key || '')
      if (res?.success) return
    } catch {
      // fall back to localStorage
    }
    const keys = JSON.parse(localStorage.getItem(SERVICE) || '{}')
    keys[provider] = key
    localStorage.setItem(SERVICE, JSON.stringify(keys))
  }

  async function getKey(provider: string): Promise<string | null> {
    try {
      const res = await invoke('keystore:get', provider)
      if (res?.success) return res.key || null
    } catch {
      // fall back
    }
    const keys = JSON.parse(localStorage.getItem(SERVICE) || '{}')
    return keys[provider] || null
  }

  async function deleteKey(provider: string): Promise<boolean> {
    try {
      const res = await invoke('keystore:delete', provider)
      if (res?.success) return !!res.deleted
    } catch {
      // ignore
    }
    const keys = JSON.parse(localStorage.getItem(SERVICE) || '{}')
    if (keys[provider]) {
      delete keys[provider]
      localStorage.setItem(SERVICE, JSON.stringify(keys))
      return true
    }
    return false
  }

  return { setKey, getKey, deleteKey }
}
