/**
 * Shared agent-turn runner.
 *
 * Both the single-chat loop and the group-chat loop in `stores/chat.ts`
 * call this. Subagents (see `subagent-runner.ts`) reuse it too with a
 * worker system prompt and a filtered toolset. Keeping the loop in one
 * place means iteration budgeting, abort handling, and tool-result
 * annotation can never drift between call sites.
 */

import type { ToolCall, ToolDefinition } from './types'
import { ResourceScheduler } from './scheduler'
import type { DescribeToolExecution } from './agent-contracts'

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
  scheduler?: ResourceScheduler
  describeExecution?: DescribeToolExecution
  prepareContext?: (history: any[]) => Promise<void>

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

export function canExecuteToolInParallel(tc: ToolCall): boolean {
  return ['read_file', 'glob', 'grep', 'list', 'webfetch', 'web_search', 'git_status', 'git_diff', 'lsp_hover', 'lsp_diagnostics'].includes(tc.name)
}
export function annotateToolResult(result: string, iteration: number, maxIterations: number): string {
  return iteration + 1 >= maxIterations ? result + '\n[runtime] Tool budget exhausted. Report what was verified and what remains.' : result
}
export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  const scheduler = opts.scheduler || new ResourceScheduler(opts.maxParallelTools ?? 8)
  const failures = new Map<string, number>()
  let finalContent = '', stopped = false, iterations = 0, reachedMaxIterations = false
  const max = Math.max(0, opts.maxIterations)
  for (let i = 0; i <= max; i++) {
    if (opts.abortSignal?.aborted) { stopped = true; break }
    await opts.prepareContext?.(opts.history)
    opts.onIteration?.(i)
    opts.onAssistantIterationStart?.(i)
    const start = Date.now()
    const response = await opts.callProvider({ model: opts.model, messages: opts.history, tools: i === max ? [] : opts.tools,
      systemPrompt: opts.systemPrompt, cachedSystemPrompt: opts.cachedSystemPrompt, cacheBreakpointIndex: opts.cacheBreakpointIndex,
      signal: opts.abortSignal, onTextDelta: d => opts.onAssistantTextDelta?.(d, i), onReasoningDelta: d => opts.onAssistantReasoningDelta?.(d, i) })
    iterations++
    opts.onApiRoundTrip?.(Date.now() - start, response)
    opts.onAssistantIterationEnd?.(i, response)
    const calls: ToolCall[] = response.toolCalls || []
    opts.history.push({ id: response.id || `assistant-${Date.now()}-${i}`, role: 'assistant', content: response.content || '', toolCalls: calls.length ? calls : undefined, reasoningContent: response.reasoningContent })
    if (!calls.length) { finalContent = response.content || ''; reachedMaxIterations = i === max; break }
    const append = (tc: ToolCall, result: string) => {
      opts.history.push({ id: `result-${tc.id}`, role: 'tool', toolCallId: tc.id, content: annotateToolResult(result, i, max) })
    }
    if (i === max) {
      calls.forEach(tc => append(tc, 'Not executed: tool budget exhausted.'))
      reachedMaxIterations = true
      finalContent = response.content || 'Task incomplete: execution budget exhausted.'
      break
    }
    // UI/state tools form barriers. Generic calls in a segment are scheduled together.
    let batch: ToolCall[] = []
    const flush = async () => {
      const queued = batch; batch = []
      const results = await Promise.all(queued.map(tc => scheduler.schedule(
        opts.describeExecution?.(tc) || { access: canExecuteToolInParallel(tc) ? 'read' : 'write', resources: ['*'], lane: tc.name === 'terminal' ? 'process' : 'tool' },
        async () => {
          if (opts.abortSignal?.aborted) return 'Cancelled before execution.'
          const fingerprint = JSON.stringify([tc.name, Object.entries(tc.arguments || {}).sort()])
          if ((failures.get(fingerprint) || 0) >= 3) return 'Error: repeated unchanged failure. Change the approach or report the blocker.'
          const token = opts.onToolStart?.(tc)
          let result: string
          try { result = await opts.executeTool(tc) } catch (e) { result = `Error: ${e instanceof Error ? e.message : String(e)}` }
          if (/^(Error:|EXIT [1-9]|.* error:|BLOCKED)/i.test(result)) failures.set(fingerprint, (failures.get(fingerprint) || 0) + 1)
          else failures.delete(fingerprint)
          opts.onToolResult?.(tc, result, token)
          return result
        }, opts.abortSignal).catch(e => `Cancelled: ${e instanceof Error ? e.message : String(e)}`)))
      queued.forEach((tc, n) => append(tc, results[n]))
      // Images follow the complete group of tool results, preserving provider protocol.
      queued.forEach(tc => { const followups = opts.collectFollowupMessages?.(tc); if (followups) opts.history.push(...followups) })
    }
    const stateTools = new Set(['stop_response', 'set_affection', 'set_expression', 'todo_write', 'todoread', 'rename_chat', 'render_card', 'dispatch_subagents'])
    for (const tc of calls) {
      if (stopped || opts.abortSignal?.aborted) { await flush(); append(tc, 'Cancelled before execution.'); stopped = true; continue }
      if (!stateTools.has(tc.name)) { batch.push(tc); continue }
      await flush()
      let effect: SideEffectResult | null | undefined
      try { effect = await opts.handleSideEffect?.(tc) }
      catch (error) {
        const result = `${opts.abortSignal?.aborted ? 'Cancelled' : 'Error'}: ${error instanceof Error ? error.message : String(error)}`
        append(tc, result); opts.onToolResult?.(tc, result, undefined); continue
      }
      if (!effect) { batch.push(tc); continue }
      append(tc, effect.resultContent)
      if (effect.stop) { finalContent = effect.finalContent ?? response.content ?? ''; stopped = true }
    }
    await flush()
    if (stopped) break
  }
  return { finalContent, iterations, stopped: stopped || !!opts.abortSignal?.aborted, reachedMaxIterations }
}
