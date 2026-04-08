import { useIpc } from './use-ipc'

const SERVICE = 'syntax-senpai-keys'
const PROVIDER_ALIASES: Record<string, string[]> = {
  'minimax-cn': ['minimax-global'],
  'minimax-global': ['minimax-cn'],
  xai: ['xai-grok'],
  'xai-grok': ['xai'],
}

function getProviderKeys(provider: string) {
  return [provider, ...(PROVIDER_ALIASES[provider] || [])]
}

export function useKeyManager() {
  const { invoke } = useIpc()

  async function setKey(provider: string, key: string): Promise<void> {
    const providers = getProviderKeys(provider)
    let stored = false

    for (const providerKey of providers) {
      try {
        const res = await invoke('keystore:set', providerKey, key || '')
        if (res?.success) stored = true
      } catch {
        // fall back to localStorage below
      }
    }

    if (stored) return

    const keys = JSON.parse(localStorage.getItem(SERVICE) || '{}')
    for (const providerKey of providers) {
      keys[providerKey] = key
    }
    localStorage.setItem(SERVICE, JSON.stringify(keys))
  }

  async function getKey(provider: string): Promise<string | null> {
    const providers = getProviderKeys(provider)

    for (const providerKey of providers) {
      try {
        const res = await invoke('keystore:get', providerKey)
        if (res?.success && res.key) return res.key || null
      } catch {
        // fall back below
      }
    }

    const keys = JSON.parse(localStorage.getItem(SERVICE) || '{}')
    for (const providerKey of providers) {
      if (keys[providerKey]) return keys[providerKey]
    }
    return null
  }

  async function deleteKey(provider: string): Promise<boolean> {
    const providers = getProviderKeys(provider)
    let deleted = false

    for (const providerKey of providers) {
      try {
        const res = await invoke('keystore:delete', providerKey)
        if (res?.success && res.deleted) deleted = true
      } catch {
        // ignore
      }
    }

    if (deleted) return true

    const keys = JSON.parse(localStorage.getItem(SERVICE) || '{}')
    let localDeleted = false
    for (const providerKey of providers) {
      if (keys[providerKey]) {
        delete keys[providerKey]
        localDeleted = true
      }
    }
    if (localDeleted) localStorage.setItem(SERVICE, JSON.stringify(keys))
    return localDeleted
  }

  return { setKey, getKey, deleteKey }
}
