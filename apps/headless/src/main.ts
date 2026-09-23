import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createRuntimeFromEnv } from '@syntax-senpai/ai-core/dist/runtime.js'
import type { ChatResponse } from '@syntax-senpai/ai-core/dist/types.js'
import type { ProviderChatCaller } from '@syntax-senpai/ai-core/dist/agent-run.js'
import { buildAgentSessionPrompt } from '@syntax-senpai/agent-session/dist/prompt.js'
import { runAgentSession } from '@syntax-senpai/agent-session/dist/index.js'
import { agentTools } from '@syntax-senpai/agent-tools/dist/catalog.js'
import { builtInWaifus, type Waifu } from '@syntax-senpai/waifu-core/dist/index.js'
import { createHeadlessHost } from './host.js'

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
}

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
  return async (_request) => responses[index++] || { id: `scripted-${index}`, content: 'Scripted provider responses exhausted.', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' }
}

function selectTools(request: TurnRequest) {
  return agentTools.filter((tool) => {
    if (tool.name === 'web_search') return request.webSearchEnabled === true
    if (['git_commit', 'git_push', 'github_pr_create'].includes(tool.name)) return request.codingMode === true
    return true
  })
}

export async function runTurn(request: TurnRequest, emit: (event: unknown) => void = output) {
  const id = request.conversationId || 'default'
  const current = conversations.get(id) || { history: [], host: createHeadlessHost() }
  conversations.set(id, current)
  const text = String(request.text || '').trim()
  if (!text) throw new Error('turn.text must be a non-empty string.')

  const providerName = request.provider || process.env.SYNTAX_SENPAI_PROVIDER || 'anthropic'
  const model = request.model || process.env.SYNTAX_SENPAI_MODEL || 'claude-3-5-sonnet-20241022'
  const waifu = resolveWaifu(request.waifuId)
  const userMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: request.attachments?.length
      ? [{ type: 'text', text }, ...request.attachments.map((attachment) => ({ type: 'image_url', imageUrl: { url: attachment.url } }))]
      : text,
  }
  current.history.push(userMessage)

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
  const result = await runAgentSession({
    callProvider,
    model,
    history: current.history,
    tools,
    systemPrompt,
    cachedSystemPrompt: request.cachedSystemPrompt,
    maxIterations: request.maxIterations || 8,
    maxParallelTools: 8,
    host: current.host,
    onEvent: emit,
  })
  return { conversationId: id, response: result.finalContent, messages: result.finalMessages || (result.finalContent ? [result.finalContent] : []), history: current.history, effects: current.host.state.effects, events: result.events }
}

async function main() {
  diagnostic('ready; send JSONL turn objects on stdin')
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    if (!line.trim()) continue
    try {
      const request = JSON.parse(line) as TurnRequest
      if (request.type !== 'turn') throw new Error('Only {"type":"turn"} requests are supported.')
      const result = await runTurn(request, output)
      const { events: _events, ...response } = result
      output({ type: 'response', ...response })
    } catch (error) {
      output({ type: 'request_error', error: error instanceof Error ? error.message : String(error) })
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main()
}
