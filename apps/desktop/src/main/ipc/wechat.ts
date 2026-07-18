/**
 * WeChat (iLink) IPC bridge — mirrors the shape of `ipc/ws.ts`.
 *
 * Owns the live bot session: handles QR pairing, persists credentials in
 * keytar under the dedicated `syntax-senpai-wechat` service, runs the
 * long-poll loop, and broadcasts inbound messages + status changes to
 * every renderer window.
 */

const { ipcMain, BrowserWindow, shell } = require('electron')
import qrcode from 'qrcode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  WeChatIlinkBot,
  type Credentials,
  getMessageText,
  startQrLogin,
  type WeixinMessage,
} from '@syntax-senpai/wechat-ilink'
import { mainLogger } from '../logger'

let keytar: any
try {
  keytar = require('keytar')
} catch (err: any) {
  console.warn('keytar not available in wechat ipc:', err && err.message)
  keytar = null
}

const SERVICE = 'syntax-senpai-wechat'
const ACCOUNT_DEFAULT = 'default'

// Tencent's official OpenClaw channel declares a 4,000 character text limit.
// Keeping replies intact below that limit avoids consuming a context token on
// artificial 600-character sub-messages.
const WECHAT_MAX_MESSAGE_CHARS = 4_000
const WECHAT_INTER_MESSAGE_DELAY_MS = 450
const WECHAT_MAX_CHUNKS = 12
// Cap on how many distinct messages a single `wechat:sendMulti` call may send.
const WECHAT_MAX_MULTI_MESSAGES = 10
const WECHAT_RECONNECT_DELAY_MS = 3_000

interface Peer {
  userId: string
  displayName?: string
  lastSeenAt: number
}

interface State {
  bot: WeChatIlinkBot | null
  creds: Credentials | null
  pairing: {
    qrPayload: string
    cancel: () => void
    done: Promise<Credentials>
  } | null
  peers: Map<string, Peer>
  /** Most recent contextToken per peer (so outbound replies can thread). */
  peerContextTokens: Map<string, string>
  lastError: string | null
  // Token bucket: max 20 sends per peer per minute.
  rateBuckets: Map<string, number[]>
}

const state: State = {
  bot: null,
  creds: null,
  pairing: null,
  peers: new Map(),
  peerContextTokens: new Map(),
  lastError: null,
  rateBuckets: new Map(),
}

let registered = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function clearReconnectTimer() {
  if (!reconnectTimer) return
  clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function scheduleReconnect(creds: Credentials) {
  if (reconnectTimer || state.bot?.isRunning()) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (!state.bot && state.creds === creds) startBot(creds)
  }, WECHAT_RECONNECT_DELAY_MS)
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function emitStatus() {
  broadcast('wechat:status-changed', {
    connected: !!state.bot && state.bot.isRunning(),
    lastError: state.lastError,
    account: state.creds
      ? { userId: state.creds.userId, displayName: state.creds.displayName ?? null }
      : null,
  })
}

function recordDeliveryFailure(error: string) {
  state.lastError = error
  emitStatus()
}

function rememberPeer(msg: WeixinMessage) {
  const fromId = msg.from_user_id
  if (!fromId) return
  const existing = state.peers.get(fromId)
  state.peers.set(fromId, {
    userId: fromId,
    displayName: existing?.displayName,
    lastSeenAt: Date.now(),
  })
  if (msg.context_token) {
    state.peerContextTokens.set(fromId, msg.context_token)
  }
}

function allowSend(toUserId: string): boolean {
  const now = Date.now()
  const windowMs = 60_000
  const limit = 20
  const bucket = (state.rateBuckets.get(toUserId) ?? []).filter((ts) => now - ts < windowMs)
  if (bucket.length >= limit) {
    state.rateBuckets.set(toUserId, bucket)
    return false
  }
  bucket.push(now)
  state.rateBuckets.set(toUserId, bucket)
  return true
}

