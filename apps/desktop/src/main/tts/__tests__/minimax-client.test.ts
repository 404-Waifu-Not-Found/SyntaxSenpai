import { describe, expect, it, vi } from 'vitest'
import { createMiniMaxVoiceClient } from '../minimax-client'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function rawJsonResponse(json: string, status = 200) {
  return new Response(json, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('MiniMax CN voice client', () => {
  it('uploads voice-clone samples as multipart form data', async () => {
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://api.minimax.cn/v1/files/upload')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-secret')
      const form = init?.body as FormData
      expect(form.get('purpose')).toBe('voice_clone')
      expect((form.get('file') as File).name).toBe('sample.wav')
      return jsonResponse({ file: { file_id: 'uploaded-voice' }, base_resp: { status_code: 0 } })
    })

    const client = createMiniMaxVoiceClient('test-secret', fetcher)
    await expect(client.uploadCloneAudio({
      fileName: 'sample.wav',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
    })).resolves.toBe('uploaded-voice')
  })

  it.each([
    ['wrapped file object', { data: { file: { file_id: 'wrapped-file' } }, base_resp: { status_code: 0 } }, 'wrapped-file'],
    ['wrapped file id', { data: { file_id: 'wrapped-id' }, base_resp: { status_code: 0 } }, 'wrapped-id'],
    ['numeric documented file id', { file: { file_id: 4815162342 }, base_resp: { status_code: 0 } }, 4815162342],
    ['top-level file id', { file_id: 'top-level-id', base_resp: { status_code: 0 } }, 'top-level-id'],
  ])('reads a file id from the %s upload response shape', async (_shape, responseBody, expectedFileId) => {
    const fetcher: typeof fetch = vi.fn(async () => jsonResponse(responseBody))
    await expect(createMiniMaxVoiceClient('test-secret', fetcher).uploadCloneAudio({
      fileName: 'sample.wav',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
    })).resolves.toBe(expectedFileId)
  })

  it('preserves the exact documented int64 file ID and sends it as a JSON integer', async () => {
    const exactFileId = '9223372036854775807'
    let cloneBody = ''
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      if (String(input).endsWith('/files/upload')) {
        return rawJsonResponse(`{"file":{"file_id":${exactFileId}},"base_resp":{"status_code":0,"status_msg":"success"}}`)
      }
      cloneBody = String(init?.body)
      return jsonResponse({ base_resp: { status_code: 0 } })
    })

    const client = createMiniMaxVoiceClient('test-secret', fetcher)
    const fileId = await client.uploadCloneAudio({
      fileName: 'sample.wav',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/wav',
    })
    expect(fileId).toBe(exactFileId)
    await client.cloneVoice(fileId, 'syntaxsenpai_aria_123', 'Hello from Aria')

    expect(cloneBody).toContain(`"file_id":${exactFileId},`)
    const safelyParsedBody = cloneBody.replace(`"file_id":${exactFileId}`, `"file_id":"${exactFileId}"`)
    expect(JSON.parse(safelyParsedBody)).toMatchObject({
      file_id: exactFileId,
      voice_id: 'syntaxsenpai_aria_123',
      text: 'Hello from Aria',
      model: 'speech-2.8-hd',
    })
  })

  it('requests a clone with the uploaded file, generated voice id and preview', async () => {
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://api.minimax.cn/v1/voice_clone')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        file_id: 'uploaded-voice',
        voice_id: 'syntaxsenpai_aria_123',
        text: 'Hello from Aria',
        model: 'speech-2.8-hd',
      })
      return jsonResponse({ base_resp: { status_code: 0 } })
    })

    await createMiniMaxVoiceClient('test-secret', fetcher)
      .cloneVoice('uploaded-voice', 'syntaxsenpai_aria_123', 'Hello from Aria')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('preserves numeric file ids when starting a clone', async () => {
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ file_id: 4815162342 })
      return jsonResponse({ base_resp: { status_code: 0 } })
    })

    await createMiniMaxVoiceClient('test-secret', fetcher)
      .cloneVoice(4815162342, 'syntaxsenpai_aria_123', 'Hello from Aria')
  })

  it('synthesizes MP3 with the cloned voice id and decodes hex audio', async () => {
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://api.minimax.cn/v1/t2a_v2')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'speech-2.8-hd',
        text: 'A final reply',
        stream: false,
        voice_setting: { voice_id: 'syntaxsenpai_aria_123' },
        audio_setting: { format: 'mp3', sample_rate: 32000 },
        output_format: 'hex',
      })
      return jsonResponse({ data: { audio: '494433' }, base_resp: { status_code: 0 } })
    })

    const audio = await createMiniMaxVoiceClient('test-secret', fetcher)
      .synthesize('A final reply', 'syntaxsenpai_aria_123')
    expect([...audio]).toEqual([0x49, 0x44, 0x33])
  })

  it('rejects API-level errors without exposing the key', async () => {
    const fetcher: typeof fetch = async () => jsonResponse({ base_resp: { status_code: 1004, status_msg: 'invalid voice sample' } })
    await expect(createMiniMaxVoiceClient('test-secret', fetcher)
      .synthesize('Hello', 'voice-id')).rejects.toThrow('invalid voice sample')
  })
})
