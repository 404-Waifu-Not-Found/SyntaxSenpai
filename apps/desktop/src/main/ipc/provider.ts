const { ipcMain, webContents: _webContents } = require('electron')
import { mainLogger } from '../logger'
type SendableWebContents = { send: (channel: string, payload: unknown) => void; isDestroyed?: () => boolean }
const activeChatStreams = new Map<string, AbortController>()
const providerLogger = mainLogger.child({ scope: 'provider-ipc' })

function truncate(input: string, max: number): string {
  if (typeof input !== 'string') return ''
  return input.length > max ? input.slice(0, max) + `…(+${input.length - max} chars)` : input
}

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

// Providers whose backend does not expose an OpenAI-style `GET /v1/models`
// listing. For these we skip the probe (it 404s) and fall back to the
// hard-coded model list, and we validate keys via a minimal chat ping.
const NO_MODELS_ENDPOINT = new Set(['minimax-global', 'minimax-cn'])

// Do a cheap chat completion call to validate a key when /v1/models isn't
// available. 401/403 => bad key; 200/400 (we sent a tiny prompt) => key ok.
async function validateViaChatPing(baseUrl: string, apiKey: string, model: string) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    }),
  })
  if (response.ok) return { success: true, message: 'API key is valid' }
  // Parse provider error message for bad keys
  const data = await response.json().catch(() => null)
  const msg =
    data?.error?.message ||
    data?.base_resp?.status_msg ||
    data?.message ||
    `${response.status} ${response.statusText}`
  // 400 with a content/model-not-allowed style error still means the key itself authenticated
  if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403) {
    // Some providers return 400 for tiny/empty prompts — treat as auth-ok
    return { success: true, message: 'API key accepted (provider rejected ping body but auth succeeded)' }
  }
  return { success: false, error: msg }
}

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

      if (NO_MODELS_ENDPOINT.has(provider)) {
        const fallback = FALLBACK_MODELS[provider]?.[0]?.id || 'MiniMax-Text-01'
        return await validateViaChatPing(baseUrl, trimmedKey, fallback)
      }

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

      // Providers without a /v1/models endpoint — return curated list directly.
      if (NO_MODELS_ENDPOINT.has(provider)) {
        return { success: true, models: FALLBACK_MODELS[provider] || [], source: 'fallback' }
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

  // OpenAI-compatible chat completion proxy — lets the renderer reach providers
  // that don't allow browser-origin requests (MiniMax, DeepSeek, Groq, etc.)
  // by doing the HTTPS call from the main process where CORS doesn't apply.
  ipcMain.handle(
    'provider:chatComplete',
    async (
      _event: unknown,
      args: { baseUrl: string; apiKey: string; body: unknown; headers?: Record<string, string> }
    ) => {
      const { baseUrl, apiKey, body, headers } = args || ({} as any)
      if (!baseUrl) return { success: false, error: 'baseUrl is required' }
      try {
        const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            ...(headers || {}),
          },
          body: JSON.stringify(body ?? {}),
        })
        const text = await response.text()
        let data: unknown = null
        try {
          data = text ? JSON.parse(text) : null
        } catch {
          /* non-JSON error body */
        }
        if (!response.ok) {
          const msg =
            (data as any)?.error?.message ||
            (data as any)?.message ||
            (typeof data === 'string' ? data : '') ||
            text ||
            `${response.status} ${response.statusText}`
          providerLogger.error(
            { op: 'chatComplete', status: response.status, url, body: truncate(text, 1000) },
            msg,
          )
          return { success: false, status: response.status, error: msg }
        }
        return { success: true, data }
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err)
        providerLogger.error({ op: 'chatComplete', err }, `fetch failed: ${msg}`)
        return { success: false, error: msg }
      }
    },
  )

  // Streaming variant. The renderer supplies a streamId; chunks arrive on
  // `provider:chatStream:chunk:<id>` and terminate with `provider:chatStream:end:<id>`.
  // Call `provider:chatStream:cancel` with the id to abort mid-stream.
  ipcMain.handle(
    'provider:chatStream',
    async (
      event: { sender: SendableWebContents },
      args: {
        streamId: string
        baseUrl: string
        apiKey: string
        body: unknown
        headers?: Record<string, string>
      },
    ) => {
      const { streamId, baseUrl, apiKey, body, headers } = args || ({} as any)
      if (!streamId) return { success: false, error: 'streamId is required' }
      if (!baseUrl) return { success: false, error: 'baseUrl is required' }
      const sender = event.sender
      const controller = new AbortController()
      activeChatStreams.set(streamId, controller)
      const chunkChannel = `provider:chatStream:chunk:${streamId}`
      const endChannel = `provider:chatStream:end:${streamId}`
      const safeSend = (channel: string, payload: unknown) => {
        try {
          if (sender.isDestroyed && sender.isDestroyed()) return
          sender.send(channel, payload)
        } catch {
          /* renderer gone */
        }
      }
      ;(async () => {
        try {
          const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'text/event-stream',
              ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
              ...(headers || {}),
            },
            body: JSON.stringify({ ...(body as any), stream: true }),
            signal: controller.signal,
          })
          if (!response.ok || !response.body) {
            const text = await response.text().catch(() => '')
            let msg = text
            try {
              const parsed = text ? JSON.parse(text) : null
              msg = parsed?.error?.message || parsed?.message || text
            } catch {
              /* raw */
            }
            const finalMsg = msg || `${response.status} ${response.statusText}`
            providerLogger.error(
              { op: 'chatStream', status: response.status, url, body: truncate(text, 1000) },
              finalMsg,
            )
            safeSend(endChannel, { error: finalMsg, status: response.status })
            return
          }
          const reader = (response.body as any).getReader()
          const decoder = new TextDecoder('utf-8')
          let buffered = ''
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffered += decoder.decode(value, { stream: true })
            let idx: number
            while ((idx = buffered.indexOf('\n')) >= 0) {
              const line = buffered.slice(0, idx).replace(/\r$/, '')
              buffered = buffered.slice(idx + 1)
              if (!line.startsWith('data:')) continue
              const payload = line.slice(5).trim()
              if (!payload || payload === '[DONE]') continue
              safeSend(chunkChannel, { raw: payload })
            }
          }
          safeSend(endChannel, { ok: true })
        } catch (err: any) {
          if (controller.signal.aborted) {
            safeSend(endChannel, { cancelled: true })
          } else {
            const msg = err instanceof Error ? err.message : String(err)
            providerLogger.error({ op: 'chatStream', err }, `stream failed: ${msg}`)
            safeSend(endChannel, { error: msg })
          }
        } finally {
          activeChatStreams.delete(streamId)
        }
      })()
      return { success: true, streamId }
    },
  )

  ipcMain.handle('provider:chatStream:cancel', (_event: unknown, streamId: string) => {
    const controller = activeChatStreams.get(streamId)
    if (!controller) return { success: false, error: 'unknown streamId' }
    try {
      controller.abort()
    } catch {
      /* ignore */
    }
    activeChatStreams.delete(streamId)
    return { success: true }
  })
}

module.exports = { registerProviderIpc }

export {}
