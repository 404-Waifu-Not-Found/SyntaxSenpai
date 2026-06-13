/**
 * Shared agent-turn runner.
 *
 * Both the single-chat loop and the group-chat loop in `stores/chat.ts`
 * call this. Subagents (see `subagent-runner.ts`) reuse it too with a
 * worker system prompt and a filtered toolset. Keeping the loop in one
 * place means iteration budgeting, abort handling, and tool-result
 * annotation can never drift between call sites.
 */

import type { ToolCall, ToolDefinition } from '@syntax-senpai/ai-core'

export interface ProviderChatRequest {
  model: string
  messages: any[]
  tools: ToolDefinition[]
  systemPrompt: string
  cachedSystemPrompt?: string
  cacheBreakpointIndex?: number
  signal?: AbortSignal
  /**
   * Optional streaming hooks. When the caller's implementation streams (e.g.
   * provider.stream() rather than provider.chat()), these fire as deltas
   * arrive so the UI can update a live assistant bubble before the full
   * response — including any tool_calls — is assembled.
   */
  onTextDelta?: (delta: string) => void
  onReasoningDelta?: (delta: string) => void
}

export type ProviderChatCaller = (req: ProviderChatRequest) => Promise<any>

export interface SideEffectResult {
  /** Content pushed back to the model as the `role: 'tool'` reply. */
  resultContent: string
  /** When true, finalize the loop after this tool. */
  stop?: boolean
  /** Final assistant text when `stop` is true. Defaults to current content. */
  finalContent?: string
}

export interface RunAgentTurnOptions {
  callProvider: ProviderChatCaller
  model: string
  /** Mutable history; the runner appends assistant + tool messages in place. */
  history: any[]
  tools: ToolDefinition[]
  systemPrompt: string
  cachedSystemPrompt?: string
  cacheBreakpointIndex?: number
  maxIterations: number
  abortSignal?: AbortSignal
  /** 0 = parent. Subagents pass 1; reserved for Phase 5 recursion guard. */
  depth?: number

  /** Intercept side-effect tools (stop_response, set_affection, todo_write, …). May be async. */
  handleSideEffect?: (tc: ToolCall) => Promise<SideEffectResult | null> | SideEffectResult | null

  /** Generic tool dispatcher — the executor that actually runs read_file/etc. */
  executeTool: (tc: ToolCall) => Promise<string>

  /** Maximum number of independent tool calls to execute at once. */
  maxParallelTools?: number

  /** Optional UI hook fired before a generic tool runs. May return a token. */
  onToolStart?: (tc: ToolCall) => string | undefined
  /** Optional UI hook fired after a generic tool resolves. */
  onToolResult?: (tc: ToolCall, result: string, token: string | undefined) => void

  /**
   * Called after a generic tool's result message is appended. Any returned
   * messages are appended right after it — used for multimodal payloads that
   * can't ride in a string tool result (e.g. browser_screenshot images,
   * which providers only accept as user-role image_url parts).
   */
  collectFollowupMessages?: (tc: ToolCall) => any[] | null | undefined

  /** Telemetry hook for each provider round-trip. */
  onApiRoundTrip?: (durationMs: number, response: any) => void
  /** Telemetry hook fired at the start of every iteration. */
  onIteration?: (iteration: number) => void

  /**
   * Streaming callbacks. Forwarded to callProvider via the request object
   * so a streaming implementation can pipe deltas as they arrive.
   * `iteration` is 0-indexed and corresponds to the loop iteration.
   */
  onAssistantTextDelta?: (delta: string, iteration: number) => void
  onAssistantReasoningDelta?: (delta: string, iteration: number) => void
  /** Fired right before each provider round-trip starts. */
  onAssistantIterationStart?: (iteration: number) => void
  /** Fired after each provider round-trip resolves. */
  onAssistantIterationEnd?: (iteration: number, response: any) => void
}

export interface RunAgentTurnResult {
  /** Final assistant text. Empty string if loop never produced one. */
  finalContent: string
  /** Number of provider round-trips actually performed. */
  iterations: number
  /** True if the loop was halted by stop_response or abort. */
  stopped: boolean
  /** True if the loop ran out of iterations before stopping. */
  reachedMaxIterations: boolean
}

const PARALLEL_TOOL_NAMES = new Set([
  'terminal',
  'read_file',
  'glob',
  'grep',
  'list',
  'webfetch',
  'web_search',
  'lsp_diagnostics',
  'lsp_hover',
])

export function canExecuteToolInParallel(tc: ToolCall): boolean {
  return PARALLEL_TOOL_NAMES.has(tc.name)
}

