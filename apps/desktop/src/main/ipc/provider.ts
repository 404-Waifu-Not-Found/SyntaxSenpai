const { ipcMain } = require('electron')

const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  'openai-codex': 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  'minimax-global': 'https://api.minimax.io/v1',
  'minimax-cn': 'https://api.minimaxi.com/v1',
  xai: 'https://api.x.ai/v1',
  'xai-grok': 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  together: 'https://api.together.xyz/v1',
  perplexity: 'https://api.perplexity.ai',
  huggingface: 'https://router.huggingface.co/v1',
  'github-models': 'https://models.inference.ai.azure.com',
  lmstudio: 'http://127.0.0.1:1234/v1',
}

const KEYLESS_PROVIDERS = new Set(['lmstudio'])

const FALLBACK_MODELS: Record<string, Array<{ id: string; displayName: string }>> = {
  anthropic: [
    { id: 'claude-opus-4-1', displayName: 'Claude Opus 4.1' },
    { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o', displayName: 'GPT-4o' },
    { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo' },
    { id: 'gpt-4', displayName: 'GPT-4' },
  ],
  'openai-codex': [
    { id: 'gpt-4o', displayName: 'GPT-4o' },
    { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo' },
  ],
  deepseek: [
    { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
  ],
  mistral: [
    { id: 'mistral-large-latest', displayName: 'Mistral Large' },
    { id: 'mistral-medium-latest', displayName: 'Mistral Medium' },
  ],
  groq: [
    { id: 'llama-3.1-70b-versatile', displayName: 'Llama 3.1 70B' },
    { id: 'mixtral-8x7b-32768', displayName: 'Mixtral 8x7B' },
  ],
  'minimax-global': [
    { id: 'MiniMax-Text-01', displayName: 'MiniMax Text 01' },
    { id: 'MiniMax-M1', displayName: 'MiniMax M1' },
  ],
  'minimax-cn': [
    { id: 'MiniMax-Text-01', displayName: 'MiniMax Text 01 (CN)' },
    { id: 'MiniMax-M1', displayName: 'MiniMax M1 (CN)' },
  ],
  xai: [
    { id: 'grok-2-latest', displayName: 'Grok 2' },
    { id: 'grok-vision-beta', displayName: 'Grok Vision' },
  ],
  huggingface: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B Instruct' },
    { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', displayName: 'Qwen 2.5 Coder 32B' },
  ],
  'github-models': [
    { id: 'openai/gpt-4o-mini', displayName: 'GPT-4o Mini' },
    { id: 'meta/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B' },
  ],
  lmstudio: [{ id: 'local-model', displayName: 'Detected Local Model' }],
}

let registered = false

async function fetchOpenAICompatibleModels(provider: string, apiKey: string) {
  const baseUrl = OPENAI_COMPATIBLE_BASE_URLS[provider]
  if (!baseUrl) return null

  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Model list request failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const models = Array.isArray(data?.data)
    ? data.data
        .filter((model: any) => typeof model?.id === 'string' && model.id.length > 0)
        .map((model: any) => ({
          id: model.id,
          displayName: model.id,
        }))
    : []

  return models.length > 0 ? models : null
}

async function fetchLMStudioModels() {
  const response = await fetch('http://127.0.0.1:1234/v1/models')
  if (!response.ok) {
    throw new Error(`LM Studio model request failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const models = Array.isArray(data?.data)
    ? data.data
        .filter((model: any) => typeof model?.id === 'string' && model.id.length > 0)
        .map((model: any) => ({
          id: model.id,
          displayName: model.id,
        }))
    : []

  return models.length > 0 ? models : null
}

async function validateLMStudioConnection() {
  const response = await fetch('http://127.0.0.1:1234/v1/models')
  if (response.ok) {
    return { success: true, message: 'LM Studio is reachable' }
  }

  return {
    success: false,
    error: `LM Studio is not reachable (${response.status} ${response.statusText}). Start LM Studio local server on http://127.0.0.1:1234.`,
  }
}

export function registerProviderIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('provider:validateKey', async (_event: any, provider: string, apiKey: string) => {
    const trimmedKey = String(apiKey || '').trim()

    if (provider === 'lmstudio') {
      try {
        return await validateLMStudioConnection()
      } catch (err: any) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    if (!trimmedKey) return { success: false, error: 'API key is empty' }

    try {
      if (provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': trimmedKey,
            'anthropic-version': '2023-06-01',
          },
        })
        if (response.ok) return { success: true, message: 'API key is valid' }
        const data = await response.json().catch(() => null)
        return { success: false, error: data?.error?.message || `${response.status} ${response.statusText}` }
      }

      if (provider === 'gemini') {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${trimmedKey}`,
        )
        if (response.ok) return { success: true, message: 'API key is valid' }
        const data = await response.json().catch(() => null)
        return { success: false, error: data?.error?.message || `${response.status} ${response.statusText}` }
      }

      const baseUrl = OPENAI_COMPATIBLE_BASE_URLS[provider]
      if (!baseUrl) return { success: true, message: 'Key saved' }

      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${trimmedKey}` },
      })

      if (response.ok) return { success: true, message: 'API key is valid' }
      const data = await response.json().catch(() => null)
      return { success: false, error: data?.error?.message || `${response.status} ${response.statusText}` }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('provider:listModels', async (event: any, provider: string, apiKey: string) => {
    try {
      const trimmedKey = String(apiKey || '').trim()

      if (provider === 'lmstudio') {
        try {
          const models = await fetchLMStudioModels()
          if (models) return { success: true, models, source: 'remote' }
        } catch (error: any) {
          return {
            success: true,
            models: FALLBACK_MODELS[provider] || [],
            source: 'fallback',
            warning: error instanceof Error ? error.message : String(error),
          }
        }
        return { success: true, models: FALLBACK_MODELS[provider] || [], source: 'fallback' }
      }

      if (!trimmedKey && !KEYLESS_PROVIDERS.has(provider)) {
        return { success: true, models: FALLBACK_MODELS[provider] || [] }
      }

      try {
        const models = await fetchOpenAICompatibleModels(provider, trimmedKey)
        if (models) return { success: true, models, source: 'remote' }
      } catch (error: any) {
        return {
          success: true,
          models: FALLBACK_MODELS[provider] || [],
          source: 'fallback',
          warning: error instanceof Error ? error.message : String(error),
        }
      }

      return { success: true, models: FALLBACK_MODELS[provider] || [], source: 'fallback' }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

module.exports = { registerProviderIpc }

export {}
