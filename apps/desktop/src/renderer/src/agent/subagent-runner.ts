/**
 * Subagent fan-out runner.
 *
 * `dispatchSubagents` spawns 1-8 short-lived worker agents in parallel,
 * each handling one slice of a repetitive task and returning a free-form
 * final message. Workers are persona-less; they reuse the parent's
 * provider/model and the parent's mode-filtered tools (minus denylisted
 * ones that mutate parent chat state). Results are aggregated into a
 * single string the parent agent reads as a normal tool result.
 */

import type { AgentTraceEvent, ToolCall, ToolDefinition } from '@syntax-senpai/ai-core'
import {
  STOP_TOOL_NAME,
  SET_AFFECTION_TOOL_NAME,
  RENAME_CHAT_TOOL_NAME,
  TODO_WRITE_TOOL_NAME,
  RENDER_CARD_TOOL_NAME,
  PROPOSE_TOOL_TOOL_NAME,
  CREATE_SKILL_TOOL_NAME,
  DISPATCH_SUBAGENTS_TOOL_NAME,
} from '../agent-tools'
import { runAgentTurn, type ProviderChatCaller, type SideEffectResult } from './run-turn'

export const SUBAGENT_DEFAULT_MAX_ITERATIONS = 6
export const SUBAGENT_DEFAULT_CONCURRENCY = 4
export const SUBAGENT_MAX_COUNT = 8
export const SUBAGENT_MIN_ITERATIONS = 3
export const SUBAGENT_HARD_MAX_ITERATIONS = 12
export const SUBAGENT_MIN_CONCURRENCY = 1
export const SUBAGENT_HARD_MAX_CONCURRENCY = 8

export const SUBAGENT_MAX_ITERATIONS_STORAGE_KEY = 'syntax-senpai-subagent-max-iterations'
export const SUBAGENT_CONCURRENCY_STORAGE_KEY = 'syntax-senpai-subagent-concurrency'

const FINAL_MESSAGE_TRUNCATION_LIMIT = 4000

/** Tools never given to subagents, regardless of parent mode. */
export const SUBAGENT_TOOL_DENYLIST: ReadonlySet<string> = new Set<string>([
  DISPATCH_SUBAGENTS_TOOL_NAME,
  SET_AFFECTION_TOOL_NAME,
  RENAME_CHAT_TOOL_NAME,
  TODO_WRITE_TOOL_NAME,
  RENDER_CARD_TOOL_NAME,
  PROPOSE_TOOL_TOOL_NAME,
  CREATE_SKILL_TOOL_NAME,
])

export interface SubagentSpec {
  name?: string
  task: string
}

export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'

export interface SubagentToolCallSnapshot {
  name: string
  ok: boolean
}

export interface SubagentSnapshot {
  id: string
  index: number
  name: string
  task: string
  status: SubagentStatus
  iterations: number
  maxIterations: number
  startedAt: number | null
  endedAt: number | null
  toolCalls: SubagentToolCallSnapshot[]
  finalMessage: string
  errorMessage?: string
}

export interface DispatchSubagentsOptions {
  rationale?: string
  subagents: SubagentSpec[]
  /** Mode-filtered tools the parent has. Will be filtered again through the subagent denylist. */
  parentTools: ToolDefinition[]
  /** Provider call wrapper (typically the chat store's `callProviderChat`). */
  callProvider: ProviderChatCaller
  /** Parent's selected model. */
  model: string
  /** Working directory hint for the worker prompt. */
  cwd?: string
  /** Parent's iteration budget — used for the per-turn cost cap. */
  parentMaxIterations: number
  /** Per-subagent iteration cap (overrides localStorage). */
  subagentMaxIterations?: number
  /** Concurrency cap (overrides localStorage). */
  concurrency?: number
  /** Hard ceiling for subagent count (default `SUBAGENT_MAX_COUNT`). */
  maxCount?: number
  /** Parent's abort signal. Forwarded to every subagent. */
  abortSignal?: AbortSignal
  /** Live UI hook fired whenever any snapshot changes. */
  onSnapshot?: (snapshots: readonly SubagentSnapshot[]) => void
  /** Generic tool executor (typically `executeToolCall` from agent-tools). */
  executeTool: (tc: ToolCall) => Promise<string>
  /** Optional trace handler for subagent_dispatch_start/end + subagent_start/end events. */
  onTrace?: (event: AgentTraceEvent) => void
}