async function persistCreds(creds: Credentials | null): Promise<void> {
  if (!keytar) return
  if (!creds) {
    try { await keytar.deletePassword(SERVICE, ACCOUNT_DEFAULT) } catch { /* ignore */ }
    return
  }
  await keytar.setPassword(SERVICE, ACCOUNT_DEFAULT, JSON.stringify(creds))
}

async function loadCreds(): Promise<Credentials | null> {
  if (!keytar) return null
  try {
    const raw = await keytar.getPassword(SERVICE, ACCOUNT_DEFAULT)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.token || !parsed?.uin || !parsed?.userId) return null
    return parsed as Credentials
  } catch (err) {
    mainLogger.warn({ err }, 'failed to load wechat credentials')
    return null
  }
}

function startBot(creds: Credentials) {
  clearReconnectTimer()
  if (state.bot) {
    try { state.bot.stop() } catch { /* ignore */ }
    state.bot = null
  }
  state.creds = creds
  state.lastError = null
  const bot = new WeChatIlinkBot(creds)
  state.bot = bot
  bot.on('message', (msg: WeixinMessage) => {
    rememberPeer(msg)
    const text = getMessageText(msg)
    if (!text) return // non-text payloads ignored in v1
    broadcast('wechat:inbound', {
      fromUserId: msg.from_user_id,
      displayName: state.peers.get(msg.from_user_id ?? '')?.displayName ?? null,
      text,
      contextToken: msg.context_token ?? null,
      messageId: msg.message_id ?? null,
      timestampMs: msg.create_time_ms ?? Date.now(),
    })
  })
  bot.on('error', (err: Error) => {
    state.lastError = err.message
    mainLogger.warn({ err }, 'wechat bot transient error')
    emitStatus()
  })
  bot.on('expired', () => {
    state.lastError = 'WeChat session expired — re-pair to continue.'
    mainLogger.warn('wechat session expired')
    void persistCreds(null)
    state.creds = null
    emitStatus()
  })
  bot.on('closed', () => {
    if (state.bot === bot) {
      state.bot = null
      // Unexpected long-poll termination used to leave a paired account
      // permanently offline after its first session. Keep the persisted
      // credentials and reconnect unless the user explicitly disconnected.
      if (state.creds === creds) scheduleReconnect(creds)
    }
    emitStatus()
  })
  bot.start()
  emitStatus()
}

export async function autoResumeBot(): Promise<void> {
  if (state.bot?.isRunning()) return
  const creds = await loadCreds()
  if (!creds) return
  startBot(creds)
}