export function annotateToolResult(result: string, iteration: number, maxIterations: number): string {
  const remaining = Math.max(0, maxIterations - iteration)
  if (remaining <= 0) {
    return `${result}\n\n[runtime] This was your LAST tool iteration. You MUST call stop_response in your next reply.`
  }
  if (remaining <= 2) {
    return `${result}\n\n[runtime] ${remaining} tool iteration${remaining === 1 ? '' : 's'} left — wrap up and call stop_response soon.`
  }
  return result
}

export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  const {
    callProvider,
    model,
    history,
    tools,
    systemPrompt,
    cachedSystemPrompt,
    cacheBreakpointIndex,
    maxIterations,
    abortSignal,
    handleSideEffect,
    executeTool,
    maxParallelTools = 8,
    onToolStart,
    onToolResult,
    collectFollowupMessages,
    onApiRoundTrip,
    onIteration,
    onAssistantTextDelta,
    onAssistantReasoningDelta,
    onAssistantIterationStart,
    onAssistantIterationEnd,
  } = opts

  let finalContent = ''
  let stopped = false
  let reachedMaxIterations = false
  let iterationsRun = 0

  for (let i = 0; i <= maxIterations; i++) {
    onIteration?.(i)
    if (abortSignal?.aborted) {
      stopped = true
      break
    }

    iterationsRun = i + 1
    const requestStartedAt = performance.now()
    onAssistantIterationStart?.(i)
    const response = await callProvider({
      model,
      messages: history,
      tools,
      systemPrompt,
      cachedSystemPrompt,
      cacheBreakpointIndex,
      signal: abortSignal,
      onTextDelta: onAssistantTextDelta
        ? (delta) => onAssistantTextDelta(delta, i)
        : undefined,
      onReasoningDelta: onAssistantReasoningDelta
        ? (delta) => onAssistantReasoningDelta(delta, i)
        : undefined,
    })
    onApiRoundTrip?.(performance.now() - requestStartedAt, response)
    onAssistantIterationEnd?.(i, response)

    if (!response.toolCalls || response.toolCalls.length === 0) {
      finalContent = response.content || ''
      break
    }

    // `reasoningContent` must be echoed back on DeepSeek reasoner models —
    // they 400 with "reasoning_content in the thinking mode must be passed
    // back to the API" otherwise.
    history.push({
      id: response.id || `assistant-tc-${Date.now()}`,
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
      reasoningContent: (response as any).reasoningContent,
    })

    const executeGenericTool = async (tc: ToolCall) => {
      const token = onToolStart?.(tc)
      const result = await executeTool(tc)
      onToolResult?.(tc, result, token)
      return { tc, result }
    }

    const appendGenericToolResult = (tc: ToolCall, result: string) => {
      history.push({
        id: `tool-result-${Date.now()}-${tc.id}`,
        role: 'tool',
        content: annotateToolResult(result, i, maxIterations),
        toolCallId: tc.id,
      })

      const followups = collectFollowupMessages?.(tc)
      if (followups && followups.length > 0) history.push(...followups)
    }

    for (let callIndex = 0; callIndex < response.toolCalls.length;) {
      const tc = response.toolCalls[callIndex]

      if (canExecuteToolInParallel(tc)) {
        const parallelCalls: ToolCall[] = []
        while (
          callIndex < response.toolCalls.length &&
          parallelCalls.length < Math.max(1, maxParallelTools) &&
          canExecuteToolInParallel(response.toolCalls[callIndex])
        ) {
          parallelCalls.push(response.toolCalls[callIndex])
          callIndex += 1
        }

        const results = await Promise.all(parallelCalls.map(executeGenericTool))
        for (const completed of results) {
          appendGenericToolResult(completed.tc, completed.result)
        }
        continue
      }

      callIndex += 1
      const sideEffect = handleSideEffect ? await handleSideEffect(tc) : null
      if (sideEffect) {
        history.push({
          id: `tool-result-${Date.now()}-${tc.id}`,
          role: 'tool',
          content: sideEffect.resultContent,
          toolCallId: tc.id,
        })
        if (sideEffect.stop) {
          if (sideEffect.finalContent !== undefined) finalContent = sideEffect.finalContent
          stopped = true
          break
        }
        continue
      }

      const completed = await executeGenericTool(tc)
      appendGenericToolResult(completed.tc, completed.result)
    }

    if (stopped) break

    if (i === maxIterations) {
      reachedMaxIterations = true
      finalContent = '(Reached maximum iterations — stopping.)'
    }
  }

  return { finalContent, iterations: iterationsRun, stopped, reachedMaxIterations }
}
