const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const { ipcMain, app, dialog } = electronModule

type ReferenceWavEntry = {
  id: string
  fileName: string
  absolutePath: string
  sampleRate: number
  durationMs: number
  speakerTag: string
  emotionTags: string[]
  createdAt: string
  updatedAt: string
}

type TtsErrorCode =
  | 'CONFIG_ERROR'
  | 'REFERENCE_WAV_MISSING'
  | 'MODEL_UNAVAILABLE'
  | 'INFERENCE_TIMEOUT'
  | 'INFERENCE_FAILED'

let registered = false
const activeRequests = new Map<string, AbortController>()

function ttsReferenceDir(): string {
  return path.join(app.getPath('userData'), 'tts-reference-wavs')
}

function ttsReferenceIndexPath(): string {
  return path.join(ttsReferenceDir(), 'index.json')
}

function ttsCacheDir(): string {
  return path.join(app.getPath('userData'), 'tts-cache')
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function toUserdataUrl(absPath: string): string {
  const rel = path.relative(app.getPath('userData'), absPath).replace(/\\/g, '/')
  return `userdata://${rel}`
}

function readReferenceIndex(): ReferenceWavEntry[] {
  try {
    const file = ttsReferenceIndexPath()
    if (!fs.existsSync(file)) return []
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.filter((x) => x && typeof x.id === 'string')
  } catch {
    return []
  }
}

function writeReferenceIndexAtomic(entries: ReferenceWavEntry[]) {
  ensureDir(ttsReferenceDir())
  const file = ttsReferenceIndexPath()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function parseWavInfo(buf: Buffer): { sampleRate: number; durationMs: number } | null {
  if (buf.length < 44) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return null

  let sampleRate = 0
  let byteRate = 0
  let dataSize = 0
  let offset = 12
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    const chunkDataOffset = offset + 8
    if (chunkId === 'fmt ' && chunkDataOffset + 16 <= buf.length) {
      sampleRate = buf.readUInt32LE(chunkDataOffset + 4)
      byteRate = buf.readUInt32LE(chunkDataOffset + 8)
    } else if (chunkId === 'data') {
      dataSize = chunkSize
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2)
  }

  if (!sampleRate) return null
  const durationMs = byteRate > 0 ? Math.round((dataSize / byteRate) * 1000) : 0
  return { sampleRate, durationMs }
}

function normalizeEmotionTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return tags
    .filter((t) => typeof t === 'string')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 16)
}

function classifyTtsError(err: any): { errorCode: TtsErrorCode; error: string } {
  const msg = err?.message || String(err || '')
  const lower = String(msg).toLowerCase()
  if (err?.name === 'AbortError' || lower.includes('timeout')) {
    return { errorCode: 'INFERENCE_TIMEOUT', error: msg || 'IndexTTS request timed out' }
  }
  if (lower.includes('reference') && lower.includes('missing')) {
    return { errorCode: 'REFERENCE_WAV_MISSING', error: msg }
  }
  return { errorCode: 'INFERENCE_FAILED', error: msg || 'IndexTTS request failed' }
}

async function invokeIndexTts(endpoint: string, payload: Record<string, unknown>, timeoutMs: number, requestId: string) {
  const controller = new AbortController()
  activeRequests.set(requestId, controller)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 408 || response.status === 504) {
        return { success: false, errorCode: 'INFERENCE_TIMEOUT', error: `IndexTTS timed out (HTTP ${response.status})` as string }
      }
      return { success: false, errorCode: 'INFERENCE_FAILED', error: `IndexTTS failed (HTTP ${response.status})` as string }
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    ensureDir(ttsCacheDir())
    const outPath = path.join(ttsCacheDir(), `${requestId}.wav`)

    if (contentType.startsWith('audio/')) {
      const buf = Buffer.from(await response.arrayBuffer())
      fs.writeFileSync(outPath, buf)
      return { success: true, audioPath: toUserdataUrl(outPath), durationMs: 0 }
    }

    const data: any = await response.json()
    if (typeof data?.audioPath === 'string' && data.audioPath) {
      const sourcePath = path.resolve(data.audioPath)
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, outPath)
        return {
          success: true,
          audioPath: toUserdataUrl(outPath),
          durationMs: Number.isFinite(data.durationMs) ? data.durationMs : 0,
        }
      }
    }

    const base64 = typeof data?.audioBase64 === 'string'
      ? data.audioBase64
      : typeof data?.audioBufferBase64 === 'string'
        ? data.audioBufferBase64
        : ''
    if (!base64) {
      return { success: false, errorCode: 'INFERENCE_FAILED', error: 'IndexTTS response missing audio payload' as string }
    }
    fs.writeFileSync(outPath, Buffer.from(base64, 'base64'))
    return {
      success: true,
      audioPath: toUserdataUrl(outPath),
      durationMs: Number.isFinite(data?.durationMs) ? data.durationMs : 0,
    }
  } finally {
    clearTimeout(timeout)
    activeRequests.delete(requestId)
  }
}