export function registerWechatIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('wechat:startPairing', async () => {
    try {
      if (state.pairing) state.pairing.cancel()
      const handle = await startQrLogin()
      state.pairing = handle
      handle.done
        .then(async (creds: Credentials) => {
          state.pairing = null
          await persistCreds(creds)
          startBot(creds)
        })
        .catch((err: unknown) => {
          state.pairing = null
          state.lastError = err instanceof Error ? err.message : String(err)
          emitStatus()
        })
      const qrDataUrl = await qrcode.toDataURL(handle.qrPayload, { margin: 1, width: 256 })

      // Write QR to a temp HTML file and open in the default browser so the user
      // can scan it with their WeChat app.
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WeChat Login — SyntaxSenpai</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f0f; color: #e0e0e0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
  }
  .card {
    background: #1a1a1a; border-radius: 12px; padding: 2rem;
    text-align: center; max-width: 320px; width: 90%;
    box-shadow: 0 4px 24px rgba(0,0,0,.5);
  }
  h1 { font-size: 1.3rem; margin-bottom: .5rem; }
  p { font-size: .85rem; color: #999; margin-bottom: 1.2rem; line-height: 1.4; }
  .qr-wrap {
    display: inline-block; background: #fff; border-radius: 8px; padding: 8px;
    margin-bottom: 1rem;
  }
  .qr-wrap img { display: block; width: 240px; height: 240px; }
  .hint {
    font-size: .78rem; color: #777;
    border-top: 1px solid #2a2a2a; padding-top: .8rem; margin-top: .5rem;
  }
</style>
</head>
<body>
<div class="card">
  <h1>SyntaxSenpai &bull; WeChat Login</h1>
  <p>Scan the QR code below with your <strong>WeChat</strong> app to pair your account.</p>
  <div class="qr-wrap"><img src="${qrDataUrl}" alt="WeChat login QR"></div>
  <p>Once scanned, confirm the login on your phone.</p>
  <div class="hint">You can close this page after scanning.</div>
</div>
</body>
</html>`
      const tmpDir = os.tmpdir()
      const filePath = path.join(tmpDir, 'syntax-senpai-wechat-qr.html')
      fs.writeFileSync(filePath, html, 'utf-8')
      shell.openPath(filePath)

      return { success: true, qrDataUrl }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('wechat:cancelPairing', async () => {
    try {
      state.pairing?.cancel()
      state.pairing = null
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('wechat:getStatus', async () => {
    return {
      success: true,
      connected: !!state.bot && state.bot.isRunning(),
      pairing: !!state.pairing,
      account: state.creds
        ? { userId: state.creds.userId, displayName: state.creds.displayName ?? null }
        : null,
      lastError: state.lastError,
    }
  })

  ipcMain.handle('wechat:resume', async () => {
    try {
      await autoResumeBot()
      return {
        success: true,
        connected: !!state.bot && state.bot.isRunning(),
      }
    } catch (err: any) {
      state.lastError = err instanceof Error ? err.message : String(err)
      emitStatus()
      return { success: false, error: state.lastError }
    }
  })

  ipcMain.handle('wechat:disconnect', async () => {
    try {
      clearReconnectTimer()
      state.pairing?.cancel()
      state.pairing = null
      state.bot?.stop()
      state.bot = null
      state.creds = null
      state.lastError = null
      state.peers.clear()
      state.peerContextTokens.clear()
      state.rateBuckets.clear()
      await persistCreds(null)
      emitStatus()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('wechat:listPeers', async () => {
    const peers = [...state.peers.values()]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((p) => ({ userId: p.userId, displayName: p.displayName ?? null, lastSeenAt: p.lastSeenAt }))
    return { success: true, peers }
  })

  ipcMain.handle(
    'wechat:send',
    async (
      _event: unknown,
      payload: {
        toUserId: string
        kind: 'text' | 'image'
        content?: string
        imageBase64?: string
        contextToken?: string | null
      },
    ) => {
      try {
        const bot = state.bot
        if (!bot || !bot.isRunning()) {
          const error = 'WeChat is not connected'
          recordDeliveryFailure(error)
          return { success: false, error }
        }
        if (!payload?.toUserId) {
          const error = 'toUserId is required'
          recordDeliveryFailure(error)
          return { success: false, error }
        }
        if (!allowSend(payload.toUserId)) {
          const error = 'Rate limited: too many sends to this peer (20/min)'
          recordDeliveryFailure(error)
          return { success: false, error }
        }
        // A reply must carry the inbound iLink context token. Prefer the
        // latest token observed by the running bot, but fall back to the
        // renderer's persisted conversation binding after an app restart.
        const ctx =
          state.peerContextTokens.get(payload.toUserId) ??
          payload.contextToken ??
          undefined
        if (payload.kind === 'text') {
          const text = (payload.content ?? '').toString()
          if (!text.trim()) {
            const error = 'content is required'
            recordDeliveryFailure(error)
            return { success: false, error }
          }
          // Only text exceeding iLink's 4,000 character limit is split.
          const { messageId, parts } = await sendTextChunked(bot, payload.toUserId, text, ctx)
          if (parts === 0) {
            const error = 'content is required'
            recordDeliveryFailure(error)
            return { success: false, error }
          }
          state.lastError = null
          emitStatus()
          return { success: true, messageId, parts }
        }
        if (payload.kind === 'image') {
          if (!payload.imageBase64) {
            const error = 'imageBase64 is required'
            recordDeliveryFailure(error)
            return { success: false, error }
          }
          const buf = Buffer.from(stripDataUrlPrefix(payload.imageBase64), 'base64')
          const res = await bot.sendImage(payload.toUserId, buf, ctx)
          state.lastError = null
          emitStatus()
          return { success: true, messageId: res.message_id ?? null }
        }
        const error = `Unknown kind: ${payload.kind}`
        recordDeliveryFailure(error)
        return { success: false, error }
      } catch (err: any) {
        mainLogger.warn({ err }, 'wechat:send failed')
        const error = err instanceof Error ? err.message : String(err)
        recordDeliveryFailure(error)
        if (err instanceof WeChatChunkDeliveryError) {
          return {
            success: false,
            error,
            sentParts: err.sentParts,
            failedPart: err.failedPart,
            totalParts: err.totalParts,
          }
        }
        return { success: false, error }
      }
    },
  )

  // Send several distinct text messages to one peer in order — each is itself
  // chunked to a natural length. Used by the `send_multi_messages` agent tool.
  ipcMain.handle(
    'wechat:sendMulti',
    async (
      _event: unknown,
      payload: {
        toUserId: string
        messages: string[]
        contextToken?: string | null
      },
    ) => {
      try {
        const bot = state.bot
        if (!bot || !bot.isRunning()) {
          const error = 'WeChat is not connected'
          recordDeliveryFailure(error)
          return { success: false, error }
        }
        if (!payload?.toUserId) {
          const error = 'toUserId is required'
          recordDeliveryFailure(error)
          return { success: false, error }
        }
        const rawMessages = Array.isArray(payload?.messages) ? payload.messages : []
        const messages = rawMessages
          .map((m) => (m ?? '').toString().trim())
          .filter(Boolean)
          .slice(0, WECHAT_MAX_MULTI_MESSAGES)
        if (messages.length === 0) {
          const error = 'messages must be a non-empty array of strings'
          recordDeliveryFailure(error)
          return { success: false, error }
        }
        if (!allowSend(payload.toUserId)) {
          const error = 'Rate limited: too many sends to this peer (20/min)'
          recordDeliveryFailure(error)
          return { success: false, error }
        }
        const ctx =
          state.peerContextTokens.get(payload.toUserId) ??
          payload.contextToken ??
          undefined

        let lastMessageId: number | null = null
        let sentMessages = 0
        let sentParts = 0
        for (let i = 0; i < messages.length; i++) {
          try {
            const res = await sendTextChunked(bot, payload.toUserId, messages[i], ctx)
            lastMessageId = res.messageId ?? lastMessageId
            sentParts += res.parts
            sentMessages++
          } catch (err: any) {
            mainLogger.warn(
              { err, message: i + 1, total: messages.length },
              'wechat:sendMulti message failed',
            )
            const error = err instanceof Error ? err.message : String(err)
            recordDeliveryFailure(error)
            return {
              success: false,
              error,
              messageId: lastMessageId,
              messages: sentMessages,
              sentParts,
              failedMessage: i + 1,
              ...(err instanceof WeChatChunkDeliveryError
                ? { failedPart: err.failedPart, totalParts: err.totalParts }
                : {}),
            }
          }
          if (i < messages.length - 1) {
            await new Promise((r) => setTimeout(r, WECHAT_INTER_MESSAGE_DELAY_MS))
          }
        }
        state.lastError = null
        emitStatus()
        return {
          success: true,
          messageId: lastMessageId,
          messages: sentMessages,
          parts: sentParts,
        }
      } catch (err: any) {
        mainLogger.warn({ err }, 'wechat:sendMulti failed')
        const error = err instanceof Error ? err.message : String(err)
        recordDeliveryFailure(error)
        return { success: false, error }
      }
    },
  )
}

function stripDataUrlPrefix(b64: string): string {
  const comma = b64.indexOf(',')
  if (comma === -1) return b64
  if (b64.slice(0, comma).startsWith('data:')) return b64.slice(comma + 1)
  return b64
}

/**
 * Send one logical text message to a peer, split into natural,
 * iLink-sized messages and delivered in order. A partial delivery is an error:
 * callers must never report success when a later portion was dropped.
 */
class WeChatChunkDeliveryError extends Error {
  constructor(
    readonly sentParts: number,
    readonly failedPart: number,
    readonly totalParts: number,
    cause: unknown,
  ) {
    super(`WeChat delivered ${sentParts}/${totalParts} text parts; part ${failedPart} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'WeChatChunkDeliveryError'
  }
}

async function sendTextChunked(
  bot: WeChatIlinkBot,
  toUserId: string,
  text: string,
  ctx: string | undefined,
): Promise<{ messageId: number | null; parts: number }> {
  const chunks = splitIntoNaturalMessages(text)
  let lastMessageId: number | null = null
  let sent = 0
  for (let i = 0; i < chunks.length; i++) {
    try {
      const res = await bot.sendText(toUserId, chunks[i], ctx)
      lastMessageId = res.message_id ?? null
      sent++
    } catch (err: any) {
      mainLogger.warn({ err, part: i + 1, total: chunks.length }, 'wechat send chunk failed')
      throw new WeChatChunkDeliveryError(sent, i + 1, chunks.length, err)
    }
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, WECHAT_INTER_MESSAGE_DELAY_MS))
    }
  }
  return { messageId: lastMessageId, parts: sent }
}

