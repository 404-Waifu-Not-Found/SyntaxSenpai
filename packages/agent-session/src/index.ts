import type {
  ProviderChatCaller,
  ProviderChatRequest,
  RunAgentTurnOptions,
  RunAgentTurnResult,
  SideEffectResult,
  ToolCall,
  ToolDefinition,
} from '@syntax-senpai/ai-core'
import { runAgentTurn } from '@syntax-senpai/ai-core'

export * from './prompt'
export * from './conversation-title'

export type AgentSessionEvent =
  | { type: 'turn_start'; historyLength: number }
  | { type: 'iteration_start'; iteration: number }
  | { type: 'assistant_text_delta'; iteration: number; delta: string }
  | { type: 'assistant_reasoning_delta'; iteration: number; delta: string }
  | { type: 'assistant_iteration_end'; iteration: number; response: unknown }
  | { type: 'tool_start'; toolCall: ToolCall; token?: string }
  | { type: 'tool_result'; toolCall: ToolCall; result: string; token?: string }
  | { type: 'game_event'; action: 'start' | 'move' | 'state'; toolCall: ToolCall; result: string }
  | { type: 'side_effect'; toolCall: ToolCall; result: SideEffectResult }
  | { type: 'conversation_renamed'; title: string; automatic: boolean }
  | { type: 'turn_complete'; result: RunAgentTurnResult }
  | { type: 'turn_error'; error: string }

export interface AgentSessionEnvironment {
  cwd?: string
  platform?: string
  shell?: string
  homeDirectory?: string
  username?: string
  [key: string]: unknown
}

export interface AgentSessionConversationHost {
  getTitle?: () => string | undefined | Promise<string | undefined>
  rename?: (title: string) => void | Promise<void>
  ensureAutomaticTitle?: (input: { firstUserText: string; currentTitle?: string }) => string | undefined | Promise<string | undefined>
}

export interface AgentSessionEffectsHost {
  onExpression?: (expression: string) => void | Promise<void>
  onAffection?: (value: number) => void | Promise<void>
  onTodo?: (items: unknown[]) => void | Promise<void>
  onCard?: (payload: unknown) => void | Promise<void>
  onGameEvent?: (event: unknown) => void | Promise<void>
}

export interface AgentSessionGameHost {
  start?: (arguments_: Record<string, unknown>) => Promise<string>
  move?: (arguments_: Record<string, unknown>) => Promise<string>
  state?: () => Promise<string>
}

export interface AgentSessionBrowserHost {
  execute: (toolCall: ToolCall) => Promise<string>
}

export interface AgentSessionHost {
  callProvider?: ProviderChatCaller
  executeTool: (toolCall: ToolCall) => Promise<string>
  handleSideEffect?: RunAgentTurnOptions['handleSideEffect']
  describeExecution?: RunAgentTurnOptions['describeExecution']
  prepareContext?: RunAgentTurnOptions['prepareContext']
  collectFollowupMessages?: RunAgentTurnOptions['collectFollowupMessages']
  onToolStart?: RunAgentTurnOptions['onToolStart']
  onToolResult?: RunAgentTurnOptions['onToolResult']
  conversation?: AgentSessionConversationHost
  effects?: AgentSessionEffectsHost
  game?: AgentSessionGameHost
  browser?: AgentSessionBrowserHost
  environment?: AgentSessionEnvironment
}

export interface AgentSessionOptions {
  callProvider?: ProviderChatCaller
  model: string
  history: any[]
  tools: ToolDefinition[]
  systemPrompt: string
  cachedSystemPrompt?: string
  cacheBreakpointIndex?: number
  maxIterations: number
  abortSignal?: AbortSignal
  depth?: number
  maxParallelTools?: number
  scheduler?: RunAgentTurnOptions['scheduler']
  executeTool?: RunAgentTurnOptions['executeTool']
  handleSideEffect?: RunAgentTurnOptions['handleSideEffect']
  describeExecution?: RunAgentTurnOptions['describeExecution']
  prepareContext?: RunAgentTurnOptions['prepareContext']
  collectFollowupMessages?: RunAgentTurnOptions['collectFollowupMessages']
  onToolStart?: RunAgentTurnOptions['onToolStart']
  onToolResult?: RunAgentTurnOptions['onToolResult']
  onAssistantTextDelta?: RunAgentTurnOptions['onAssistantTextDelta']
  onAssistantReasoningDelta?: RunAgentTurnOptions['onAssistantReasoningDelta']
  onAssistantIterationStart?: RunAgentTurnOptions['onAssistantIterationStart']
  onAssistantIterationEnd?: RunAgentTurnOptions['onAssistantIterationEnd']
  onIteration?: RunAgentTurnOptions['onIteration']
  host?: AgentSessionHost
  onEvent?: (event: AgentSessionEvent) => void
  onApiRoundTrip?: RunAgentTurnOptions['onApiRoundTrip']
}

