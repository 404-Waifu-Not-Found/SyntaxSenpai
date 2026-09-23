const API_ROOT = 'https://api.minimax.cn/v1'

export type MiniMaxCloneUpload = {
  fileName: string
  bytes: Uint8Array
  mimeType: string
}

export interface MiniMaxVoiceClient {
  uploadCloneAudio(file: MiniMaxCloneUpload, signal?: AbortSignal): Promise<string | number>
  cloneVoice(fileId: string | number, voiceId: string, previewText: string, signal?: AbortSignal): Promise<void>
  synthesize(text: string, voiceId: string, signal?: AbortSignal): Promise<Uint8Array>
}

type MiniMaxApiResponse = {
  base_resp?: { status_code?: number; status_msg?: string }
  file?: { file_id?: string | number; id?: string | number }
  file_id?: string | number
  data?: {
    file?: { file_id?: string | number; id?: string | number }
    file_id?: string | number
    audio?: string
  }
  message?: string
  error?: { message?: string }
}

function describeApiError(response: Response, data: MiniMaxApiResponse | null): string {
  return data?.base_resp?.status_msg || data?.error?.message || data?.message ||
    `MiniMax voice request failed (HTTP ${response.status}).`
}

/**
 * MiniMax declares file_id as int64. JSON.parse converts integer tokens to
 * Number and silently rounds values above Number.MAX_SAFE_INTEGER, so quote
 * those tokens before parsing and keep the exact decimal digits as a string.
 */
function preserveInt64FileIds(json: string): string {
  let result = ''
  let cursor = 0

  while (cursor < json.length) {
    if (json[cursor] !== '"') {
      result += json[cursor++]
      continue
    }

    const keyStart = cursor
    cursor++
    while (cursor < json.length) {
      if (json[cursor] === '\\') cursor += 2
      else if (json[cursor++] === '"') break
    }

    const keyToken = json.slice(keyStart, cursor)
    let key: unknown
    try { key = JSON.parse(keyToken) } catch { key = undefined }
    result += keyToken

    if (key !== 'file_id') continue

    let valueStart = cursor
    while (/\s/.test(json[valueStart] || '') && valueStart < json.length) valueStart++
    if (json[valueStart] !== ':') continue
    let numberStart = valueStart + 1
    while (/\s/.test(json[numberStart] || '') && numberStart < json.length) numberStart++
    let numberEnd = numberStart
    if (json[numberEnd] === '-') numberEnd++
    while (/[0-9]/.test(json[numberEnd] || '')) numberEnd++
    const integerToken = json.slice(numberStart, numberEnd)
    if (!/^-?\d+$/.test(integerToken)) continue

    result += json.slice(cursor, numberStart) + JSON.stringify(integerToken)
    cursor = numberEnd
  }

  return result
}

function normalizeFileId(candidate: unknown): string | number | undefined {
  if (typeof candidate === 'number') {
    return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : undefined
  }
  if (typeof candidate !== 'string') return undefined

  const value = candidate.trim()
  if (!value) return undefined
  if (/^\d+$/.test(value)) {
    try {
      const integer = BigInt(value)
      if (integer <= 0n) return undefined
      return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
    } catch {
      return undefined
    }
  }
  return value
}

function serializeFileId(fileId: string | number): string {
  if (typeof fileId === 'number') {
    if (!Number.isSafeInteger(fileId) || fileId <= 0) {
      throw new Error('MiniMax file ID must be a positive safe integer or an exact decimal string.')
    }
    return String(fileId)
  }

  const value = fileId.trim()
  if (!value) throw new Error('MiniMax file ID is empty.')
  // The documented clone endpoint expects an int64 JSON number. Keep large
  // IDs unquoted in the request while retaining their exact digits in JS.
  return /^\d+$/.test(value) ? value : JSON.stringify(value)
}

export function createMiniMaxVoiceClient(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): MiniMaxVoiceClient {
  const key = apiKey.trim()
  if (!key) throw new Error('MiniMax CN API key is not configured. Save it in Settings → AI providers first.')

  async function readJson(response: Response): Promise<MiniMaxApiResponse> {
    const raw = await response.text().catch(() => '')
    let data: MiniMaxApiResponse | null = null
    try {
      data = JSON.parse(preserveInt64FileIds(raw)) as MiniMaxApiResponse
    } catch {
      data = null
    }
    if (!response.ok || (data?.base_resp?.status_code !== undefined && data.base_resp.status_code !== 0)) {
      throw new Error(describeApiError(response, data))
    }
    if (!data) throw new Error('MiniMax returned an invalid voice API response.')
    return data
  }

  function makeSignal(signal: AbortSignal | undefined, timeoutMs: number) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('MiniMax voice request timed out.')), timeoutMs)
    const abort = () => controller.abort(signal?.reason)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    return {
      signal: controller.signal,
      dispose() {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
      },
    }
  }

  return {
    async uploadCloneAudio(file, signal) {
      const form = new FormData()
      form.append('purpose', 'voice_clone')
      const audioBuffer = new ArrayBuffer(file.bytes.byteLength)
      new Uint8Array(audioBuffer).set(file.bytes)
      form.append('file', new Blob([audioBuffer], { type: file.mimeType }), file.fileName)
      const request = makeSignal(signal, 60_000)
      try {
        const response = await fetcher(`${API_ROOT}/files/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: request.signal,
        })
        const data = await readJson(response)
        const fileId = [
          data.file?.file_id,
          data.file?.id,
          data.data?.file?.file_id,
          data.data?.file?.id,
          data.data?.file_id,
          data.file_id,
        ].map(normalizeFileId).find((candidate) => candidate !== undefined)
        if (!fileId) {
          const fields = Object.keys(data).filter((key) => key !== 'message').join(', ') || 'none'
          throw new Error(`MiniMax upload response did not include a file ID (response fields: ${fields}).`)
        }
        return fileId
      } finally {
        request.dispose()
      }
    },

    async cloneVoice(fileId, voiceId, previewText, signal) {
      const request = makeSignal(signal, 120_000)
      try {
        const response = await fetcher(`${API_ROOT}/voice_clone`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: (() => {
            const payload = JSON.stringify({
              voice_id: voiceId,
              text: previewText,
              model: 'speech-2.8-hd',
            })
            return `{"file_id":${serializeFileId(fileId)},${payload.slice(1)}`
          })(),
          signal: request.signal,
        })
        await readJson(response)
      } finally {
        request.dispose()
      }
    },

    async synthesize(text, voiceId, signal) {
      const request = makeSignal(signal, 120_000)
      try {
        const response = await fetcher(`${API_ROOT}/t2a_v2`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'speech-2.8-hd',
            text,
            stream: false,
            voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 0 },
            audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
            output_format: 'hex',
            subtitle_enable: false,
          }),
          signal: request.signal,
        })
        const data = await readJson(response)
        const hex = data.data?.audio
        if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(hex)) {
          throw new Error('MiniMax synthesis response did not contain valid hex audio.')
        }
        return new Uint8Array(Buffer.from(hex, 'hex'))
      } finally {
        request.dispose()
      }
    },
  }
}
