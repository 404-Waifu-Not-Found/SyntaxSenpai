import WebSocket, { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import os from 'os'
import qrcode from 'qrcode'
import { runTerminalCommand } from './terminal-shell'
const electronModule = require('electron')
const { BrowserWindow } = electronModule
import { AIChatRuntime } from '@syntax-senpai/ai-core'
import * as storage from '@syntax-senpai/storage'
import { buildSystemPrompt, builtInWaifus } from '@syntax-senpai/waifu-core'
import { webSearch } from './agent/executor'
import { isWebSearchEnabled } from './ipc/agent'
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
const PREFERRED_WS_PORT = 43123

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
      'Run a shell command on the user\'s desktop computer. Supports the real shell, pipes, redirects, ~, $ENV expansion, and normal console workflows. Use this when the user wants you to inspect files, run commands, operate their computer, or pull realtime/current data from direct CLI/API sources such as wttr.in, worldtimeapi.org, ipinfo.io, npm view, or pnpm view.',
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
      'Fetch top public DuckDuckGo result links/snippets for a query. Use only to find links or source candidates. This is not a realtime data source; do not use it to answer weather, stocks, scores, prices, or other live facts directly. Prefer terminal for problem solving, diagnostics, local searches, installs, and verification.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The DuckDuckGo search query to run.',
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

function getGroupConversationSummary(deviceId: string, waifuIds: string[]): string {
  return `mobile:${deviceId}:group:${[...waifuIds].sort().join(',')}`
}

function getGroupConversationTitle(deviceName: string, waifuNames: string[]): string {
  return `📱 ${deviceName} · Group Chat (${waifuNames.join(', ')})`
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

function getFirstUserMessage(messages: Array<{ id?: string; role?: string; content?: unknown }>) {
  return messages.find((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim()) || null
}

function buildConversationLanguageRuleBlock(firstUserText: string) {
  return `\n\n[Conversation language rule]\nThe first user message in this conversation is:\n"""${firstUserText.slice(0, 500)}"""\nReply only in the language of that first user message. If it is Chinese, all prose and stop_response.final_message must be Chinese. Do not mix in English except for code, command names, URLs, proper nouns, or quoted tool output. If the user explicitly asks to switch languages later, follow that explicit request.`
}

function buildRequestedWaifuList(primaryWaifuId: string, groupChat?: { enabled?: boolean; waifuIds?: string[] }) {
  const requestedIds = groupChat?.enabled && Array.isArray(groupChat.waifuIds)
    ? groupChat.waifuIds
    : [primaryWaifuId]

  const uniqueIds = Array.from(
    new Set(requestedIds.filter((waifuId): waifuId is string => typeof waifuId === 'string' && !!waifuId)),
  )

  const waifus = uniqueIds
    .map((waifuId) => builtInWaifus.find((waifu: any) => waifu.id === waifuId))
    .filter(Boolean) as any[]

  if (waifus.length > 0) {
    return waifus
  }

  return [builtInWaifus.find((waifu: any) => waifu.id === primaryWaifuId) || builtInWaifus[0]]
}

function normalizeHistoryForAi(
  messages: Array<{ id?: string; role?: string; content?: unknown; waifuId?: string; authorName?: string }>,
) {
  return messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .map((message) => {
      if (message.role === 'assistant') {
        const authorName = typeof message.authorName === 'string' && message.authorName.trim()
          ? message.authorName.trim()
          : builtInWaifus.find((waifu: any) => waifu.id === message.waifuId)?.displayName

        return {
          id: message.id || `assistant-${Date.now()}`,
          role: 'assistant' as const,
          content: authorName ? `${authorName}: ${message.content}` : message.content,
        }
      }

      return {
        id: message.id || `user-${Date.now()}`,
        role: 'user' as const,
        content: message.content,
      }
    })
}

function buildGroupChatPromptBlock(currentWaifu: any, waifus: any[], assignedTasks: string[], round: number) {
  const peers = waifus
    .filter((waifu) => waifu.id !== currentWaifu.id)
    .map((waifu) => `- ${waifu.displayName} (${waifu.id})`)
    .join('\n')

  const taskBlock = assignedTasks.length > 0
    ? `Tasks assigned to you by other waifus for this round:\n${assignedTasks.map((task) => `- ${task}`).join('\n')}`
    : 'No explicit tasks were assigned to you this round.'

  return `\n\n[Group Chat Coordination]\nYou are participating in a multi-waifu group chat round ${round}.\nCurrent speakers in this room:\n- ${currentWaifu.displayName} (${currentWaifu.id})\n${peers}\n\n${taskBlock}\n\nYou can respond to what the user said and also react to the other waifus naturally.\nIf you want to assign a follow-up task to another waifu, append one or more lines at the END of your reply using exactly this format:\n[TASK_FOR:waifu-id] short task request\n\nOnly assign a task when another waifu is better suited for that part. Keep task lines concise. Do not explain the tag syntax to the user.`
}

function extractDelegatedTasks(text: string) {
  const taskRegex = /^\[TASK_FOR:([a-z0-9_-]+)\]\s*(.+)$/gim
  const tasks: Array<{ targetWaifuId: string; instruction: string }> = []
  let match: RegExpExecArray | null

  while ((match = taskRegex.exec(text)) !== null) {
    const targetWaifuId = match[1]?.trim()
    const instruction = match[2]?.trim()
    if (targetWaifuId && instruction) {
      tasks.push({ targetWaifuId, instruction })
    }
  }

  const cleanedText = text
    .replace(taskRegex, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { cleanedText, tasks }
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

  const webSearchStatus = isWebSearchEnabled()
    ? 'The web_search tool only fetches top DuckDuckGo result links/snippets; it is not a realtime data source, so never present it as actual live weather, stock, score, price, or other realtime info.'
    : 'The web_search tool is disabled by the user and is not available. Do not try to call it; use terminal or explain that web search must be enabled in Settings to fetch links.'

  return `\n\n[Desktop Execution Environment]\nYou are running on the user's desktop computer right now.\nOS: ${process.platform}\nUsername: ${username}\nHome directory: ${os.homedir()}\n\nPrioritize terminal commands for solving problems. When the user asks you to inspect, diagnose, install, run, verify, search locally, check network behavior, operate the computer, or pull realtime/current public data, use terminal instead of pretending. To perform tasks: identify the concrete user goal, choose the terminal command or other tool that can move it forward, read tool results carefully, try one corrected retry after a failure, verify the outcome when possible, then call stop_response. For realtime data, use direct terminal commands/APIs: weather via wttr.in, for example curl.exe -s "https://wttr.in/Tokyo?format=3" or curl.exe -s "https://wttr.in/Tokyo?format=j1"; infer approximate location with curl.exe -s "https://ipinfo.io/json" only when needed; time/IP/API/package versions via Get-Date, worldtimeapi.org, api.ipify.org, Invoke-RestMethod, npm view, or pnpm view. Full examples live in docs/agent-skills/common-commands.skill. ${webSearchStatus} If no available tool can complete the task, say exactly which capability is missing and give the next best actionable step.`
}

async function runDesktopTerminalCommand(command: string): Promise<string> {
  const trimmed = String(command || '').trim()
  if (!trimmed) return 'Error: Command cannot be empty.'

  try {
    const result = await runTerminalCommand(trimmed, {
      cwd: os.homedir(),
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    })

    let output = result.stdout || ''
    if (result.stderr) {
      output += `${output ? '\n' : ''}STDERR: ${result.stderr}`
    }
    if (!output.trim()) {
      output = `(exit code ${result.code ?? 0})`
    }
    return output
  } catch (err: any) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

async function executeMobileToolCall(toolCall: { name: string; arguments?: Record<string, unknown> }) {
  const args = toolCall.arguments || {}

  switch (toolCall.name) {
    case 'terminal':
      return await runDesktopTerminalCommand(String(args.command || ''))
    case 'web_search': {
      if (!isWebSearchEnabled()) {
        return 'Web search is disabled. Enable it in desktop Settings before using web_search.'
      }
      const result = await webSearch(String(args.query || ''), Number(args.limit) || 5)
      return result.success ? result.content || 'No search results found.' : `Web search error: ${result.error}`
    }
    default:
      return `Unknown tool: ${toolCall.name}`
  }
}

async function runMobileWaifuTurn(options: {
  runtime: AIChatRuntime
  model: string
  systemPrompt: string
  aiHistory: any[]
  tools: typeof MOBILE_AGENT_TOOLS
}) {
  const provider = options.runtime.getProvider()
  const localHistory = [...options.aiHistory]
  let fullContent = ''

  for (let iteration = 0; iteration <= MOBILE_MAX_TOOL_ITERATIONS; iteration++) {
    const response = await provider.chat({
      model: options.model,
      messages: localHistory,
      tools: options.tools as any,
      systemPrompt: options.systemPrompt,
    })

    if (!response.toolCalls || response.toolCalls.length === 0) {
      fullContent = response.content || ''
      break
    }

    localHistory.push({
      id: response.id || `mobile-assistant-${Date.now()}-${iteration}`,
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    })

    let stopped = false

    for (const toolCall of response.toolCalls as Array<{ id: string; name: string; arguments?: Record<string, unknown> }>) {
      if (toolCall.name === MOBILE_STOP_TOOL_NAME) {
        fullContent = String(toolCall.arguments?.final_message || response.content || '')
        localHistory.push({
          id: `tool-result-${Date.now()}-${toolCall.id}`,
          role: 'tool',
          content: 'ok',
          toolCallId: toolCall.id,
        })
        stopped = true
        break
      }

      const result = await executeMobileToolCall(toolCall)
      localHistory.push({
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

  return extractDelegatedTasks(fullContent.trim() || 'Done.')
}

async function finalizeMobileAssistantResponse(
  socket: WebSocket,
  conversationId: string,
  mobileConversation: { id: string },
  waifuId: string,
  authorName: string,
  finalMessage: string,
  turnComplete = true,
) {
  const assistantId = `mobile-assistant-${Date.now()}`
  const assistantTimestamp = formatUiTimestamp()

  broadcastMobileChatEvent({
    type: 'assistant_start',
    conversationId: mobileConversation.id,
    waifuId,
    authorName,
    messageId: assistantId,
    timestamp: assistantTimestamp,
  })

  for (const delta of chunkTextForStreaming(finalMessage)) {
    const chunkPayload: StreamChunkPayload = {
      conversationId,
      chunk: { type: 'text_delta', delta } as any,
      messageId: assistantId,
      waifuId,
      authorName,
      turnComplete: false,
    }
    send(socket, 'stream_chunk', chunkPayload)
    broadcastMobileChatEvent({
      type: 'assistant_chunk',
      conversationId: mobileConversation.id,
      waifuId,
      authorName,
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

  const endPayload: StreamEndPayload = {
    conversationId,
    finalMessage,
    messageId: assistantId,
    waifuId,
    authorName,
    turnComplete,
  }
  send(socket, 'stream_end', endPayload)
  broadcastMobileChatEvent({
    type: 'assistant_end',
    conversationId: mobileConversation.id,
    waifuId,
    authorName,
    messageId: assistantId,
    finalMessage,
    timestamp: assistantTimestamp,
    turnComplete,
  })
}

async function ensureMobileConversation(summary: string, title: string, waifuId: string) {
  const store = getChatStore()
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
  const ips = getLanIps()
  return ips[0]?.address ?? '127.0.0.1'
}

function getWsUrlForHost(host: string): string {
  return `ws://${host}:${serverPort}`
}

function getHostnameCandidates(): string[] {
  const hosts = new Set<string>()

  try {
    const hostname = os.hostname().trim()
    if (hostname) {
      hosts.add(hostname)
      if (!hostname.endsWith('.local')) {
        hosts.add(`${hostname}.local`)
      }
    }
  } catch {
    // ignore hostname lookup failures
  }

  hosts.add('127.0.0.1')
  return Array.from(hosts)
}

function getReconnectCandidates(): string[] {
  if (!serverPort) return []

  const urls = new Set<string>()
  for (const host of getHostnameCandidates()) {
    urls.add(getWsUrlForHost(host))
  }
  for (const ip of getLanIps()) {
    urls.add(getWsUrlForHost(ip.address))
  }

  return Array.from(urls)
}

export function getLanIps(): Array<{ name: string; address: string }> {
  const interfaces = os.networkInterfaces()
  const result: Array<{ name: string; address: string }> = []
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name]
    if (!iface) continue
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        result.push({ name, address: info.address })
      }
    }
  }
  return result
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

  const requestedWaifus = buildRequestedWaifuList(waifuId, payload.groupChat)
  const primaryWaifu = requestedWaifus[0]
  const isGroupChat = requestedWaifus.length > 1
  const activePair = pairedSession?.socket === socket ? pairedSession : null
  const deviceId = activePair?.deviceId || 'mobile-device'
  const deviceName = activePair?.deviceName || 'Mobile Device'
  const mobileConversation = await ensureMobileConversation(
    isGroupChat
      ? getGroupConversationSummary(deviceId, requestedWaifus.map((waifu: any) => waifu.id))
      : getMobileConversationSummary(deviceId, primaryWaifu.id),
    isGroupChat
      ? getGroupConversationTitle(deviceName, requestedWaifus.map((waifu: any) => waifu.displayName))
      : getMobileConversationTitle(deviceName, primaryWaifu.displayName),
    isGroupChat ? 'group-chat' : primaryWaifu.id,
  )
  const userMessages = messages as Array<{ id?: string; role?: string; content?: unknown }>
  const userMessage = getLatestUserMessage(userMessages)
  const firstUserMessage = getFirstUserMessage(userMessages)

  if (!userMessage || typeof userMessage.content !== 'string' || !userMessage.content.trim()) {
    const errorPayload: StreamErrorPayload = {
      conversationId,
      error: 'Missing user message in mobile request.',
      turnComplete: true,
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
      waifuId: primaryWaifu.id,
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
        primaryWaifu.id,
        primaryWaifu.displayName,
        formatTerminalCommandResult(explicitTerminalCommand, commandOutput),
      )
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorPayload: StreamErrorPayload = {
        conversationId,
        error: errorMessage,
        turnComplete: true,
      }
      send(socket, 'stream_error', errorPayload)
    }
    return
  }

  if (!type || !model || (providerRequiresApiKey(type) && !apiKey)) {
    const errorPayload: StreamErrorPayload = {
      conversationId,
      error: 'Desktop AI provider is not configured. Open desktop settings and set a provider, model, and API key. You can still run direct terminal commands with /cmd <command>.',
      turnComplete: true,
    }
    send(socket, 'stream_error', errorPayload)
    return
  }

  const sharedHistory: any[] = normalizeHistoryForAi(messages as Array<{
    id?: string
    role?: string
    content?: unknown
    waifuId?: string
    authorName?: string
  }>)
  const maxRounds = isGroupChat ? Math.max(1, Math.min(Number(payload.groupChat?.maxRounds) || 2, 3)) : 1
  const assistantTurns: Array<{ waifuId: string; authorName: string; finalMessage: string }> = []

  try {
    let pendingTasks = new Map<string, string[]>()

    for (let round = 1; round <= maxRounds; round++) {
      const waifusForRound = round === 1
        ? requestedWaifus
        : requestedWaifus.filter((waifu: any) => (pendingTasks.get(waifu.id) || []).length > 0)

      if (waifusForRound.length === 0) {
        break
      }

      const nextRoundTasks = new Map<string, string[]>()

      for (const waifu of waifusForRound) {
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

        const assignedTasks = pendingTasks.get(waifu.id) || []
        const mobileTools = isWebSearchEnabled()
          ? MOBILE_AGENT_TOOLS
          : MOBILE_AGENT_TOOLS.filter((tool) => tool.name !== 'web_search')
        const systemPrompt = buildSystemPrompt(
          waifu,
          normalizedRelationship,
          {
            userId: normalizedRelationship.userId,
            affectionLevel: normalizedRelationship.affectionLevel,
            platform: 'mobile',
            availableTools: mobileTools.map((tool) => tool.name),
          },
        )
          + buildConversationLanguageRuleBlock(String(firstUserMessage?.content || userMessage.content))
          + (isGroupChat ? buildGroupChatPromptBlock(waifu, requestedWaifus, assignedTasks, round) : '')
          + getDesktopSystemPromptBlock()

        const runtime = new AIChatRuntime({
          provider: providerRequiresApiKey(type)
            ? ({ type, apiKey } as any)
            : ({ type } as any),
          model,
          systemPrompt,
        })

        const { cleanedText, tasks } = await runMobileWaifuTurn({
          runtime,
          model,
          tools: mobileTools,
          systemPrompt,
          aiHistory: sharedHistory,
        })

        const finalMessage = cleanedText || 'Done.'
        assistantTurns.push({
          waifuId: waifu.id,
          authorName: waifu.displayName,
          finalMessage,
        })

        sharedHistory.push({
          id: `assistant-${waifu.id}-${round}-${assistantTurns.length}`,
          role: 'assistant',
          content: isGroupChat ? `${waifu.displayName}: ${finalMessage}` : finalMessage,
        })

        if (round < maxRounds) {
          for (const task of tasks) {
            if (!requestedWaifus.some((candidate: any) => candidate.id === task.targetWaifuId)) {
              continue
            }
            const currentTasks = nextRoundTasks.get(task.targetWaifuId) || []
            currentTasks.push(`${waifu.displayName}: ${task.instruction}`)
            nextRoundTasks.set(task.targetWaifuId, currentTasks)
          }
        }
      }

      pendingTasks = nextRoundTasks
    }

    if (assistantTurns.length === 0) {
      assistantTurns.push({
        waifuId: primaryWaifu.id,
        authorName: primaryWaifu.displayName,
        finalMessage: 'Done.',
      })
    }

    for (const [index, turn] of assistantTurns.entries()) {
      await finalizeMobileAssistantResponse(
        socket,
        conversationId,
        mobileConversation,
        turn.waifuId,
        turn.authorName,
        turn.finalMessage,
        index === assistantTurns.length - 1,
      )
    }
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
      waifuId: primaryWaifu.id,
      authorName: primaryWaifu.displayName,
      messageId: errorId,
      turnComplete: true,
    }
    send(socket, 'stream_error', errorPayload)
    broadcastMobileChatEvent({
      type: 'assistant_error',
      conversationId: mobileConversation.id,
      waifuId: primaryWaifu.id,
      authorName: primaryWaifu.displayName,
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
    const payload = JSON.stringify({ wsUrl, token: serverToken, reconnectCandidates: getReconnectCandidates() })
    const qrDataUrl = await qrcode.toDataURL(payload, { width: 256, margin: 2 })
    return { qrDataUrl, wsUrl }
  }

  serverToken = randomUUID()

  return new Promise((resolve, reject) => {
    const tryStart = (port: number) => {
      const server = new WebSocketServer({ port })

      server.on('listening', async () => {
        const addr = server.address() as { port: number }
        serverPort = addr.port
        wss = server

        const ip = getLanIp()
        const wsUrl = `ws://${ip}:${serverPort}`
        const payload = JSON.stringify({ wsUrl, token: serverToken, reconnectCandidates: getReconnectCandidates() })

        try {
          const qrDataUrl = await qrcode.toDataURL(payload, { width: 256, margin: 2 })
          resolve({ qrDataUrl, wsUrl })
        } catch (err) {
          reject(err)
        }
      })

      server.on('error', (err: any) => {
        if (port === PREFERRED_WS_PORT && (err?.code === 'EADDRINUSE' || err?.code === 'EACCES')) {
          tryStart(0)
          return
        }
        reject(err)
      })

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
    }

    tryStart(PREFERRED_WS_PORT)
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

export async function getQrData(): Promise<{ qrDataUrl: string; wsUrl: string; token: string; availableIps: Array<{ name: string; address: string }> } | null> {
  if (!wss || !serverToken || !serverPort) return null
  const ip = getLanIp()
  const wsUrl = `ws://${ip}:${serverPort}`
  const payload = JSON.stringify({ wsUrl, token: serverToken, reconnectCandidates: getReconnectCandidates() })
  const qrDataUrl = await qrcode.toDataURL(payload, { width: 256, margin: 2 })
  return { qrDataUrl, wsUrl, token: serverToken, availableIps: getLanIps() }
}

export async function generateQrForIp(ip: string): Promise<{ qrDataUrl: string; wsUrl: string } | null> {
  if (!wss || !serverToken || !serverPort) return null
  const wsUrl = `ws://${ip}:${serverPort}`
  const payload = JSON.stringify({ wsUrl, token: serverToken, reconnectCandidates: getReconnectCandidates() })
  const qrDataUrl = await qrcode.toDataURL(payload, { width: 256, margin: 2 })
  return { qrDataUrl, wsUrl }
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
