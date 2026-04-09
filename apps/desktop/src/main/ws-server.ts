import WebSocket, { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import os from 'os'
import qrcode from 'qrcode'
import { AIChatRuntime } from '@syntax-senpai/ai-core'
import { buildSystemPrompt, builtInWaifus } from '@syntax-senpai/waifu-core'
import type {
  WSMessage,
  PairRequestPayload,
  PairAcceptedPayload,
  AgentRequestPayload,
  StreamChunkPayload,
  StreamEndPayload,
  StreamErrorPayload,
} from '@syntax-senpai/ws-protocol'

let wss: WebSocketServer | null = null
let serverToken: string | null = null
let serverPort: number | null = null

interface PairedSession {
  sessionId: string
  deviceName: string
  deviceId: string
  socket: WebSocket
}
let pairedSession: PairedSession | null = null

function getLanIp(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name]
    if (!iface) continue
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address
      }
    }
  }
  return '127.0.0.1'
}

function send(socket: WebSocket, type: string, payload: unknown) {
  const msg: WSMessage = {
    id: randomUUID(),
    type: type as any,
    payload,
    timestamp: Date.now(),
  }
  socket.send(JSON.stringify(msg))
}

async function handleAgentRequest(socket: WebSocket, msg: WSMessage<AgentRequestPayload>) {
  const { conversationId, messages, waifuId, providerConfig } = msg.payload
  const { type, apiKey, model } = providerConfig

  const waifu = builtInWaifus.find((w) => w.id === waifuId) || builtInWaifus[0]
  const systemPrompt = buildSystemPrompt(
    waifu,
    {
      waifuId: waifu.id,
      userId: 'desktop-proxy',
      affectionLevel: 40,
      selectedAIProvider: type,
      selectedModel: model,
      createdAt: new Date().toISOString(),
      lastInteractedAt: new Date().toISOString(),
    },
    {
      userId: 'desktop-proxy',
      affectionLevel: 40,
      platform: 'mobile',
      availableTools: [],
    }
  )

  const runtime = new AIChatRuntime({
    provider: { type, apiKey } as any,
    model,
    systemPrompt,
  })

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
  const history = messages.filter((m) => m !== lastUserMessage)

  let fullContent = ''

  try {
    for await (const chunk of runtime.streamMessage({
      text: lastUserMessage?.content || '',
      history,
    })) {
      if (chunk.type === 'text_delta' && chunk.delta) {
        fullContent += chunk.delta
        const chunkPayload: StreamChunkPayload = { conversationId, chunk }
        send(socket, 'stream_chunk', chunkPayload)
      }
    }

    const endPayload: StreamEndPayload = { conversationId, finalMessage: fullContent }
    send(socket, 'stream_end', endPayload)
  } catch (err) {
    const errorPayload: StreamErrorPayload = {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    }
    send(socket, 'stream_error', errorPayload)
  }
}

export async function startWsServer(): Promise<{ qrDataUrl: string; wsUrl: string }> {
  if (wss) {
    const ip = getLanIp()
    const wsUrl = `ws://${ip}:${serverPort}`
    const payload = JSON.stringify({ wsUrl, token: serverToken })
    const qrDataUrl = await qrcode.toDataURL(payload, { width: 256, margin: 2 })
    return { qrDataUrl, wsUrl }
  }

  serverToken = randomUUID()

  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ port: 0 })

    server.on('listening', async () => {
      const addr = server.address() as { port: number }
      serverPort = addr.port
      wss = server

      const ip = getLanIp()
      const wsUrl = `ws://${ip}:${serverPort}`
      const payload = JSON.stringify({ wsUrl, token: serverToken })

      try {
        const qrDataUrl = await qrcode.toDataURL(payload, { width: 256, margin: 2 })
        resolve({ qrDataUrl, wsUrl })
      } catch (err) {
        reject(err)
      }
    })

    server.on('error', reject)

    server.on('connection', (socket) => {
      socket.on('message', async (raw) => {
        let msg: WSMessage
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }

        if (msg.type === 'ping') {
          send(socket, 'pong', {})
          return
        }

        if (msg.type === 'pair_request') {
          const pr = msg as WSMessage<PairRequestPayload>
          if (pr.payload.deviceId && serverToken) {
            // Accept any device that knows the token (token is embedded in QR)
            const sessionId = randomUUID()
            pairedSession = {
              sessionId,
              deviceName: pr.payload.deviceName || 'Mobile Device',
              deviceId: pr.payload.deviceId,
              socket,
            }
            const accepted: PairAcceptedPayload = {
              deviceId: pr.payload.deviceId,
              sessionId,
              publicKey: '',
            }
            send(socket, 'pair_accepted', accepted)
          } else {
            send(socket, 'pair_rejected', { reason: 'Invalid token' })
          }
          return
        }

        if (msg.type === 'agent_request') {
          if (!pairedSession || pairedSession.socket !== socket) {
            send(socket, 'error', { code: 'NOT_PAIRED', message: 'Not paired' })
            return
          }
          await handleAgentRequest(socket, msg as WSMessage<AgentRequestPayload>)
          return
        }
      })

      socket.on('close', () => {
        if (pairedSession?.socket === socket) {
          pairedSession = null
        }
      })
    })
  })
}

export function stopWsServer(): void {
  if (wss) {
    wss.close()
    wss = null
    serverToken = null
    serverPort = null
    pairedSession = null
  }
}

export async function getQrData(): Promise<{ qrDataUrl: string; wsUrl: string; token: string } | null> {
  if (!wss || !serverToken || !serverPort) return null
  const ip = getLanIp()
  const wsUrl = `ws://${ip}:${serverPort}`
  const payload = JSON.stringify({ wsUrl, token: serverToken })
  const qrDataUrl = await qrcode.toDataURL(payload, { width: 256, margin: 2 })
  return { qrDataUrl, wsUrl, token: serverToken }
}

export function getPairingStatus(): { paired: boolean; deviceName?: string; sessionId?: string } {
  if (!pairedSession) return { paired: false }
  return {
    paired: true,
    deviceName: pairedSession.deviceName,
    sessionId: pairedSession.sessionId,
  }
}