export interface AgentSessionResult extends RunAgentTurnResult {
  events: AgentSessionEvent[]
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function firstUserText(history: any[]): string | undefined {
  const message = history.find((item) => item?.role === 'user')
  if (!message) return undefined
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('\n') || undefined
  }
  return undefined
}

/**
 * Canonical orchestration boundary shared by Electron and headless callers.
 * The tool loop lives in ai-core; this adapter adds the stable event stream,
 * shared naming hook, and environment-specific effect injection.
 */
export async function runAgentSession(options: AgentSessionOptions): Promise<AgentSessionResult> {
  const events: AgentSessionEvent[] = []
  const emit = (event: AgentSessionEvent) => {
    events.push(event)
    options.onEvent?.(event)
  }
  const host = options.host
  const callProvider = host?.callProvider || options.callProvider
  if (!callProvider) throw new Error('AgentSession requires a provider caller.')

  emit({ type: 'turn_start', historyLength: options.history.length })
  try {
    const firstText = firstUserText(options.history)
    if (firstText && host?.conversation?.ensureAutomaticTitle) {
      const title = await host.conversation.ensureAutomaticTitle({
        firstUserText: firstText,
        currentTitle: await host.conversation.getTitle?.(),
      })
      if (title) {
        await host.conversation.rename?.(title)
        emit({ type: 'conversation_renamed', title, automatic: true })
      }
    }

    const result = await runAgentTurn({
      callProvider,
      model: options.model,
      history: options.history,
      tools: options.tools,
      systemPrompt: options.systemPrompt,
      cachedSystemPrompt: options.cachedSystemPrompt,
      cacheBreakpointIndex: options.cacheBreakpointIndex,
      maxIterations: options.maxIterations,
      abortSignal: options.abortSignal,
      depth: options.depth,
      scheduler: options.scheduler,
      maxParallelTools: options.maxParallelTools,
      prepareContext: host?.prepareContext || options.prepareContext,
      describeExecution: host?.describeExecution || options.describeExecution,
      handleSideEffect: async (toolCall) => {
        let sideEffect: SideEffectResult | null = null
        try {
          sideEffect = await (host?.handleSideEffect || options.handleSideEffect)?.(toolCall) ?? null
        } catch (error) {
          sideEffect = { resultContent: `Error: ${errorText(error)}` }
        }
        if (sideEffect) emit({ type: 'side_effect', toolCall, result: sideEffect })
        return sideEffect
      },
      executeTool: async (toolCall) => {
        const executeTool = host?.executeTool || options.executeTool
        if (!executeTool) throw new Error(`No executor configured for ${toolCall.name}.`)
        return executeTool(toolCall)
      },
      onToolStart: (toolCall) => {
        const token = (host?.onToolStart || options.onToolStart)?.(toolCall)
        emit({ type: 'tool_start', toolCall, token })
        return token
      },
      onToolResult: (toolCall, resultText, token) => {
        ;(host?.onToolResult || options.onToolResult)?.(toolCall, resultText, token)
        emit({ type: 'tool_result', toolCall, result: resultText, token })
        if (toolCall.name === 'game_start' || toolCall.name === 'game_move' || toolCall.name === 'game_state') {
          emit({
            type: 'game_event',
            action: toolCall.name === 'game_start' ? 'start' : toolCall.name === 'game_move' ? 'move' : 'state',
            toolCall,
            result: resultText,
          })
        }
      },
      collectFollowupMessages: host?.collectFollowupMessages || options.collectFollowupMessages,
      onApiRoundTrip: options.onApiRoundTrip,
      onIteration: (iteration) => {
        options.onIteration?.(iteration)
        emit({ type: 'iteration_start', iteration })
      },
      onAssistantTextDelta: (delta, iteration) => {
        options.onAssistantTextDelta?.(delta, iteration)
        emit({ type: 'assistant_text_delta', iteration, delta })
      },
      onAssistantReasoningDelta: (delta, iteration) => {
        options.onAssistantReasoningDelta?.(delta, iteration)
        emit({ type: 'assistant_reasoning_delta', iteration, delta })
      },
      onAssistantIterationStart: (iteration) => options.onAssistantIterationStart?.(iteration),
      onAssistantIterationEnd: (iteration, response) => {
        options.onAssistantIterationEnd?.(iteration, response)
        emit({ type: 'assistant_iteration_end', iteration, response })
      },
    })
    emit({ type: 'turn_complete', result })
    return { ...result, events }
  } catch (error) {
    emit({ type: 'turn_error', error: errorText(error) })
    throw error
  }
}

export type { ProviderChatCaller, ProviderChatRequest, RunAgentTurnResult, SideEffectResult, ToolCall, ToolDefinition }
