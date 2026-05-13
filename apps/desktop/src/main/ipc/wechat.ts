/**
 * WeChat (iLink) IPC bridge — mirrors the shape of `ipc/ws.ts`.
 *
 * Owns the live bot session: handles QR pairing, persists credentials in
 * keytar under the dedicated `syntax-senpai-wechat` service, runs the
 * long-poll loop, and broadcasts inbound messages + status changes to
 * every renderer window.
 */

const { ipcMain, BrowserWindow } = require('electron')
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
    if (state.bot === bot) state.bot = null
    emitStatus()
  })
  bot.start()
  emitStatus()
}

export async function autoResumeBot(): Promise<void> {
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
      return { success: true, qrPayload: handle.qrPayload }
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

  ipcMain.handle('wechat:disconnect', async () => {
    try {
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
        if (!state.bot || !state.bot.isRunning()) {
          return { success: false, error: 'WeChat is not connected' }
        }
        if (!payload?.toUserId) {
          return { success: false, error: 'toUserId is required' }
        }
        if (!allowSend(payload.toUserId)) {
          return { success: false, error: 'Rate limited: too many sends to this peer (20/min)' }
        }
        const ctx =
          payload.contextToken ??
          state.peerContextTokens.get(payload.toUserId) ??
          undefined
        if (payload.kind === 'text') {
          const text = (payload.content ?? '').toString()
          if (!text.trim()) return { success: false, error: 'content is required' }
          const res = await state.bot.sendText(payload.toUserId, text, ctx)
          return { success: true, messageId: res.message_id ?? null }
        }
        if (payload.kind === 'image') {
          if (!payload.imageBase64) return { success: false, error: 'imageBase64 is required' }
          const buf = Buffer.from(stripDataUrlPrefix(payload.imageBase64), 'base64')
          const res = await state.bot.sendImage(payload.toUserId, buf, ctx)
          return { success: true, messageId: res.message_id ?? null }
        }
        return { success: false, error: `Unknown kind: ${payload.kind}` }
      } catch (err: any) {
        mainLogger.warn({ err }, 'wechat:send failed')
        return { success: false, error: err instanceof Error ? err.message : String(err) }
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

module.exports = { registerWechatIpc, autoResumeBot }

export {}