/**
 * Break an assistant reply into natural, conversational-length WeChat
 * messages. WeChat rejects/truncates very long single messages, so a long
 * reply is split on paragraph boundaries first (each paragraph becomes its
 * own message bubble, like real texting), then on sentence boundaries, then
 * hard-wrapped as a last resort. Every returned chunk stays within maxLen so
 * WeChat can actually deliver it.
 */
function splitIntoNaturalMessages(input: string, maxLen = WECHAT_MAX_MESSAGE_CHARS): string[] {
  const text = (input ?? '').toString().trim()
  if (!text) return []

  // Paragraph breaks are intentional conversational beats — each becomes its
  // own bubble, regardless of total length, so replies read like real texting.
  const pieces: string[] = []
  for (const para of text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= maxLen) pieces.push(para)
    else pieces.push(...splitLongBlock(para, maxLen))
  }
  if (pieces.length === 0) return []

  // Safety net against pathological fragmentation: cap the message count and
  // drop the excess tail with a marker — never fold it back into one
  // oversized message (that would re-trigger the "can't receive" bug).
  if (pieces.length > WECHAT_MAX_CHUNKS) {
    const kept = pieces.slice(0, WECHAT_MAX_CHUNKS)
    const lastIdx = kept.length - 1
    const marker = ' …(truncated)'
    const last = kept[lastIdx]
    kept[lastIdx] =
      last.length + marker.length <= maxLen
        ? last + marker
        : last.slice(0, maxLen - marker.length).trimEnd() + marker
    return kept
  }
  return pieces
}

/** Split an over-long paragraph on sentence boundaries, hard-wrapping if needed. */
function splitLongBlock(block: string, maxLen: number): string[] {
  const sentences = block
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (sentence.length > maxLen) {
      if (current) {
        out.push(current)
        current = ''
      }
      out.push(...hardWrap(sentence, maxLen))
      continue
    }
    if (current && current.length + 1 + sentence.length > maxLen) {
      out.push(current)
      current = ''
    }
    current = current ? `${current} ${sentence}` : sentence
  }
  if (current) out.push(current)
  return out
}

/** Last-resort fixed-width wrap, preferring to break at whitespace. */
function hardWrap(s: string, maxLen: number): string[] {
  const out: string[] = []
  let rest = s
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(' ', maxLen)
    if (cut < maxLen * 0.6) cut = maxLen // no decent space — hard cut
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

module.exports = { registerWechatIpc, autoResumeBot }

export {}
