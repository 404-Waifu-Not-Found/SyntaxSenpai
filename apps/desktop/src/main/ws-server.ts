import WebSocket, { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import os from 'os'
import qrcode from 'qrcode'
const { exec } = require('child_process')
const electronModule = require('electron')
const { BrowserWindow } = electronModule
import { AIChatRuntime } from '@syntax-senpai/ai-core'
import * as storage from '@syntax-senpai/storage'
import { buildSystemPrompt, builtInWaifus } from '@syntax-senpai/waifu-core'
import { webSearch } from './agent/executor'
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

interface DesktopRuntimeConfig {
  provider: string
  model: string
  apiKey?: string
}

const KEYLESS_PROVIDERS = new Set(['lmstudio'])

function providerRequiresApiKey(provider: string): boolean {
  return !KEYLESS_PROVIDERS.has(provider)
}

let desktopRuntimeConfig: DesktopRuntimeConfig | null = null

let chatStore: any = null

const MOBILE_STOP_TOOL_NAME = 'stop_response'
const MOBILE_MAX_TOOL_ITERATIONS = 8
const MOBILE_STREAM_CHUNK_SIZE = 32
const MOBILE_AGENT_TOOLS = [
  {
    name: 'terminal',
    description:
      'Run a shell command on the user\'s desktop computer. Supports the real shell, pipes, redirects, ~, $ENV expansion, and normal console workflows. Use this when the user wants you to inspect files, run commands, or operate their computer.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute on the desktop computer.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the public web using DuckDuckGo when current facts or documentation need verification.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to run.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum result count from 1 to 8.',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: MOBILE_STOP_TOOL_NAME,
    description:
      'Call this when you are done using tools and want to send the final response back to the user.',
    parameters: {
      type: 'object',
      properties: {
        final_message: {
          type: 'string',
          description: 'The final answer to send to the mobile user.',
        },
      },
      required: ['final_message'],
    },
  },
]

function getChatStore() {
  if (!chatStore) {
    chatStore = storage.createChatStore('desktop', process.env.CHAT_DB_PATH || undefined) as any
  }
  return chatStore
}

function formatUiTimestamp(date = new Date()): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getMobileConversationSummary(deviceId: string, waifuId: string): string {
  return `mobile:${deviceId}:${waifuId}`
}

function getMobileConversationTitle(deviceName: string, waifuName: string): string {
  return `📱 ${deviceName} · ${waifuName}`
}

function broadcastMobileChatEvent(payload: Record<string, unknown>) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('mobile-chat:event', payload)
    }
  }
}