export function registerTtsIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('tts:importReferenceWav', async (_e: any, payload?: any) => {
    try {
      ensureDir(ttsReferenceDir())
      let sourcePath = typeof payload?.sourcePath === 'string' ? payload.sourcePath : ''
      if (!sourcePath) {
        const result = await dialog.showOpenDialog({
          title: 'Select reference WAV file',
          buttonLabel: 'Import',
          filters: [{ name: 'WAV audio', extensions: ['wav'] }],
          properties: ['openFile'],
        })
        if (result.canceled || !result.filePaths.length) return { success: false, canceled: true }
        sourcePath = result.filePaths[0]
      }
      if (!sourcePath.toLowerCase().endsWith('.wav')) {
        return { success: false, errorCode: 'CONFIG_ERROR', error: 'Only .wav files are supported' }
      }

      const fileName = path.basename(sourcePath)
      const id = `wav_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
      const destPath = path.join(ttsReferenceDir(), `${id}.wav`)
      fs.copyFileSync(sourcePath, destPath)

      const wavInfo = parseWavInfo(fs.readFileSync(destPath))
      if (!wavInfo) {
        fs.rmSync(destPath, { force: true })
        return { success: false, errorCode: 'CONFIG_ERROR', error: 'Invalid WAV format' }
      }

      const now = new Date().toISOString()
      const entry: ReferenceWavEntry = {
        id,
        fileName,
        absolutePath: destPath,
        sampleRate: wavInfo.sampleRate,
        durationMs: wavInfo.durationMs,
        speakerTag: typeof payload?.speakerTag === 'string' ? payload.speakerTag.trim() : '',
        emotionTags: normalizeEmotionTags(payload?.emotionTags),
        createdAt: now,
        updatedAt: now,
      }
      const existing = readReferenceIndex().filter((x) => x.id !== entry.id)
      existing.push(entry)
      writeReferenceIndexAtomic(existing)
      return { success: true, entry }
    } catch (err: any) {
      return { success: false, ...classifyTtsError(err) }
    }
  })

  ipcMain.handle('tts:listReferenceWavs', async () => {
    try {
      return { success: true, entries: readReferenceIndex(), directory: ttsReferenceDir(), indexPath: ttsReferenceIndexPath() }
    } catch (err: any) {
      return { success: false, ...classifyTtsError(err) }
    }
  })

  ipcMain.handle('tts:deleteReferenceWav', async (_e: any, wavId: string) => {
    try {
      if (typeof wavId !== 'string' || !wavId.trim()) {
        return { success: false, errorCode: 'CONFIG_ERROR', error: 'wavId is required' }
      }
      const existing = readReferenceIndex()
      const target = existing.find((x) => x.id === wavId)
      if (!target) return { success: false, errorCode: 'REFERENCE_WAV_MISSING', error: 'Reference WAV not found' }
      if (fs.existsSync(target.absolutePath)) {
        fs.rmSync(target.absolutePath, { force: true })
      }
      writeReferenceIndexAtomic(existing.filter((x) => x.id !== wavId))
      return { success: true }
    } catch (err: any) {
      return { success: false, ...classifyTtsError(err) }
    }
  })

  ipcMain.handle('tts:getStatus', async () => {
    try {
      const endpoint = process.env.INDEXTTS_ENDPOINT || ''
      const modelPath = process.env.INDEXTTS_MODEL_PATH || ''
      const available = Boolean(endpoint || modelPath)
      return {
        success: true,
        available,
        modelLoaded: available,
        endpoint,
        modelPath,
        activeRequests: activeRequests.size,
      }
    } catch (err: any) {
      return { success: false, ...classifyTtsError(err) }
    }
  })

  ipcMain.handle('tts:cancel', async (_e: any, requestId?: string) => {
    try {
      if (requestId && activeRequests.has(requestId)) {
        activeRequests.get(requestId)?.abort()
        activeRequests.delete(requestId)
        return { success: true, canceled: [requestId] }
      }
      const canceled: string[] = []
      for (const [id, controller] of activeRequests.entries()) {
        controller.abort()
        canceled.push(id)
      }
      activeRequests.clear()
      return { success: true, canceled }
    } catch (err: any) {
      return { success: false, ...classifyTtsError(err) }
    }
  })

  ipcMain.handle('tts:synthesize', async (_e: any, payload: any) => {
    const requestId = typeof payload?.requestId === 'string' && payload.requestId.trim()
      ? payload.requestId.trim()
      : `tts_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    try {
      const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
      if (!text) {
        return { success: false, requestId, errorCode: 'CONFIG_ERROR', error: 'text is required' }
      }

      const referenceWavId = typeof payload?.referenceWavId === 'string' ? payload.referenceWavId.trim() : ''
      if (referenceWavId) {
        const hasRef = readReferenceIndex().some((x) => x.id === referenceWavId)
        if (!hasRef) {
          return { success: false, requestId, errorCode: 'REFERENCE_WAV_MISSING', error: 'Reference WAV not found' }
        }
      }

      const endpoint = process.env.INDEXTTS_ENDPOINT || ''
      if (!endpoint) {
        return { success: false, requestId, errorCode: 'MODEL_UNAVAILABLE', error: 'INDEXTTS_ENDPOINT is not configured' }
      }

      const timeoutMs = Math.max(1000, Math.min(120000, Number(payload?.timeoutMs) || 30000))
      const requestPayload = {
        text,
        waifuId: payload?.waifuId || '',
        voicePresetId: payload?.voicePresetId || '',
        referenceWavId,
        emotion: payload?.emotion || 'neutral',
        requestId,
      }

      const result = await invokeIndexTts(endpoint, requestPayload, timeoutMs, requestId)
      if (!result.success) {
        return { success: false, requestId, errorCode: result.errorCode, error: result.error }
      }
      return {
        success: true,
        requestId,
        audioPath: result.audioPath,
        durationMs: result.durationMs,
      }
    } catch (err: any) {
      const mapped = classifyTtsError(err)
      return { success: false, requestId, ...mapped }
    }
  })
}

module.exports = { registerTtsIpc }

export {}
