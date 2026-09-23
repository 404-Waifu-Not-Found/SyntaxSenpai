import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRuntimeFromEnv } from '@syntax-senpai/ai-core/dist/runtime.js'
import type { ChatResponse } from '@syntax-senpai/ai-core/dist/types.js'
import type { ProviderChatCaller } from '@syntax-senpai/ai-core/dist/agent-run.js'
import { buildAgentSessionPrompt } from '@syntax-senpai/agent-session/dist/prompt.js'
import { runAgentSession } from '@syntax-senpai/agent-session/dist/index.js'
import { agentTools } from '@syntax-senpai/agent-tools/dist/catalog.js'
import { builtInWaifus, type Waifu } from '@syntax-senpai/waifu-core/dist/index.js'
import { gameMoveLabel } from '@syntax-senpai/game-engine/dist/index.js'
import { createHeadlessHost, isHeadlessToolAvailable } from './host.js'

interface TurnRequest {
  type: 'turn'
  conversationId?: string
  text: string
  attachments?: Array<{ url: string; mimeType?: string; name?: string }>
  provider?: string
  model?: string
  waifuId?: string
  systemPrompt?: string
  cachedSystemPrompt?: string
  maxIterations?: number
  webSearchEnabled?: boolean
  codingMode?: boolean
  responses?: ChatResponse[]
  includeHistory?: boolean
}

interface HumanMoveRequest extends Omit<TurnRequest, 'type' | 'text' | 'attachments'> {
  type: 'human_move'
  move: string
}

type InputRequest = TurnRequest | HumanMoveRequest

interface ConversationState {
  history: any[]
  host: ReturnType<typeof createHeadlessHost>
}

const conversations = new Map<string, ConversationState>()