function getLatestUserMessage(messages: Array<{ id?: string; role?: string; content?: unknown }>) {
  return [...messages].reverse().find((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim()) || null
}

function extractExplicitTerminalCommand(text: string): string | null {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null

  const slashMatch = trimmed.match(/^\/(?:cmd|terminal)\s+([\s\S]+)$/i)
  if (slashMatch?.[1]?.trim()) return slashMatch[1].trim()

  const dollarMatch = trimmed.match(/^\$\s+([\s\S]+)$/)
  if (dollarMatch?.[1]?.trim()) return dollarMatch[1].trim()

  const fencedMatch = trimmed.match(/^```(?:bash|sh|zsh|shell)?\n([\s\S]+?)\n```$/i)
  if (fencedMatch?.[1]?.trim()) return fencedMatch[1].trim()

  const imperativeMatch = trimmed.match(/^(?:run|execute)\s+(?:this\s+)?command\s*:\s*([\s\S]+)$/i)
  if (imperativeMatch?.[1]?.trim()) return imperativeMatch[1].trim()

  return null
}

function formatTerminalCommandResult(command: string, output: string): string {
  const normalizedOutput = String(output || '').trim() || '(no output)'
  return `Executed on your desktop computer:\n$ ${command}\n\n${normalizedOutput}`
}

function chunkTextForStreaming(text: string): string[] {
  if (!text) return ['']
  return text.match(new RegExp(`[\\s\\S]{1,${MOBILE_STREAM_CHUNK_SIZE}}`, 'g')) || [text]
}

function getDesktopSystemPromptBlock() {
  let username = 'user'
  try {
    username = os.userInfo().username
  } catch {
    // ignore lookup failures
  }

  return `\n\n[Desktop Execution Environment]\nYou are running on the user's desktop computer right now.\nOS: ${process.platform}\nUsername: ${username}\nHome directory: ${os.homedir()}\n\nWhen the user asks you to inspect files, run console commands, or operate the computer, you MUST use the terminal tool instead of pretending. You may also use web_search when you need current public information. If you use tools, keep going until you're ready to call stop_response with the final answer.`
}

async function runDesktopTerminalCommand(command: string): Promise<string> {
  const trimmed = String(command || '').trim()
  if (!trimmed) return 'Error: Command cannot be empty.'

  return await new Promise((resolve) => {
    exec(
      trimmed,
      {
        cwd: os.homedir(),
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
        shell: process.env.SHELL || '/bin/zsh',
      },
      (error: any, stdout: string, stderr: string) => {
        let output = stdout || ''
        if (stderr) {
          output += `${output ? '\n' : ''}STDERR: ${stderr}`
        }
        if (!output.trim()) {
          output = `(exit code ${error ? error.code ?? 1 : 0})`
        }
        resolve(output)
      },
    )
  })
}

async function executeMobileToolCall(toolCall: { name: string; arguments?: Record<string, unknown> }) {
  const args = toolCall.arguments || {}

  switch (toolCall.name) {
    case 'terminal':
      return await runDesktopTerminalCommand(String(args.command || ''))
    case 'web_search': {
      const result = await webSearch(String(args.query || ''), Number(args.limit) || 5)
      return result.success ? result.content || 'No search results found.' : `Web search error: ${result.error}`
    }
    default:
      return `Unknown tool: ${toolCall.name}`
  }
}

async function finalizeMobileAssistantResponse(
  socket: WebSocket,
  conversationId: string,
  mobileConversation: { id: string },
  waifuId: string,
  finalMessage: string,
) {
  const assistantId = `mobile-assistant-${Date.now()}`
  const assistantTimestamp = formatUiTimestamp()

  broadcastMobileChatEvent({
    type: 'assistant_start',
    conversationId: mobileConversation.id,
    waifuId,
    messageId: assistantId,
    timestamp: assistantTimestamp,
  })

  for (const delta of chunkTextForStreaming(finalMessage)) {
    const chunkPayload: StreamChunkPayload = {
      conversationId,
      chunk: { type: 'text_delta', delta } as any,
    }
    send(socket, 'stream_chunk', chunkPayload)
    broadcastMobileChatEvent({
      type: 'assistant_chunk',
      conversationId: mobileConversation.id,
      waifuId,
      messageId: assistantId,
      chunk: delta,
    })
  }

  await persistMobileMessage(mobileConversation.id, {
    id: assistantId,
    role: 'assistant',
    content: finalMessage,
    timestamp: assistantTimestamp,
  })

  const endPayload: StreamEndPayload = { conversationId, finalMessage }
  send(socket, 'stream_end', endPayload)
  broadcastMobileChatEvent({
    type: 'assistant_end',
    conversationId: mobileConversation.id,
    waifuId,
    messageId: assistantId,
    finalMessage,
    timestamp: assistantTimestamp,
  })
}

async function ensureMobileConversation(deviceId: string, deviceName: string, waifuId: string, waifuName: string) {
  const store = getChatStore()
  const summary = getMobileConversationSummary(deviceId, waifuId)
  const title = getMobileConversationTitle(deviceName, waifuName)
  const conversations = await store.listConversations()
  let conversation = conversations.find((item: any) => item.summary === summary)

  if (!conversation) {
    conversation = await store.createConversation(waifuId, title)
  }

  await store.updateConversation(conversation.id, {
    title,
    summary,
    favorited: true,
  })

  return {
    ...conversation,
    title,
    summary,
    favorited: true,
  }
}

async function persistMobileMessage(conversationId: string, message: { id: string; role: 'user' | 'assistant'; content: string; timestamp: string }) {
  const store = getChatStore()
  const existingMessages = await store.getMessages(conversationId)
  if (existingMessages.some((entry: any) => entry.id === message.id)) {
    return false
  }

  await store.addMessage(conversationId, message as any)
  return true
}

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
  const payload = msg.payload as AgentRequestPayload
  const { conversationId, messages, waifuId, relationshipSnapshot } = payload
  const providerCfg = (payload as any).providerConfig as { type?: string; apiKey?: string; model?: string } | undefined
  const type = desktopRuntimeConfig?.provider || providerCfg?.type
  const apiKey = desktopRuntimeConfig?.apiKey || providerCfg?.apiKey
  const model = desktopRuntimeConfig?.model || providerCfg?.model

  const waifu = builtInWaifus.find((w: any) => w.id === waifuId) || builtInWaifus[0]
  const activePair = pairedSession?.socket === socket ? pairedSession : null
  const deviceId = activePair?.deviceId || 'mobile-device'
  const deviceName = activePair?.deviceName || 'Mobile Device'
  const mobileConversation = await ensureMobileConversation(deviceId, deviceName, waifu.id, waifu.displayName)
  const userMessage = getLatestUserMessage(messages as Array<{ id?: string; role?: string; content?: unknown }>)

  if (!userMessage || typeof userMessage.content !== 'string' || !userMessage.content.trim()) {
    const errorPayload: StreamErrorPayload = {
      conversationId,
      error: 'Missing user message in mobile request.',
    }
    send(socket, 'stream_error', errorPayload)
    return
  }

  const userTimestamp = formatUiTimestamp()
  const persistedUserMessage = {
    id: userMessage.id || `mobile-user-${Date.now()}`,
    role: 'user' as const,
    content: userMessage.content.trim(),
    timestamp: userTimestamp,
  }

  const userWasStored = await persistMobileMessage(mobileConversation.id, persistedUserMessage)
  if (userWasStored) {
    broadcastMobileChatEvent({
      type: 'user_message',
      conversationId: mobileConversation.id,
      waifuId: waifu.id,
      message: persistedUserMessage,
    })
  }

  const explicitTerminalCommand = extractExplicitTerminalCommand(persistedUserMessage.content)
  if (explicitTerminalCommand) {
    try {
      const commandOutput = await runDesktopTerminalCommand(explicitTerminalCommand)
      await finalizeMobileAssistantResponse(
        socket,
        conversationId,
        mobileConversation,
        waifu.id,
        formatTerminalCommandResult(explicitTerminalCommand, commandOutput),
      )
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorPayload: StreamErrorPayload = {
        conversationId,
        error: errorMessage,
      }
      send(socket, 'stream_error', errorPayload)
    }
    return
  }

  if (!type || !model || (providerRequiresApiKey(type) && !apiKey)) {
    const errorPayload: StreamErrorPayload = {
      conversationId,
      error: 'Desktop AI provider is not configured. Open desktop settings and set a provider, model, and API key. You can still run direct terminal commands with /cmd <command>.',
    }
    send(socket, 'stream_error', errorPayload)
    return
  }

  const storedMessages = await getChatStore().getMessages(mobileConversation.id)
  const normalizedRelationship = relationshipSnapshot && relationshipSnapshot.waifuId === waifu.id
    ? {
        ...relationshipSnapshot,
        userId: relationshipSnapshot.userId || deviceId,
        affectionLevel: relationshipSnapshot.affectionLevel ?? 40,
        selectedAIProvider: type,
        selectedModel: model,
        createdAt: relationshipSnapshot.createdAt || new Date().toISOString(),
        lastInteractedAt: new Date().toISOString(),
      }
    : {
        waifuId: waifu.id,
        userId: deviceId,
        affectionLevel: 40,
        selectedAIProvider: type,
        selectedModel: model,
        createdAt: new Date().toISOString(),
        lastInteractedAt: new Date().toISOString(),
      }

  const systemPrompt = buildSystemPrompt(
    waifu,
    normalizedRelationship,
    {
      userId: normalizedRelationship.userId,
      affectionLevel: normalizedRelationship.affectionLevel,
      platform: 'mobile',
      availableTools: MOBILE_AGENT_TOOLS.map((tool) => tool.name),
    }
  ) + getDesktopSystemPromptBlock()

  const runtime = new AIChatRuntime({
    provider: providerRequiresApiKey(type)
      ? ({ type, apiKey } as any)
      : ({ type } as any),
    model,
    systemPrompt,
  })

  let fullContent = ''
  const aiHistory: any[] = storedMessages
    .filter((message: any) => message.role === 'user' || message.role === 'assistant')
    .map((message: any) => ({
      id: message.id,
      role: message.role,
      content: typeof message.content === 'string' ? message.content : String(message.content ?? ''),
    }))

  try {
    const provider = runtime.getProvider()
    let stopped = false

    for (let iteration = 0; iteration <= MOBILE_MAX_TOOL_ITERATIONS; iteration++) {
      const response = await provider.chat({
        model,
        messages: aiHistory,
        tools: MOBILE_AGENT_TOOLS as any,
        systemPrompt,
      })

      if (!response.toolCalls || response.toolCalls.length === 0) {
        fullContent = response.content || ''
        break
      }

      aiHistory.push({
        id: response.id || `mobile-assistant-${Date.now()}-${iteration}`,
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      })

      for (const toolCall of response.toolCalls as Array<{ id: string; name: string; arguments?: Record<string, unknown> }>) {
        if (toolCall.name === MOBILE_STOP_TOOL_NAME) {
          fullContent = String(toolCall.arguments?.final_message || response.content || '')
          aiHistory.push({
            id: `tool-result-${Date.now()}-${toolCall.id}`,
            role: 'tool',
            content: 'ok',
            toolCallId: toolCall.id,
          })
          stopped = true
          break
        }

        const result = await executeMobileToolCall(toolCall)
        aiHistory.push({
          id: `tool-result-${Date.now()}-${toolCall.id}`,
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
        })
      }

      if (stopped) break

      if (iteration === MOBILE_MAX_TOOL_ITERATIONS) {
        fullContent = '(Reached maximum command iterations — stopping.)'
      }
    }

    const finalMessage = fullContent.trim() || 'Done.'
    await finalizeMobileAssistantResponse(
      socket,
      conversationId,
      mobileConversation,
      waifu.id,
      finalMessage,
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    const errorTimestamp = formatUiTimestamp()
    const errorId = `mobile-assistant-error-${Date.now()}`

    await persistMobileMessage(mobileConversation.id, {
      id: errorId,
      role: 'assistant',
      content: `Error: ${errorMessage}`,
      timestamp: errorTimestamp,
    })

    const errorPayload: StreamErrorPayload = {
      conversationId,
      error: errorMessage,
    }
    send(socket, 'stream_error', errorPayload)
    broadcastMobileChatEvent({
      type: 'assistant_error',
      conversationId: mobileConversation.id,
      waifuId: waifu.id,
      messageId: errorId,
      error: errorMessage,
      timestamp: errorTimestamp,
    })
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

export function setDesktopRuntimeConfig(config: DesktopRuntimeConfig | null): void {
  desktopRuntimeConfig = config && config.provider && config.model && (providerRequiresApiKey(config.provider) ? !!config.apiKey : true)
    ? config
    : null
}