export interface DispatchSubagentsResult {
  /** Aggregated string handed back to the parent as the tool result. */
  aggregateResult: string
  /** Final per-subagent snapshots. */
  snapshots: SubagentSnapshot[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function safeNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function loadSetting(key: string, fallback: number): number {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return safeNumber(raw, fallback)
  } catch {
    return fallback
  }
}

export function getSubagentDefaults(): { maxIterations: number; concurrency: number } {
  return {
    maxIterations: clamp(
      Math.round(loadSetting(SUBAGENT_MAX_ITERATIONS_STORAGE_KEY, SUBAGENT_DEFAULT_MAX_ITERATIONS)),
      SUBAGENT_MIN_ITERATIONS,
      SUBAGENT_HARD_MAX_ITERATIONS,
    ),
    concurrency: clamp(
      Math.round(loadSetting(SUBAGENT_CONCURRENCY_STORAGE_KEY, SUBAGENT_DEFAULT_CONCURRENCY)),
      SUBAGENT_MIN_CONCURRENCY,
      SUBAGENT_HARD_MAX_CONCURRENCY,
    ),
  }
}

function buildWorkerSystemPrompt(opts: {
  task: string
  cwd?: string
  toolNames: string[]
  maxIterations: number
}): string {
  const cwdLine = opts.cwd ? `Project working directory: ${opts.cwd}\n` : ''
  return `You are a worker subagent dispatched by a coordinator. You handle ONE task and report back. You do NOT see the parent chat history.

${cwdLine}Available tools: ${opts.toolNames.join(', ')}
Iteration budget: ${opts.maxIterations}

Rules:
- Stay focused on the task you were given. Do not pursue tangents.
- Do not call dispatch_subagents (nested fanout is forbidden).
- Do not modify the parent's chat state — your finish signal is stop_response with a final_message that summarizes what you found.
- Be concise. The coordinator reads your final_message and decides next steps; raw tool output is not surfaced.
- If the task is impossible or out of scope, call stop_response immediately with an explanation.

Task: ${opts.task}
`
}

async function withConcurrency<T, R>(
  items: T[],
  cap: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workerCount = Math.max(1, Math.min(cap, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export async function dispatchSubagents(opts: DispatchSubagentsOptions): Promise<DispatchSubagentsResult> {
  const defaults = getSubagentDefaults()
  const subagentMaxIterations = clamp(
    Math.round(opts.subagentMaxIterations ?? defaults.maxIterations),
    SUBAGENT_MIN_ITERATIONS,
    SUBAGENT_HARD_MAX_ITERATIONS,
  )
  const concurrency = clamp(
    Math.round(opts.concurrency ?? defaults.concurrency),
    SUBAGENT_MIN_CONCURRENCY,
    SUBAGENT_HARD_MAX_CONCURRENCY,
  )
  const maxCount = Math.min(opts.maxCount ?? SUBAGENT_MAX_COUNT, SUBAGENT_MAX_COUNT)

  const specs = Array.isArray(opts.subagents) ? opts.subagents : []
  if (specs.length === 0) {
    return {
      aggregateResult: 'dispatch_subagents error: subagents array is empty. Provide 1-8 subagent specs with non-empty tasks.',
      snapshots: [],
    }
  }
  if (specs.length > maxCount) {
    return {
      aggregateResult: `dispatch_subagents error: requested ${specs.length} subagents but the limit is ${maxCount}. Reduce the count and try again.`,
      snapshots: [],
    }
  }
  for (let i = 0; i < specs.length; i++) {
    const t = String(specs[i]?.task ?? '').trim()
    if (!t) {
      return {
        aggregateResult: `dispatch_subagents error: subagent ${i + 1} has an empty task. Every subagent must have a non-empty task.`,
        snapshots: [],
      }
    }
  }

  // Per-turn cost cap: total subagent iterations cannot exceed 4× the parent's
  // own iteration budget. Prevents one dispatch from monopolizing the turn.
  const totalCap = Math.max(1, opts.parentMaxIterations) * 4
  const totalRequested = specs.length * subagentMaxIterations
  if (totalRequested > totalCap) {
    const suggested = Math.max(1, Math.floor(totalCap / Math.max(1, subagentMaxIterations)))
    return {
      aggregateResult: `dispatch_subagents error: ${specs.length} subagents x ${subagentMaxIterations} iterations = ${totalRequested}, exceeding the per-turn cap of ${totalCap}. Try at most ${suggested} subagents at this iteration cap, or reduce the per-subagent iteration cap.`,
      snapshots: [],
    }
  }

  const subagentTools = opts.parentTools.filter((t) => !SUBAGENT_TOOL_DENYLIST.has(t.name))
  const toolNames = subagentTools.map((t) => t.name)

  const emitTrace = (event: AgentTraceEvent) => {
    if (!opts.onTrace) return
    try { opts.onTrace(event) } catch { /* never let a trace handler break the loop */ }
  }
  emitTrace({ type: 'subagent_dispatch_start', count: specs.length, rationale: opts.rationale })

  const startedAtAll = performance.now()
  const snapshots: SubagentSnapshot[] = specs.map((spec, idx) => ({
    id: `sub-${Date.now()}-${idx}`,
    index: idx,
    name: (spec.name && String(spec.name).trim()) || `Subagent ${idx + 1}`,
    task: String(spec.task).trim(),
    status: 'queued',
    iterations: 0,
    maxIterations: subagentMaxIterations,
    startedAt: null,
    endedAt: null,
    toolCalls: [],
    finalMessage: '',
  }))
  const emit = () => opts.onSnapshot?.(snapshots.map((s) => ({ ...s, toolCalls: [...s.toolCalls] })))
  emit()

  await withConcurrency(specs, concurrency, async (spec, index) => {
    const snap = snapshots[index]
    snap.status = 'running'
    snap.startedAt = performance.now()
    emit()
    emitTrace({ type: 'subagent_start', id: snap.id, index: snap.index, task: snap.task })

    const history: any[] = [
      {
        id: `sub-user-${Date.now()}-${index}`,
        role: 'user',
        content: snap.task,
      },
    ]

    const systemPrompt = buildWorkerSystemPrompt({
      task: snap.task,
      cwd: opts.cwd,
      toolNames,
      maxIterations: subagentMaxIterations,
    })

    try {
      const result = await runAgentTurn({
        callProvider: opts.callProvider,
        model: opts.model,
        history,
        tools: subagentTools,
        systemPrompt,
        maxIterations: subagentMaxIterations,
        abortSignal: opts.abortSignal,
        depth: 1,
        handleSideEffect: (tc): SideEffectResult | null => {
          if (tc.name === STOP_TOOL_NAME) {
            return {
              resultContent: 'ok',
              stop: true,
              finalContent: String((tc.arguments as any)?.final_message ?? ''),
            }
          }
          if (tc.name === DISPATCH_SUBAGENTS_TOOL_NAME) {
            // Defense in depth: tool def is denylisted, so this is unreachable
            // unless the model fabricates the call. Refuse to recurse.
            return {
              resultContent: 'dispatch_subagents is not available from inside a subagent (no nested fanout). Continue with your assigned task or call stop_response.',
            }
          }
          return null
        },
        executeTool: async (tc) => {
          const r = await opts.executeTool(tc)
          const ok = !/^Error\b/i.test(r) && !/error:/i.test(r.split('\n')[0] ?? '')
          snap.toolCalls.push({ name: tc.name, ok })
          emit()
          return r
        },
        onIteration: (i) => {
          snap.iterations = i
          emit()
        },
      })

      snap.iterations = result.iterations
      snap.finalMessage = result.finalContent || ''
      snap.endedAt = performance.now()
      if (opts.abortSignal?.aborted) {
        snap.status = 'aborted'
      } else if (result.reachedMaxIterations) {
        snap.status = 'failed'
        snap.errorMessage = `max iterations reached (${snap.iterations}/${snap.maxIterations})`
      } else if (!result.finalContent) {
        snap.status = 'failed'
        snap.errorMessage = 'no final message'
      } else {
        snap.status = 'completed'
      }
    } catch (err: any) {
      snap.endedAt = performance.now()
      snap.status = opts.abortSignal?.aborted ? 'aborted' : 'failed'
      snap.errorMessage = err instanceof Error ? err.message : String(err)
    }
    const endStatus: 'completed' | 'failed' | 'aborted' = snap.status === 'completed' ? 'completed' : (snap.status === 'aborted' ? 'aborted' : 'failed')
    const durationMs = (snap.endedAt ?? performance.now()) - (snap.startedAt ?? performance.now())
    emitTrace({ type: 'subagent_end', id: snap.id, index: snap.index, durationMs, iterations: snap.iterations, status: endStatus })
    emit()
  })

  const totalSeconds = Math.round((performance.now() - startedAtAll) / 100) / 10
  const completed = snapshots.filter((s) => s.status === 'completed').length
  const failed = snapshots.filter((s) => s.status !== 'completed').length

  const sections = snapshots.map((snap, i) => {
    const head = `=== Subagent ${i + 1}: "${snap.name}" ===`
    const status =
      snap.status === 'completed'
        ? `status: completed (${snap.iterations}/${snap.maxIterations} iterations)`
        : `status: ${snap.status}${snap.errorMessage ? ': ' + snap.errorMessage : ''} (${snap.iterations}/${snap.maxIterations})`
    let body = (snap.finalMessage || '').trim() || '[no output]'
    if (body.length > FINAL_MESSAGE_TRUNCATION_LIMIT) {
      body =
        body.slice(0, FINAL_MESSAGE_TRUNCATION_LIMIT) +
        `\n\n[truncated — ${body.length - FINAL_MESSAGE_TRUNCATION_LIMIT} chars omitted]`
    }
    return `${head}\n${status}\n\n${body}`
  })

  const header = `[Subagent dispatch — ${completed} completed, ${failed} failed, totalSeconds=${totalSeconds}]`
  const aggregateResult = `${header}\n\n${sections.join('\n\n---\n\n')}`

  emitTrace({ type: 'subagent_dispatch_end', durationMs: performance.now() - startedAtAll, completed, failed })
  return { aggregateResult, snapshots }
}