function output(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function diagnostic(message: string) {
  process.stderr.write(`[headless] ${message}\n`)
}

function resolveWaifu(id?: string): Waifu {
  return builtInWaifus.find((waifu) => waifu.id === id) || builtInWaifus[0]
}

function createScriptedCaller(responses: ChatResponse[]): ProviderChatCaller {
  let index = 0
  return async (_request) => {
    if (index >= responses.length) throw new Error('Scripted provider responses exhausted.')
    return responses[index++]
  }
}

function validateScriptedResponses(request: { responses?: ChatResponse[] }) {
  if ('responses' in request && (!Array.isArray(request.responses) || request.responses.length === 0)) {
    throw new Error('responses must contain at least one scripted provider reply; omit responses to use a live provider.')
  }
}

function selectTools(request: TurnRequest) {
  return agentTools.filter((tool) => {
    if (!isHeadlessToolAvailable(tool.name)) return false
    if (tool.name === 'web_search') return request.webSearchEnabled === true
    if (['git_commit', 'git_push', 'github_pr_create'].includes(tool.name)) return request.codingMode === true
    return true
  })
}

export async function runTurn(request: TurnRequest, emit: (event: unknown) => void = output) {
  const id = request.conversationId || 'default'
  const current = conversations.get(id) || { history: [], host: createHeadlessHost() }
  const text = String(request.text || '').trim()
  if (!text) throw new Error('turn.text must be a non-empty string.')
  validateScriptedResponses(request)

  const providerName = request.provider || process.env.SYNTAX_SENPAI_PROVIDER || 'anthropic'
  const model = request.model || process.env.SYNTAX_SENPAI_MODEL || 'claude-3-5-sonnet-20241022'
  const waifu = resolveWaifu(request.waifuId)
  const userMessage = {
    id: `user-${randomUUID()}`,
    role: 'user',
    content: request.attachments?.length
      ? [{ type: 'text', text }, ...request.attachments.map((attachment) => ({ type: 'image_url', imageUrl: { url: attachment.url } }))]
      : text,
  }
  // Keep a failed provider setup or turn out of subsequent conversation history.
  const history = [...current.history, userMessage]
  const previousHistoryLength = current.history.length
  const previousEffectsLength = current.host.state.effects.length

  const runtime = request.responses?.length
    ? null
    : createRuntimeFromEnv({ provider: providerName as any, model, maxToolIterations: request.maxIterations || 8 })
  const provider = runtime?.getProvider()
  const callProvider = request.responses?.length
    ? createScriptedCaller(request.responses)
    : async (providerRequest: Parameters<ProviderChatCaller>[0]) => provider!.chat(providerRequest as any)

  const systemPrompt = request.systemPrompt || buildAgentSessionPrompt({
    waifu,
    provider: providerName,
    model,
    affection: 50,
    firstUserText: text,
    environment: 'You are running in a headless SyntaxSenpai test/runtime process. UI-only effects are emitted as events, but the user-visible response and tool results must remain unchanged.',
  })
  const tools = selectTools(request)
  const availableNames = new Set(tools.map((tool) => tool.name))
  const result = await runAgentSession({
    callProvider,
    model,
    history,
    tools,
    systemPrompt,
    cachedSystemPrompt: request.cachedSystemPrompt,
    maxIterations: request.maxIterations || 8,
    maxParallelTools: 8,
    host: {
      ...current.host,
      executeTool: (call) => availableNames.has(call.name)
        ? current.host.executeTool(call)
        : Promise.resolve(`Error: ${call.name} is not available for this headless turn.`),
      handleSideEffect: (call) => availableNames.has(call.name)
        ? current.host.handleSideEffect?.(call) ?? null
        : { resultContent: `Error: ${call.name} is not available for this headless turn.` },
    },
    onEvent: emit,
  })
  current.history = history
  conversations.set(id, current)
  return {
    conversationId: id,
    response: result.finalContent,
    messages: result.finalMessages || (result.finalContent ? [result.finalContent] : []),
    history,
    effects: current.host.state.effects,
    newMessages: history.slice(previousHistoryLength),
    newEffects: current.host.state.effects.slice(previousEffectsLength),
    events: result.events,
  }
}

export async function runHumanMove(request: HumanMoveRequest, emit: (event: unknown) => void = output) {
  const id = request.conversationId || 'default'
  const current = conversations.get(id)
  if (!current) throw new Error('No minigame is currently open for this conversation.')
  const move = String(request.move || '').trim()
  if (!move) throw new Error('human_move.move must be a non-empty move.')
  validateScriptedResponses(request)
  const previousEffectsLength = current.host.state.effects.length
  const { humanSnapshot, snapshot, agentMove } = current.host.playHumanMove(move)
  emit({ type: 'game_event', action: 'human_move', conversationId: id, snapshot: humanSnapshot })
  if (agentMove) emit({ type: 'game_event', action: 'agent_move', conversationId: id, move: agentMove, snapshot })
  const label = gameMoveLabel(snapshot.kind, move)
  const text = `[Minigame event] The user just played ${label} in ${snapshot.kind}. ` +
    `The built-in engine has already replied when it was the agent's turn. ` +
    `The authoritative current game state is ${JSON.stringify(snapshot)}. ` +
    `Do not invent a board or move, and do not call game_move for this turn. ` +
    `Make a brief in-character remark about the position or, if the game is over, the result.`
  try {
    const result = await runTurn({ ...request, type: 'turn', text }, emit)
    return { ...result, gameSnapshot: snapshot, agentMove, newEffects: current.host.state.effects.slice(previousEffectsLength) }
  } catch (error) {
    // The authoritative move already happened. Do not report the whole input
    // as failed and invite a client to replay an illegal duplicate move.
    return {
      conversationId: id,
      response: '',
      messages: [],
      history: current.history,
      effects: current.host.state.effects,
      newMessages: [],
      newEffects: current.host.state.effects.slice(previousEffectsLength),
      events: [],
      gameSnapshot: snapshot,
      agentMove,
      commentaryError: error instanceof Error ? error.message : String(error),
    }
  }
}

function outputResponse(request: InputRequest, result: Awaited<ReturnType<typeof runTurn>> | Awaited<ReturnType<typeof runHumanMove>>, emit: (event: unknown) => void) {
  const { events: _events, history: _history, effects: _effects, ...response } = result
  emit({ type: 'response', ...response, ...(request.includeHistory ? { history: _history, effects: _effects } : {}) })
}

export async function handleInputLine(line: string, emit: (event: unknown) => void = output) {
  try {
    const request = JSON.parse(line) as InputRequest
    if (request.type === 'turn') outputResponse(request, await runTurn(request, emit), emit)
    else if (request.type === 'human_move') outputResponse(request, await runHumanMove(request, emit), emit)
    else throw new Error('Only {"type":"turn"} and {"type":"human_move"} requests are supported.')
  } catch (error) {
    emit({ type: 'request_error', error: error instanceof Error ? error.message : String(error) })
  }
}

async function main() {
  diagnostic('ready; send JSONL turn objects on stdin')
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    if (!line.trim()) continue
    await handleInputLine(line)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main()
}
