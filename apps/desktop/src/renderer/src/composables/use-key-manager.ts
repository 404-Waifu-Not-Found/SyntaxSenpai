import { useIpc } from './use-ipc'

const LEGACY_LOCAL_STORAGE_SERVICE = 'syntax-senpai-keys'
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

  function clearLegacyLocalKeys() {
    try {
      localStorage.removeItem(LEGACY_LOCAL_STORAGE_SERVICE)
    } catch {
      // best effort cleanup of legacy plaintext fallback
    }
  }

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

    clearLegacyLocalKeys()
    if (!stored) throw new Error('Secure key storage is unavailable.')
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

    clearLegacyLocalKeys()
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

    clearLegacyLocalKeys()
    return deleted
  }

  return { setKey, getKey, deleteKey }
}
