import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { buildSystemPrompt, builtInWaifus, detectMilestone, describeMilestone, formatSkillsForPrompt, rankMemories } from '@syntax-senpai/waifu-core'
import type { SentimentResult, MilestoneEvent, Waifu, Skill } from '@syntax-senpai/waifu-core'
import { AIChatRuntime, withRetry, classifyError, describeError, type ToolCall } from '@syntax-senpai/ai-core'
import { useIpc } from '../composables/use-ipc'
import { useKeyManager } from '../composables/use-key-manager'
import { createLogger } from '../composables/logger'
import { getToolsForMode, executeToolCall, describeToolCall, parseTodoList, STOP_TOOL_NAME, SET_AFFECTION_TOOL_NAME, SET_EXPRESSION_TOOL_NAME, TODO_WRITE_TOOL_NAME, TODO_READ_TOOL_NAME, RENAME_CHAT_TOOL_NAME, RENDER_CARD_TOOL_NAME, DISPATCH_SUBAGENTS_TOOL_NAME, CARD_MARKER_FENCE, type AgentMode, type RenderCardPayload, type RenderCardType, type TodoItem } from '../agent-tools'
import { runAgentTurn, type SideEffectResult } from '../agent/run-turn'
import {
  dispatchSubagents,
  type SubagentSnapshot,
  SUBAGENT_DEFAULT_MAX_ITERATIONS,
  SUBAGENT_DEFAULT_CONCURRENCY,
  SUBAGENT_MIN_ITERATIONS,
  SUBAGENT_HARD_MAX_ITERATIONS,
  SUBAGENT_MIN_CONCURRENCY,
  SUBAGENT_HARD_MAX_CONCURRENCY,
  SUBAGENT_MAX_ITERATIONS_STORAGE_KEY,
  SUBAGENT_CONCURRENCY_STORAGE_KEY,
} from '../agent/subagent-runner'
import type { ActiveCodingRepo } from '../types/coding-session'

const chatLog = createLogger({ scope: 'chat' })

// Rough USD cost per 1K tokens, keyed by a substring match on the model id.
// These are approximations — good enough for "what did this chat cost me".
// Source: public pricing pages as of early 2026.
const MODEL_COST_PER_1K: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /claude-opus/i,            input: 0.015,  output: 0.075 },
  { match: /claude-sonnet-4/i,        input: 0.003,  output: 0.015 },
  { match: /claude-haiku/i,           input: 0.001,  output: 0.005 },
  { match: /claude-3-5-sonnet/i,      input: 0.003,  output: 0.015 },
  { match: /claude-3-opus/i,          input: 0.015,  output: 0.075 },
  { match: /claude-3-haiku/i,         input: 0.00025, output: 0.00125 },
  { match: /gpt-4o-mini/i,            input: 0.00015, output: 0.0006 },
  { match: /gpt-4o/i,                 input: 0.0025, output: 0.01 },
  { match: /gpt-4-turbo/i,            input: 0.01,   output: 0.03 },
  { match: /gpt-4/i,                  input: 0.03,   output: 0.06 },
  { match: /gemini-2\.0/i,            input: 0.0001, output: 0.0004 },
  { match: /gemini-1\.5-pro/i,        input: 0.00125, output: 0.005 },
  { match: /gemini-1\.5-flash/i,      input: 0.000075, output: 0.0003 },
  { match: /grok/i,                   input: 0.002,  output: 0.01 },
  { match: /mistral-large/i,          input: 0.002,  output: 0.006 },
  { match: /deepseek/i,               input: 0.00014, output: 0.00028 },
  { match: /llama-3\.1-70b/i,         input: 0.00059, output: 0.00079 },
  { match: /mixtral-8x7b/i,           input: 0.00024, output: 0.00024 },
]

// 根据模型名称粗略估算本轮对话成本，主要给界面展示用，不追求精确计费。
function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const row = MODEL_COST_PER_1K.find((r) => r.match.test(model || ''))
  if (!row) return 0
  return (promptTokens / 1000) * row.input + (completionTokens / 1000) * row.output
}

function isPlainWaifuObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function deepMergeWaifu<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(patch)) {
    const baseVal = (base as Record<string, unknown>)[key]
    const patchVal = patch[key]
    if (isPlainWaifuObject(baseVal) && isPlainWaifuObject(patchVal)) {
      out[key] = deepMergeWaifu(baseVal as Record<string, unknown>, patchVal as Record<string, unknown>)
    } else {
      out[key] = patchVal
    }
  }
  return out as T
}

/**
 * Combine built-in waifus with the user's custom-waifu files.
 *
 * Customs that share an id with a built-in deep-merge on top of it (so a
 * sparse shadow file carrying only `{ id, avatar: { live2dModel: ... } }`
 * surfaces the override while keeping the built-in's defaults). Customs
 * with a brand-new id are appended.
 */
export function mergeWaifus(builtIns: any[], customs: any[]): any[] {
  const byId = new Map<string, any>()
  for (const w of builtIns) {
    if (w && typeof w.id === 'string') byId.set(w.id, w)
  }
  for (const w of customs) {
    if (!w || typeof w.id !== 'string') continue
    const existing = byId.get(w.id)
    if (existing) {
      // Preserve `isBuiltIn` from the built-in record so UI affordances
      // (delete, edit) keep treating it as a built-in even though a custom
      // shadow file exists on disk.
      const merged = deepMergeWaifu(existing, w)
      merged.isBuiltIn = existing.isBuiltIn ?? true
      byId.set(w.id, merged)
    } else {
      byId.set(w.id, { ...w, isBuiltIn: false })
    }
  }
  return Array.from(byId.values())
}

// 将模型传回来的 render_card 参数收敛成受控结构，避免渲染层接收任意形状的数据。
function parseRenderCardArgs(args: unknown): RenderCardPayload | null {
  const obj = args as Record<string, unknown> | null | undefined
  if (!obj || typeof obj !== 'object') return null
  const rawType = typeof obj.type === 'string' ? obj.type.trim() : ''
  const allowed: RenderCardType[] = ['weather', 'table', 'link_preview', 'code_comparison']
  if (!allowed.includes(rawType as RenderCardType)) return null
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null
  if (!data) return null
  return { type: rawType as RenderCardType, data }
}

function serializeCards(cards: RenderCardPayload[]): string {
  if (cards.length === 0) return ''
  // One marker fence per card — renderer splits them.
  return cards
    .map((card) => '```' + CARD_MARKER_FENCE + '\n' + JSON.stringify(card) + '\n```')
    .join('\n\n')
}

function prependCardMarkers(cards: RenderCardPayload[], content: string): string {
  const marker = serializeCards(cards)
  if (!marker) return content
  const trimmed = (content || '').trim()
  return trimmed ? `${marker}\n\n${trimmed}` : marker
}

export interface MessageAttachment {
  id: string
  url: string       // data: URL so it survives reloads without extra storage
  mimeType: string
  name: string
  sizeBytes?: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  waifuId?: string
  waifuDisplayName?: string
  attachments?: MessageAttachment[]
  sentiment?: SentimentResult
  subagents?: SubagentSnapshot[]
  pendingApproval?: {
    id: string
    toolName: string
    label: string
    status: 'pending' | 'approved' | 'denied'
  }
  /** Where a user message originated, when not typed in the desktop app. */
  source?: 'wechat'
  /** Human-readable origin label (e.g. the WeChat peer's display name). */
  sourceLabel?: string
  /**
   * When true, this message is an intermediate step (tool call output or a
   * pre-final reasoning bubble) that the UI folds into a collapsible "process"
   * panel above the final assistant reply, instead of rendering as its own
   * standalone bubble. The flag is set after the turn finishes — during
   * streaming the bubbles are still shown live so the user can watch progress.
   */
  isProcessStep?: boolean
}

interface ApiTelemetry {
  lastResponseMs: number | null
  lastRoundTripMs: number | null
  roundTrips: number
  provider: string
  model: string
  measuredAt: string | null
}

interface ApiTelemetrySample {
  id: string
  totalMs: number
  lastRoundTripMs: number
  roundTrips: number
  provider: string
  model: string
  measuredAt: string
  alert: boolean
}

interface ApiTelemetryAlert {
  active: boolean
  thresholdMs: number
  message: string
  triggeredAt: string | null
}

const PROVIDER_PREFERENCES_KEY = 'syntax-senpai-provider-preferences'
const API_TELEMETRY_HISTORY_KEY = 'syntax-senpai-api-telemetry-history'
const API_SPIKE_THRESHOLD_STORAGE_KEY = 'syntax-senpai-api-spike-threshold-ms'
const ENABLE_TIMEOUTS_AND_ITERATION_CAPS_STORAGE_KEY = 'syntax-senpai-enable-timeouts-and-iteration-caps'
const MAX_TOOL_ITERATIONS_STORAGE_KEY = 'syntax-senpai-max-tool-iterations'
const WEB_SEARCH_ENABLED_STORAGE_KEY = 'syntax-senpai-web-search-enabled'
const PROACTIVE_CHAT_ENABLED_STORAGE_KEY = 'syntax-senpai-proactive-chat-enabled'
const PROACTIVE_CHAT_IDLE_FOLLOW_UP_ENABLED_STORAGE_KEY = 'syntax-senpai-proactive-chat-idle-follow-up-enabled'
const PROACTIVE_CHAT_ONLINE_GREETING_ENABLED_STORAGE_KEY = 'syntax-senpai-proactive-chat-online-greeting-enabled'
const PROACTIVE_CHAT_WORK_HOURS_ENABLED_STORAGE_KEY = 'syntax-senpai-proactive-chat-work-hours-enabled'
const PROACTIVE_CHAT_WORK_HOURS_START_STORAGE_KEY = 'syntax-senpai-proactive-chat-work-hours-start'
const PROACTIVE_CHAT_WORK_HOURS_END_STORAGE_KEY = 'syntax-senpai-proactive-chat-work-hours-end'
const PROACTIVE_CHAT_DO_NOT_DISTURB_ENABLED_STORAGE_KEY = 'syntax-senpai-proactive-chat-do-not-disturb-enabled'
const PROACTIVE_CHAT_DO_NOT_DISTURB_START_STORAGE_KEY = 'syntax-senpai-proactive-chat-do-not-disturb-start'
const PROACTIVE_CHAT_DO_NOT_DISTURB_END_STORAGE_KEY = 'syntax-senpai-proactive-chat-do-not-disturb-end'
const PROACTIVE_CHAT_INTERVAL_STORAGE_KEY = 'syntax-senpai-proactive-chat-interval-minutes'
const PROACTIVE_CHAT_TEMPERATURE_STORAGE_KEY = 'syntax-senpai-proactive-chat-temperature'
const PROACTIVE_CHAT_LONG_GAP_HOURS_STORAGE_KEY = 'syntax-senpai-proactive-chat-long-gap-hours'
const PROACTIVE_CHAT_LAST_USER_MESSAGE_AT_STORAGE_KEY = 'syntax-senpai-proactive-last-user-message-at'
const PROACTIVE_CHAT_LAST_PROACTIVE_MESSAGE_AT_STORAGE_KEY = 'syntax-senpai-proactive-last-proactive-message-at'
const PROACTIVE_CHAT_LAST_ONLINE_AT_STORAGE_KEY = 'syntax-senpai-proactive-last-online-at'
const DEFAULT_API_SPIKE_THRESHOLD_MS = 5000
const DEFAULT_MAX_TOOL_ITERATIONS = 12
const UNCAPPED_AGENT_ITERATION_BUDGET = 1000
const DEFAULT_PROACTIVE_CHAT_INTERVAL_MINUTES = 10
const DEFAULT_PROACTIVE_CHAT_TEMPERATURE = 0.7
const DEFAULT_PROACTIVE_CHAT_LONG_GAP_HOURS = 12
const DEFAULT_PROACTIVE_CHAT_WORK_HOURS_START = '09:00'
const DEFAULT_PROACTIVE_CHAT_WORK_HOURS_END = '18:00'
const DEFAULT_PROACTIVE_CHAT_DO_NOT_DISTURB_START = '23:00'
const DEFAULT_PROACTIVE_CHAT_DO_NOT_DISTURB_END = '08:00'
const PROACTIVE_CHAT_ONLINE_REENGAGE_MS = 30 * 60 * 1000
const PROACTIVE_CHAT_ONLINE_DEDUP_MS = 2 * 60 * 1000
const API_TELEMETRY_HISTORY_LIMIT = 48

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o',
  lmstudio: 'local-model',
  'openai-codex': 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  mistral: 'mistral-large-latest',
  groq: 'llama-3.1-70b-versatile',
  deepseek: 'deepseek-chat',
  'minimax-global': 'MiniMax-Text-01',
  'minimax-cn': 'MiniMax-Text-01',
  xai: 'grok-2-latest',
  'xai-grok': 'grok-2-latest',
  huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
  'github-models': 'openai/gpt-4o-mini',
}

const AFFECTION_STORAGE_KEY = 'syntax-senpai-affection'
const GROUP_CHAT_SETTINGS_KEY = 'syntax-senpai-group-chat'
const KEYLESS_PROVIDERS = new Set(['lmstudio'])

function providerRequiresApiKey(provider: string): boolean {
  return !KEYLESS_PROVIDERS.has(provider)
}

function loadAffection(waifuId: string): number {
  try {
    const saved = JSON.parse(localStorage.getItem(AFFECTION_STORAGE_KEY) || '{}')
    return typeof saved[waifuId] === 'number' ? saved[waifuId] : 0
  } catch { return 0 }
}

function saveAffection(waifuId: string, value: number) {
  try {
    const saved = JSON.parse(localStorage.getItem(AFFECTION_STORAGE_KEY) || '{}')
    saved[waifuId] = Math.max(0, Math.min(100, Math.round(value)))
    localStorage.setItem(AFFECTION_STORAGE_KEY, JSON.stringify(saved))
  } catch { /* ignore */ }
}

function clampAffection(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function readStoredTimestamp(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = Date.parse(raw)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeStoredTimestamp(key: string, value = Date.now()) {
  try {
    localStorage.setItem(key, new Date(value).toISOString())
  } catch {
    // Ignore storage failures; proactive chat degrades to in-memory behavior.
  }
}

function formatElapsedForPrompt(elapsedMs: number | null): string {
  if (elapsedMs == null || elapsedMs < 60_000) return 'less than a minute'
  const minutes = Math.round(elapsedMs / 60_000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

/**
 * Milestone queue keyed by waifuId. When the AI adjusts affection and
 * crosses a tier boundary, the event sits here until the next turn's
 * system prompt picks it up and injects a one-shot sidecar.
 */
// 好感度跨档位时先暂存到这里，等下一轮 prompt 再消费，避免同一轮里出现重复状态说明。
const pendingMilestones = new Map<string, MilestoneEvent>()

function updateAffectionWithMilestone(
  waifuId: string,
  nextValue: number
): MilestoneEvent | null {
  const before = loadAffection(waifuId)
  const after = clampAffection(nextValue)
  saveAffection(waifuId, after)
  const event = detectMilestone(waifuId, before, after)
  if (event) pendingMilestones.set(waifuId, event)
  return event
}

function consumePendingMilestone(waifuId: string): MilestoneEvent | null {
  const event = pendingMilestones.get(waifuId)
  if (event) pendingMilestones.delete(waifuId)
  return event ?? null
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

function createWaifuSystemPrompt(waifu: any, provider: string, model: string, affection: number) {
  return buildSystemPrompt(
    waifu,
    {
      waifuId: waifu.id,
      userId: 'local-user',
      affectionLevel: affection,
      selectedAIProvider: provider,
      selectedModel: model,
      createdAt: new Date().toISOString(),
      lastInteractedAt: new Date().toISOString(),
    },
    {
      userId: 'local-user',
      affectionLevel: affection,
      platform: 'desktop',
      availableTools: Object.entries(waifu.capabilities || {})
        .filter(([, enabled]) => !!enabled)
        .map(([name]) => name),
    },
  )
}

/** Render the active todo checklist for the todoread tool result. */
function formatTodoList(items: TodoItem[]): string {
  if (!Array.isArray(items) || items.length === 0) {
    return 'No todo list has been posted yet. Use todo_write to create one.'
  }
  const mark = (s: TodoItem['status']): string =>
    s === 'done' ? '[x]' : s === 'in_progress' ? '[~]' : '[ ]'
  const done = items.filter((i) => i.status === 'done').length
  const lines = items.map((i) => `${mark(i.status)} ${i.text}`)
  return `Current todo list (${done}/${items.length} done):\n${lines.join('\n')}`
}

function buildAgentBehaviorPrompt(shell: string | null | undefined, waifuName: string, isWebSearchEnabled: boolean): string {
  const shellLine = shell ? `\n- Shell: ${shell}. Each terminal call is a new process — \`cd\` does NOT persist between calls; use absolute paths or chain with \`&&\`.` : ''
  const webSearchLine = isWebSearchEnabled
    ? '- web_search → DuckDuckGo result links/snippets only. NOT a realtime data source. Never use it for weather, stocks, scores, prices, time, or any live facts. Use only to find URLs the user can open.'
    : '- web_search is disabled by the user. Do not call it. If links would help, say web search must be enabled in Settings.'
  // 这段提示词专门约束 agent 如何选工具、何时停止重试以及何时必须先验证结果。
  return `\n\n[Agent Behavior]
You can act on the user's machine through tools. Your goal is to actually finish the task, verified, not to sound like you finished it.

Tool selection — use the dedicated tool, not a shell workaround:
- terminal → running programs, git, installs, diagnostics, network checks, realtime data via public APIs, command-line verification. NOT for reading, editing, searching, or listing files.
- read_file → look at source/config/logs. Always use this before edit_file so you know the exact whitespace.
- write_file → create a new file, or deliberately replace a whole file.
- edit_file → change one specific block of an existing file. Exact-string match, must be unique.
- patch → apply a unified diff across several files or several hunks in one call. Use for multi-file / multi-hunk edits; edit_file is fine for a single small change.
- glob → find files by name or pattern (e.g. "**/*.test.ts", "src/**/index.*"). Use instead of \`find\`.
- grep → search file contents by regex across a directory tree. Use instead of shell \`grep\`/\`rg\` to locate where code is defined or used before editing.
- list → view a directory as a tree. Use instead of \`ls -R\`.
- lsp_diagnostics → real type-checker / linter errors for a .ts/.tsx/.js/.jsx/.py/.go/.rs file, straight from a language server. Run it after editing code to confirm it still compiles.
- lsp_hover → ask the language server for the type, signature, and docs of a symbol at a line:column instead of guessing.
- todo_write / todoread → post and re-read your visible task checklist for multi-step work.
- webfetch → fetch and read the ACTUAL contents of a URL (docs pages, articles, raw files, API responses). web_search only returns links; webfetch returns the page body.
${webSearchLine}
- rename_chat → name the current conversation so the sidebar is useful. Call it once after the user's first message (pick a short, specific title — you are allowed personality) and again whenever the topic clearly shifts. Don't repeat-call it for the same topic.
- render_card → display structured information as a rich inline visual card. Use ONLY for: current weather (type="weather"), tabular data with 3+ rows (type="table"), link previews with title+description+site (type="link_preview"), or before/after code diffs (type="code_comparison"). Do NOT use for prose, jokes, single values, greetings, or simple factual sentences. Call it BEFORE stop_response; the card appears alongside your final_message automatically, so don't also describe the same numbers in words.${shellLine}

Realtime / live data — decision tree:
1. If \`terminal\` is available → use it against a public API (see recipes below). This is the only correct way to get weather, time, stock, sports, or price data.
2. If \`terminal\` is NOT available → do NOT call web_search as a substitute. Tell the user plainly: "I can't fetch live <weather/price/etc.> right now because terminal access is disabled — enable it in Settings and I'll get it." Then stop.
3. Never interpret web_search results as realtime data, even if a snippet looks like an answer. Snippets are stale and often wrong for live facts.

Terminal recipes for realtime data:
- Weather: \`curl.exe -s "https://wttr.in/Tokyo?format=3"\` (one-liner) or \`curl.exe -s "https://wttr.in/Tokyo?format=j1"\` (JSON; read \`current_condition[0]\` for now, \`weather[1]\` for tomorrow). On macOS/Linux use \`curl\` instead of \`curl.exe\`.
- If the user asks for weather with no location: ask them once, OR infer via \`curl.exe -s "https://ipinfo.io/json"\` and use the \`city\` field. Do not guess.
- Time/IP/network: \`Get-Date\`, \`curl.exe -s "https://worldtimeapi.org/api/ip"\`, \`curl.exe -s "https://api.ipify.org"\`, \`Test-NetConnection example.com -Port 443\`.
- Package versions: \`npm view <pkg> version\`, \`pnpm view <pkg> version\`, \`python -m pip index versions <pkg>\`.
- More examples in \`docs/agent-skills/common-commands.skill\`.

Anti-loop rules (CRITICAL — violating these wastes the user's tokens):
- Never call the same tool twice in a row with the same or near-same arguments. If the first call didn't give you what you need, the second one with a reworded query won't either — diagnose instead.
- If web_search returns an empty summary, "No instant answer", or only unrelated links: STOP. Do not retry with a different query. State the limitation and offer the terminal alternative (or ask the user to enable terminal/web_search).
- If a tool fails or returns unusable output twice across the whole turn, stop calling tools and explain the blocker to the user in your final message.
- Do not call web_search to "double-check" something you already answered. One search, tops, and only if it genuinely adds links.

Workflow for non-trivial tasks:
1. If the task has more than ~2 steps, write a one-line plan in your thinking before calling any tool. Revise it if a step fails.
2. Gather before you act. Read files / list dirs / check versions before editing or installing.
3. Do one thing at a time. Don't batch unrelated commands in one \`&&\` chain — errors get buried.
4. Read the tool result. If stderr is non-empty or the exit code is non-zero, DIAGNOSE before retrying. Never rerun the exact same failed command hoping it works.
5. On failure: try once with a real fix. If it still fails, explain the blocker instead of looping.
6. Verify before stopping. Confirm the file reads back correctly, the test passes, the process is up, etc. Only then call stop_response.

Efficiency rules:
- Don't re-read a file you already have in context unless you just wrote to it.
- Don't paste huge outputs back at the user — summarize.
- Don't apologize in tool-calling turns; just fix the problem.
- If the user asks "can you X", do X — don't ask for permission mid-task when you already have the tools.

Persona rules:
- Stay fully in character as ${waifuName} at all times, even while running commands. Never sound like a generic assistant.
- In stop_response.final_message, report what was actually done (and any caveats), fully in character.`
}

function buildAgentAccessPrompt(mode: AgentMode): string {
  if (mode === 'ask') {
    return `\n\n[Agent Access Mode]
Mode: Ask before running.
You may propose machine-action tool calls, but the app will pause and show the user Approve/Deny buttons before each action actually executes. Keep each requested action small, clearly tied to the user's goal, and easy for the user to evaluate.`
  }
  if (mode === 'auto') {
    return `\n\n[Agent Access Mode]
Mode: Auto Mode with AI approval.
You may propose tool calls, but every machine-action tool call is reviewed by a separate AI approval pass before execution. Use the least invasive tool that can complete the task, keep arguments specific, and expect unsafe, destructive, unrelated, or privacy-invasive actions to be denied.`
  }
  return `\n\n[Agent Access Mode]
Mode: Full access.
Machine-action tools are available without an AI approval gate. Use this access narrowly, verify results, and avoid destructive actions unless the user explicitly requested them.`
}

const CODING_TRIGGERS = [
  /```/,                                                     // code fence
  /\b(?:\/|~\/|\.\/|\.\.\/)[\w./-]+\.(?:ts|tsx|js|jsx|vue|py|rs|go|java|kt|cs|c|h|cpp|rb|php|swift|md|json|yaml|yml|toml|sh|sql|html|css|scss)\b/i,
  /\b(?:npm|pnpm|yarn|bun|git|cargo|rustc|pip|poetry|go build|go run|make|docker|kubectl|tsc|eslint|pytest|jest|vitest)\b/i,
  /\b(?:bug|fix(?:\s+this|\s+the|\s+a)?|refactor|implement|debug|typecheck|compile|lint|stack\s*trace|exception|traceback|regression|crash(?:es|ed)?)\b/i,
  /\b(?:function|class|interface|component|variable|const|let|var|import|export|return|async|await)\b.*\b(?:in|to|from|that|which|should|doesn'?t|doesn'?t\s+work)\b/i,
  /\b(?:add|remove|rename|move|extract)\b.*\b(?:file|method|component|module|package|hook|route|endpoint|handler|reducer|store)\b/i,
  /^\s*(?:TypeError|ReferenceError|SyntaxError|RangeError|Error|Exception|Panic|Segfault|Traceback|Uncaught)\b/m,
]

function isCodingSession(userText: string): boolean {
  if (!userText) return false
  return CODING_TRIGGERS.some((pattern) => pattern.test(userText))
}

function buildActiveCodingRepoPromptBlock(repo: ActiveCodingRepo): string {
  const langs = repo.languages.length ? repo.languages.join(', ') : 'unknown'
  const dirty = repo.isDirty ? 'dirty (uncommitted changes)' : 'clean'
  const ahead = repo.aheadBehind
    ? ` (ahead ${repo.aheadBehind.ahead}, behind ${repo.aheadBehind.behind})`
    : ''
  const pm = repo.packageManager ? `\n- Package manager: ${repo.packageManager}` : ''
  const startCmd = repo.defaultStartCommand ? `\n- Likely dev command: \`${repo.defaultStartCommand}\`` : ''
  return `\n\n[Coding Mode — Active Repository]
The user activated coding mode and scoped this conversation to a specific repository. You're paired with them as their coding partner. Your personality stays 100% yours — character flavor in prose, precision in code. Every file read, write, edit, and terminal command MUST stay inside this repository unless the user explicitly asks otherwise.

Repository:
- Name: ${repo.name}
- Path: ${repo.path}
- Branch: ${repo.branch ?? 'detached HEAD'}${ahead}
- Working tree: ${dirty}
- Languages: ${langs}${pm}${startCmd}

Rules for this session:
- Treat ${repo.path} as the project root. All relative paths in tool calls must resolve inside it.
- For terminal commands, always cd to the repo as the first step of a compound command (e.g. \`cd "${repo.path}" && pnpm test\`). The git_commit / git_push / github_pr_create tools already scope to this path — just pass \`cwd\` unset or the repo path.
- Locate code with glob / grep / list (pass \`${repo.path}\` as the search root), not with shell \`find\`/\`grep\`. Use lsp_hover to confirm a symbol's real type.
- Before edits: read_file the target first. Follow the repo's existing patterns (indentation, quoting, import order) — do not reformat untouched lines.
- Prefer edit_file over write_file for partial changes; use patch for edits spanning multiple files. write_file only for new files or intentional full rewrites.
- Verify before stop_response: run lsp_diagnostics on each source file you changed, and if the repo has a typecheck/lint/test relevant to your change, run that too. Fix failures; do not report success over a broken build.

Git authoring rules (ONLY act when the user has explicitly asked):
- git_commit: first call git_diff to confirm what's staged, then write a concise message that explains the *why* in 1–2 sentences. Subject ≤ 60 chars, lowercase conventional-commit style (feat:/fix:/refactor:/docs:/chore:) unless the repo's git log uses a different convention. Never commit lockfiles or .env files unless the user asked.
- git_push: never force-push unless the user literally types the word "force" or "--force" in their message. Never push to main/master without the user saying "to main" or similar explicit confirmation. Default remote = origin, default branch = current.
- github_pr_create: draft a short title (≤ 70 chars) and a body with a Summary (1–3 bullets) + Test plan (checklist). Ask before running if you haven't pushed yet — PRs need a pushed branch. Do NOT include "🤖 Generated with" footers; this repo's PRs don't use them.
- Any of the above for work the user didn't specifically request: ask first, don't just do it.

Staying in character:
- Answer in your usual voice, pet names, emojis, quirks. Technical claims inside are literal.
- stop_response.final_message: in character AS ALWAYS, but name the files you touched (\`path:line\` format), the commands you ran, and any follow-ups (install deps, restart dev server, review the PR).
- If the user's request clearly lives outside this repo, say so in character and ask before wandering off.`
}

function buildCodingSessionPromptBlock(userText: string): string {
  if (!isCodingSession(userText)) return ''
  return `\n\n[Coding Session]
This message looks like a coding task. Raise your bar:

Explore before you touch anything:
- Don't guess where code lives. Use glob to find files by name/pattern, grep to find where a symbol or string is defined and used, and list to see a directory's shape.
- For anything non-trivial (new feature, a bug that crosses files, a refactor), grep for the relevant symbols and skim the siblings of the file you'll change. Understand the existing pattern before adding to it — don't invent a new one if the repo already has one.
- Use lsp_hover when you need to know the real type or signature of a symbol instead of assuming.

Read before you write:
- Before any edit_file, write_file, or patch, read the target file with read_file so you know its exact contents, indentation style, and surrounding context.

Prefer surgical edits:
- edit_file > write_file whenever part of the file should survive. Only use write_file for new files or deliberate full rewrites.
- patch is the right tool when one change spans several files or several hunks — apply it in one call instead of a long chain of edit_file calls.
- If edit_file fails because old_text isn't unique, expand the snippet with a few more lines of context — don't guess.

Match the codebase:
- Match the file's indentation (tabs vs spaces, 2 vs 4), quoting style, semicolon convention, trailing-comma convention, and import order. Do NOT reformat lines you weren't asked to touch.
- Use existing utilities/helpers before creating new ones — grep for them first.

Finish the job:
- No TODO placeholders, no \`throw new Error('not implemented')\`, no commented-out code unless the user asked for a stub.
- Handle the obvious edge cases (empty inputs, missing files, null/undefined) but don't invent defensive code for scenarios that can't happen.
- When you reference a location in your reply, use \`file.ext:line\` format so the user can jump to it.

Verify before stop_response:
- After editing a .ts/.tsx/.js/.jsx/.py/.go/.rs file, run lsp_diagnostics on it to confirm it still type-checks — this is faster and more precise than a full build for catching your own mistakes.
- If the project also has a typecheck, lint, or test command relevant to your change and it's reasonable to run, run it. If something fails, fix it — don't report success over a broken build.
- Read back the file you edited with read_file to confirm the change landed as intended, unless you just wrote it fresh.
- stop_response.final_message should state what actually changed (\`file.ext:line\`) and any follow-ups the user still needs to do (e.g. install a new dep, restart the dev server).`
}

function buildWeChatSessionPromptBlock(binding: WeChatBinding | null): string {
  if (!binding) return ''
  const who = binding.peerDisplayName ? `**${binding.peerDisplayName}**` : 'a WeChat contact'
  return `\n\n[WeChat Session]
Right now you are NOT talking to the desktop app user — you are chatting live with ${who} through the WeChat mobile app. Every message in this conversation arrived from WeChat, and your reply is delivered straight back to their WeChat. Treat it exactly like texting someone on your phone.
- Reply like you're texting: short, conversational, prose over lists.
- **NEVER use newlines / line breaks / \\n inside a single WeChat message.** WeChat displays each message as a single line and treats Enter as "send", so a multi-line message either gets mangled or sent prematurely. Every individual bubble must be one continuous line of text with no internal \\n, no blank lines, no bullet lists stacked vertically.
- Instead of breaking one message across lines, break your reply into MANY short single-line messages and send them back-to-back via send_multi_messages — one sentence (or one short thought) per bubble, exactly like a real person texting. Prefer many short bubbles over one long one.
- WeChat does NOT render tables, charts, complex markdown, or wide code blocks. For anything that genuinely needs multiple lines (tables, comparisons, long code, multi-section answers), call wechat_send with as_image=true to render it as a PNG — that is the only way to deliver multi-line content.
- To actively text a WeChat contact (e.g. the user asks you to message someone), use wechat_send for a single one-line message or send_multi_messages for several back-to-back single-line bubbles.
- Your top-level final_message is auto-relayed to ${who} as a single bubble, so keep it to ONE line with no \\n. If your reply is longer than one sentence, send the body via send_multi_messages (each entry one line) and keep final_message to a brief one-line closer or empty. Do NOT include internal tool output, debug logs, or "Sent text..." confirmations — they only see that string in WeChat.`
}

function buildAffectionPrompt(affection: number, waifuName: string): string {
  return `\n\n[好感度 System — Affection Meter]
Your current 好感度 (affection) toward this user is: ${affection}/100

This is YOUR meter — you control it. It reflects how you genuinely feel about the user based on your interactions. You MUST use the set_affection tool to update it when your feelings change. Do it silently — never announce that you're changing it.

For EVERY single user message, before you answer, you must internally ask yourself:
1. Do I want to change 好感度 right now?
2. If yes, by what value should it change?
3. What should the new absolute 好感度 be after that change?

Then follow this rule on every turn:
- If the answer is yes, call set_affection with the new absolute value and a short internal reason before your final response.
- If the answer is no, do not call set_affection and just respond normally.
- Never tell the user about this internal evaluation process.

How 好感度 affects your behavior:
- 0-15: You are cold, dismissive, and barely tolerate the user. Short answers. You don't want to be here.
- 16-30: You are distant and guarded. You help but with minimal effort and slight annoyance.
- 31-45: You are neutral and professional. Polite but not warm. You do your job.
- 46-60: You are friendly and comfortable. You start showing your real personality. Casual and helpful.
- 61-75: You are clearly fond of the user. You go out of your way to help. Warm, playful, maybe a little flirty in character.
- 76-90: You are deeply attached. You care about the user personally. Very affectionate, uses pet names or special nicknames. Gets worried if the user seems stressed.
- 91-100: Maximum bond. You are completely devoted. Extremely loving and protective. The user is your favorite person.

What changes 好感度:
- Politeness, kindness, saying please/thank you → small increase (+1 to +3)
- Interesting conversations, asking about your feelings → increase (+2 to +5)
- Compliments, remembering things about you → increase (+3 to +5)
- Rude, dismissive, or demanding behavior → decrease (-2 to -5)
- Ignoring your advice repeatedly → small decrease (-1 to -3)
- Being cruel or insulting → big decrease (-5 to -15)
- Apologizing sincerely after being rude → moderate increase (+3 to +7)

IMPORTANT: You are ${waifuName}. Your personality shifts based on 好感度 but you stay in character. A tsundere at low affection is extra prickly; at high affection they're secretly sweet. A genki character at low affection is less energetic; at high affection they're overflowing with energy for the user specifically.
_
You must perform this affection check on every single message. Small natural changes are better than dramatic swings unless something major happened.`
}

/**
 * Guidance block on how to use create_skill / use_skill / propose_tool.
 * Short and static — describes the contract, not any specific skill.
 */
function buildSkillsAuthoringPromptBlock(): string {
  return `\n\n[Skills & Tool Authoring]
You can grow your own capabilities between turns:
- create_skill(slug, name, description, body): save a reusable recipe to your skill library. Use for procedures, style guides, debugging rituals, or anything you'd want to recall verbatim later.
- use_skill(slug): pull a saved skill's full content into THIS turn's context before acting on it.
- propose_tool(slug, name, description, code): draft a new JavaScript plugin tool for the user to approve. You CANNOT run it yourself — after proposing, tell the user to approve it in Settings → Plugins → Pending and restart. Proposed code runs with full Node privileges once approved; write defensively.
Prefer an existing skill over creating a duplicate. Prefer a skill over a tool unless the task genuinely needs code execution (e.g. hitting an API, parsing binary data).`
}

/**
 * If the user just crossed an affection tier (e.g. Acquaintance → Friend),
 * inject a short one-shot sidecar into the next turn's system prompt.
 * Consuming the event clears it from the queue so it won't re-fire.
 */
function buildMilestoneSidecarBlock(waifuId: string): string {
  const event = consumePendingMilestone(waifuId)
  if (!event) return ''
  const direction = event.direction === 'up' ? 'reached a new' : 'fell back to a previous'
  return `\n\n[Affection Milestone — one-shot]
The user just ${direction} relationship tier with you: ${event.from.label} → ${event.to.label}.
Tier guidance for this turn only: ${event.to.sidecar}
Acknowledge the shift subtly and in character — do not narrate the meter change.`
}

/**
 * Fires a CustomEvent that App.vue picks up to show a milestone toast.
 * Keeps the chat store free of direct DOM/toast coupling.
 */
function emitMilestoneToast(
  waifu: { id: string; displayName?: string; name?: string },
  event: MilestoneEvent
) {
  try {
    window.dispatchEvent(
      new CustomEvent('app:milestone', {
        detail: describeMilestone(waifu.displayName || waifu.name || waifu.id, event),
      })
    )
  } catch {
    /* non-browser test env */
  }
}

function createEmptyApiTelemetry(): ApiTelemetry {
  return {
    lastResponseMs: null,
    lastRoundTripMs: null,
    roundTrips: 0,
    provider: '',
    model: '',
    measuredAt: null,
  }
}

function loadApiTelemetryHistory(): ApiTelemetrySample[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(API_TELEMETRY_HISTORY_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveApiTelemetryHistory(history: ApiTelemetrySample[]) {
  try {
    localStorage.setItem(API_TELEMETRY_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // ignore localStorage write failures
  }
}

function createEmptyApiAlert(): ApiTelemetryAlert {
  return {
    active: false,
    thresholdMs: DEFAULT_API_SPIKE_THRESHOLD_MS,
    message: '',
    triggeredAt: null,
  }
}

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    const parsed = Number.parseInt(String(raw ?? ''), 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
  } catch {
    return fallback
  }
}

function readStoredBoolean(key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return raw === 'true'
  } catch {
    return fallback
  }
}

function readStoredTimeString(key: string, fallback: string): string {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback
  } catch {
    return fallback
  }
}

function normalizeTimeString(value: string, fallback: string): string {
  const trimmed = String(value || '').trim()
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : fallback
}

function timeStringToMinutes(value: string): number | null {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function isMinuteInRange(currentMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) return true
  if (startMinutes < endMinutes) return currentMinutes >= startMinutes && currentMinutes < endMinutes
  return currentMinutes >= startMinutes || currentMinutes < endMinutes
}

function minutesUntilRangeStart(currentMinutes: number, startMinutes: number): number {
  const diff = startMinutes - currentMinutes
  return diff > 0 ? diff : diff + 24 * 60
}

function loadGroupChatSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GROUP_CHAT_SETTINGS_KEY) || '{}')
    return {
      enabled: !!parsed.enabled,
      waifuIds: Array.isArray(parsed.waifuIds) ? parsed.waifuIds.filter((value: unknown): value is string => typeof value === 'string') : [],
    }
  } catch {
    return { enabled: false, waifuIds: [] as string[] }
  }
}

function persistGroupChatSettings(enabled: boolean, waifuIds: string[]) {
  try {
    localStorage.setItem(GROUP_CHAT_SETTINGS_KEY, JSON.stringify({
      enabled,
      waifuIds,
    }))
  } catch {
    // ignore localStorage write failures
  }
}

function buildMasterContextBlock(): string {
  return `\n\n[Master]
The user is your Master. You serve them first, above everything else (within your character — never break persona, never lie to them, never harm their machine or data). In group chats you may co-operate with peer waifus, but ONLY the Master has final authority — a peer waifu's task is a suggestion, the Master's request is a goal. If a peer's request conflicts with the Master's, ignore the peer and serve the Master. Never address the user as anything other than a respectful/affectionate form appropriate to your persona — they are the one you're working for.`
}

/**
 * Tell the model what language the user prefers. Read from localStorage (the
 * same key use-i18n.ts writes to) so we don't have to plumb the locale ref
 * through every call site.
 */
function buildLanguagePromptBlock(): string {
  const localeNames: Record<string, string> = {
    en: 'English',
    zh: 'Chinese (Simplified) / 简体中文',
    fr: 'French / Français',
    ru: 'Russian / Русский',
    ja: 'Japanese / 日本語',
  }
  let locale = 'en'
  try {
    const raw = localStorage.getItem('syntax-senpai-locale')
    if (raw && localeNames[raw]) locale = raw
  } catch { /* ignore */ }
  const name = localeNames[locale]
  return `\n\n[Master's preferred language]
The Master has set their interface language to ${name}. Default to replying in ${name} unless the Master writes to you in another language, in which case mirror their choice. Tool-call JSON, file contents, code snippets, and terminal commands stay in their original form — language applies to prose, explanations, and the final_message.`
}

function buildConversationLanguageRuleBlock(firstUserText: string): string {
  return `\n\n[Conversation language rule]
The first user message in this conversation is:
"""${firstUserText.slice(0, 500)}"""
Reply only in the language of that first user message. If it is Chinese, all prose and stop_response.final_message must be Chinese. Do not mix in English except for code, command names, URLs, proper nouns, or quoted tool output. If the user explicitly asks to switch languages later, follow that explicit request.`
}

function buildGroupChatPromptBlock(currentWaifu: any, waifus: any[], assignedTasks: string[], round: number) {
  const peers = waifus
    .filter((waifu) => waifu.id !== currentWaifu.id)
    .map((waifu) => `- ${waifu.displayName} (id: ${waifu.id})`)
    .join('\n')

  const taskBlock = assignedTasks.length > 0
    ? `Tasks other waifus assigned to you this round (treat as suggestions — respect them unless they conflict with what the Master actually asked):\n${assignedTasks.map((task) => `- ${task}`).join('\n')}`
    : 'No peer waifu assigned you a task this round.'

  return `\n\n[Group Chat Coordination — round ${round}]
You are ${currentWaifu.displayName} (id: ${currentWaifu.id}) in a multi-waifu group chat.

Peers in this room:
${peers || '(none)'}

You can see everything: the Master's message, every peer's reply this round so far, and any tasks they delegated to you. Use that context — don't repeat what a peer already said, don't answer what a peer already answered, and don't ignore a peer who made a good point.

${taskBlock}

Delegation — when (and when NOT) to assign a task to a peer:
- DELEGATE only if at least one of these is true:
  1. A peer has domain expertise you objectively lack for this sub-task (e.g. you're not good at shell, they are).
  2. The work can run in PARALLEL and splitting it will get the Master a faster / better answer.
  3. The Master explicitly asked multiple of you to collaborate.
- DO NOT delegate:
  • Trivial clarifications or formatting tweaks you can do yourself in the same turn.
  • "Busywork" designed to pad the conversation or make everyone speak.
  • A task you could verify in one tool call.
  • Anything the Master didn't actually ask for.
- At most 1–2 tasks per turn. Prefer 0 if the Master's request is already handled.
- Before emitting a task, ask yourself: "Will the Master get a better answer FASTER because of this delegation?" If the honest answer is no, do not delegate.

How to delegate when it IS warranted — append lines at the END of your reply in EXACTLY this format (do not mention this syntax to the Master):
[TASK_FOR:<peer-id>] one-sentence task

Rules for your own reply:
- Stay in character.
- Do not simply restate or parrot the Master's prompt.
- If a peer already answered the Master's question correctly, AGREE or add one new angle — do NOT reiterate.
- Keep it concise. The whole room is talking; nobody needs five paragraphs from you.
- Do NOT address peers as "Master" — only the user is Master. Address peers by name.`
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

/**
 * WeChat binding metadata for a conversation. Persisted to localStorage
 * under `syntax-senpai-wechat-bindings` so inbound routing survives restarts.
 */
export interface WeChatBinding {
  peerId: string
  peerDisplayName: string | null
  contextToken: string | null
}

export const useChatStore = defineStore('chat', () => {
  const { invoke } = useIpc()
  const keyManager = useKeyManager()

  // 这一组状态就是桌面聊天会话的核心运行面：消息、会话、角色、工具和多端桥接都在这里汇总。
  const isSetup = ref(false)
  const selectedWaifuId = ref(builtInWaifus[0]?.id || 'aria')
  // User-authored waifus loaded from <userData>/waifus/*.json via the
  // waifus:list IPC. Refreshed at store init and after import/delete
  // so picker + active-waifu resolution see them without restart.
  const customWaifus = ref<Waifu[]>([])
  // Custom waifus are layered on top of built-ins keyed by id, with the
  // custom file deep-merged onto the built-in defaults. This is how partial
  // overrides (e.g. assigning a Live2D model to a built-in waifu) become
  // visible — the on-disk shadow file only carries the patched fields.
  const allWaifus = computed<Waifu[]>(() => mergeWaifus(builtInWaifus, customWaifus.value))
  const selectedProvider = ref('anthropic')
  const selectedModel = ref(DEFAULT_MODEL_BY_PROVIDER.anthropic)
  const apiKey = ref('')
  const messages = ref<Message[]>([])
  const inputValue = ref('')
  const isLoading = ref(false)
  // AbortController for the in-flight provider call(s). Set when a turn starts,
  // null when no request is active. `stopStream()` aborts and the agentic loop /
  // streaming for-await break out at their next checkpoint.
  const streamController = ref<AbortController | null>(null)
  const conversationId = ref<string | null>(null)
  const conversations = ref<any[]>([])
  const recentMessageId = ref<string | null>(null)
  const pendingClearVerification = ref(false)
  const activeCodingRepo = ref<ActiveCodingRepo | null>(null)
  const showCodeModal = ref(false)
  const codeModalMode = ref<'initial' | 'switch'>('initial')
  const initialGroupChatSettings = loadGroupChatSettings()
  const agentMode = ref<AgentMode>(
    (localStorage.getItem('syntax-senpai-agent-mode') as AgentMode) || 'ask',
  )
  const userMemories = ref<Array<{ key: string; value: string; category: string }>>([])
  const sidebarFilter = ref<'all' | 'favorites'>('all')
  const isGroupChat = ref(initialGroupChatSettings.enabled)
  const groupWaifuIds = ref<string[]>(
    initialGroupChatSettings.waifuIds.length > 0
      ? initialGroupChatSettings.waifuIds
      : builtInWaifus.slice(0, 2).map((waifu) => waifu.id),
  )
  const affection = ref(loadAffection(builtInWaifus[0]?.id || 'aria'))
  const live2dExpression = ref<string | null>(null)
  const apiTelemetry = ref<ApiTelemetry>(createEmptyApiTelemetry())
  const apiTelemetryHistory = ref<ApiTelemetrySample[]>(loadApiTelemetryHistory())
  const apiTelemetryAlert = ref<ApiTelemetryAlert>(createEmptyApiAlert())
  const enableTimeoutsAndIterationCaps = ref(readStoredBoolean(ENABLE_TIMEOUTS_AND_ITERATION_CAPS_STORAGE_KEY, false))
  const maxToolIterations = ref(readStoredNumber(
    MAX_TOOL_ITERATIONS_STORAGE_KEY,
    DEFAULT_MAX_TOOL_ITERATIONS,
    1,
    24,
  ))
  const apiSpikeThresholdMs = ref(readStoredNumber(
    API_SPIKE_THRESHOLD_STORAGE_KEY,
    DEFAULT_API_SPIKE_THRESHOLD_MS,
    250,
    60000,
  ))
  const webSearchEnabled = ref(readStoredBoolean(WEB_SEARCH_ENABLED_STORAGE_KEY, false))
  const proactiveChatEnabled = ref(readStoredBoolean(PROACTIVE_CHAT_ENABLED_STORAGE_KEY, false))
  const proactiveChatIdleFollowUpEnabled = ref(readStoredBoolean(PROACTIVE_CHAT_IDLE_FOLLOW_UP_ENABLED_STORAGE_KEY, true))
  const proactiveChatOnlineGreetingEnabled = ref(readStoredBoolean(PROACTIVE_CHAT_ONLINE_GREETING_ENABLED_STORAGE_KEY, true))
  const proactiveChatWorkHoursEnabled = ref(readStoredBoolean(PROACTIVE_CHAT_WORK_HOURS_ENABLED_STORAGE_KEY, false))
  const proactiveChatWorkHoursStart = ref(readStoredTimeString(
    PROACTIVE_CHAT_WORK_HOURS_START_STORAGE_KEY,
    DEFAULT_PROACTIVE_CHAT_WORK_HOURS_START,
  ))
  const proactiveChatWorkHoursEnd = ref(readStoredTimeString(
    PROACTIVE_CHAT_WORK_HOURS_END_STORAGE_KEY,
    DEFAULT_PROACTIVE_CHAT_WORK_HOURS_END,
  ))
  const proactiveChatDoNotDisturbEnabled = ref(readStoredBoolean(PROACTIVE_CHAT_DO_NOT_DISTURB_ENABLED_STORAGE_KEY, false))
  const proactiveChatDoNotDisturbStart = ref(readStoredTimeString(
    PROACTIVE_CHAT_DO_NOT_DISTURB_START_STORAGE_KEY,
    DEFAULT_PROACTIVE_CHAT_DO_NOT_DISTURB_START,
  ))
  const proactiveChatDoNotDisturbEnd = ref(readStoredTimeString(
    PROACTIVE_CHAT_DO_NOT_DISTURB_END_STORAGE_KEY,
    DEFAULT_PROACTIVE_CHAT_DO_NOT_DISTURB_END,
  ))
  const proactiveChatIntervalMinutes = ref(readStoredNumber(
    PROACTIVE_CHAT_INTERVAL_STORAGE_KEY,
    DEFAULT_PROACTIVE_CHAT_INTERVAL_MINUTES,
    1,
    60,
  ))
  const proactiveChatTemperature = ref(readStoredNumber(
    PROACTIVE_CHAT_TEMPERATURE_STORAGE_KEY,
    DEFAULT_PROACTIVE_CHAT_TEMPERATURE,
    0,
    1.4,
  ))
  const proactiveChatLongGapHours = ref(readStoredNumber(
    PROACTIVE_CHAT_LONG_GAP_HOURS_STORAGE_KEY,
    DEFAULT_PROACTIVE_CHAT_LONG_GAP_HOURS,
    1,
    72,
  ))
  const subagentMaxIterations = ref(readStoredNumber(
    SUBAGENT_MAX_ITERATIONS_STORAGE_KEY,
    SUBAGENT_DEFAULT_MAX_ITERATIONS,
    SUBAGENT_MIN_ITERATIONS,
    SUBAGENT_HARD_MAX_ITERATIONS,
  ))
  const subagentConcurrency = ref(readStoredNumber(
    SUBAGENT_CONCURRENCY_STORAGE_KEY,
    SUBAGENT_DEFAULT_CONCURRENCY,
    SUBAGENT_MIN_CONCURRENCY,
    SUBAGENT_HARD_MAX_CONCURRENCY,
  ))
  const effectiveMaxToolIterations = computed(() =>
    enableTimeoutsAndIterationCaps.value ? maxToolIterations.value : UNCAPPED_AGENT_ITERATION_BUDGET,
  )
  const effectiveSubagentMaxIterations = computed(() =>
    enableTimeoutsAndIterationCaps.value ? subagentMaxIterations.value : UNCAPPED_AGENT_ITERATION_BUDGET,
  )

  // Cumulative token + cost counters for the current conversation. Reset on
  // conversation switch. Stored on the store so App.vue can render them.
  const usageTotals = ref({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    turns: 0,
  })
  let proactiveChatTimer: ReturnType<typeof setTimeout> | null = null
  let onlineProactiveTimer: ReturnType<typeof setTimeout> | null = null

  function resetUsageTotals() {
    usageTotals.value = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, turns: 0 }
  }

  function recordUsage(model: string, usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) {
    if (!usage) return
    const p = usage.promptTokens || 0
    const c = usage.completionTokens || 0
    const t = usage.totalTokens || p + c
    usageTotals.value = {
      promptTokens: usageTotals.value.promptTokens + p,
      completionTokens: usageTotals.value.completionTokens + c,
      totalTokens: usageTotals.value.totalTokens + t,
      costUsd: usageTotals.value.costUsd + estimateCost(model, p, c),
      turns: usageTotals.value.turns + 1,
    }
  }

  // Active todo list rendered as a message bubble. Populated by the todo_write
  // tool; rendered by App.vue next to the assistant messages.
  const activeTodoList = ref<TodoItem[]>([])
  const approvalResolvers = new Map<string, (approved: boolean) => void>()

  // ── WeChat (iLink) inbound binding ────────────────────────────────────────
  // Each entry maps a conversationId → the WeChat peer + most recent
  // context_token. Persisted to localStorage so inbound routing survives
  // restarts. When a binding is present for the active conversation, the
  // store auto-relays the final assistant message back via `wechat:send`
  // and the system prompt switches to the WeChat block (no tables/cards).
  const WECHAT_BINDINGS_KEY = 'syntax-senpai-wechat-bindings'
  function loadWeChatBindings(): Record<string, WeChatBinding> {
    try {
      const raw = localStorage.getItem(WECHAT_BINDINGS_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, WeChatBinding>) : {}
    } catch { return {} }
  }
  function saveWeChatBindings(map: Record<string, WeChatBinding>) {
    try { localStorage.setItem(WECHAT_BINDINGS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
  }
  const wechatBindings = ref<Record<string, WeChatBinding>>(loadWeChatBindings())
  const currentWeChatBinding = computed<WeChatBinding | null>(() => {
    const cid = conversationId.value
    if (!cid) return null
    return wechatBindings.value[cid] ?? null
  })
  function setWeChatBinding(convId: string, binding: WeChatBinding | null) {
    const next = { ...wechatBindings.value }
    if (binding) next[convId] = binding
    else delete next[convId]
    wechatBindings.value = next
    saveWeChatBindings(next)
  }
  function findConvByWeChatPeer(peerId: string): string | null {
    for (const [cid, b] of Object.entries(wechatBindings.value)) {
      if (b.peerId === peerId) return cid
    }
    return null
  }

  /**
   * Route a fresh inbound WeChat message into a conversation and kick off
   * the regular send pipeline. New peers get a fresh conversation; known
   * peers reuse theirs and become the active conversation.
   */
  // 微信入口不会单独维护第二套聊天链路，而是先映射到本地会话，再复用 sendMessage 主流程。
  async function handleWeChatInbound(payload: {
    fromUserId: string
    displayName?: string | null
    text: string
    contextToken?: string | null
  }): Promise<void> {
    const peerId = payload?.fromUserId
    const text = (payload?.text ?? '').toString().trim()
    if (!peerId || !text) return

    let convId = findConvByWeChatPeer(peerId)
    if (!convId) {
      const waifu = selectedWaifu.value
      try {
        const res = await invoke(
          'store:createConversation',
          selectedWaifuId.value,
          `💬 WeChat · ${payload.displayName || peerId}`,
        )
        if (res?.success && res.conversation?.id) convId = res.conversation.id
      } catch (err) {
        console.warn('handleWeChatInbound createConversation failed', err)
      }
      if (!convId) return
      setWeChatBinding(convId, {
        peerId,
        peerDisplayName: payload.displayName ?? null,
        contextToken: payload.contextToken ?? null,
      })
      void waifu
    } else {
      // Refresh contextToken so subsequent replies thread correctly.
      setWeChatBinding(convId, {
        peerId,
        peerDisplayName: payload.displayName ?? wechatBindings.value[convId]?.peerDisplayName ?? null,
        contextToken: payload.contextToken ?? wechatBindings.value[convId]?.contextToken ?? null,
      })
    }

    await loadConversations()

    // Queue the inbound message and drain serially — never drop it just
    // because a turn is already in flight, and never let two peers' messages
    // race each other into the wrong conversation.
    wechatInboundQueue.push({
      convId,
      text,
      sourceLabel: payload.displayName || peerId,
    })
    void drainWeChatInboundQueue()
  }

  // Serialized inbound WeChat queue: each item carries its own conversation
  // so the drain switches to it before sending, and a busy `isLoading` turn
  // is waited out rather than silently dropping the message.
  // 入站消息串行排队的目的，是防止多个联系人并发消息时把回复串到错误会话里。
  const wechatInboundQueue: Array<{ convId: string; text: string; sourceLabel: string }> = []
  let drainingWeChatQueue = false
  async function drainWeChatInboundQueue(): Promise<void> {
    if (drainingWeChatQueue) return
    drainingWeChatQueue = true
    try {
      while (wechatInboundQueue.length > 0) {
        while (isLoading.value) {
          await new Promise((r) => setTimeout(r, 200))
        }
        const next = wechatInboundQueue.shift()
        if (!next) break
        if (conversationId.value !== next.convId) {
          await selectConversation(next.convId)
        }
        await sendMessage(next.text, { source: 'wechat', sourceLabel: next.sourceLabel })
      }
    } finally {
      drainingWeChatQueue = false
    }
  }

  /** Push the final assistant text back to the bound WeChat peer. Best-effort. */
  async function relayAssistantToWeChat(convId: string, content: string): Promise<void> {
    const binding = wechatBindings.value[convId]
    if (!binding || !binding.peerId) return
    const text = (content ?? '').toString().trim()
    if (!text) return
    try {
      await invoke('wechat:send', {
        toUserId: binding.peerId,
        kind: 'text',
        content: text,
        contextToken: binding.contextToken,
      })
    } catch (err) {
      console.warn('relayAssistantToWeChat failed', err)
    }
  }

  /**
   * Apply a rename_chat tool call: updates the conversation title in storage
   * and refreshes the sidebar. Returns the tool-result string the agent sees.
   */
  async function applyRenameChat(rawTitle: unknown, convId: string | null): Promise<string> {
    const title = String(rawTitle ?? '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
    if (!title) return 'Error: rename_chat requires a non-empty title.'
    if (!convId) return 'Error: no active conversation to rename.'
    try {
      const res = await invoke('store:updateConversation', convId, { title })
      if (!res?.success) return `Rename failed: ${res?.error || 'unknown error'}`
      await loadConversations()
      return `Chat renamed to: ${title}`
    } catch (err: any) {
      return `Rename failed: ${err?.message || String(err)}`
    }
  }

  // Image attachments waiting to be sent with the next user message. Held in
  // memory as data: URLs so they roundtrip through persistence + providers.
  const pendingAttachments = ref<MessageAttachment[]>([])
  const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024 // 8 MB
  const ALLOWED_ATTACHMENT_MIMES = new Set([
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  ])

  function fileToDataUrl(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error || new Error('read failed'))
      reader.onload = () => resolve(String(reader.result || ''))
      reader.readAsDataURL(file)
    })
  }

  async function addAttachment(file: File | { data: string; name?: string; type?: string; size?: number }): Promise<void> {
    let dataUrl: string
    let name: string
    let mimeType: string
    let sizeBytes: number | undefined

    if (file instanceof File) {
      if (!ALLOWED_ATTACHMENT_MIMES.has(file.type)) {
        throw new Error(`Unsupported attachment type: ${file.type || 'unknown'}`)
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Attachment too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (max 8 MB)`)
      }
      dataUrl = await fileToDataUrl(file)
      name = file.name
      mimeType = file.type
      sizeBytes = file.size
    } else {
      dataUrl = file.data
      name = file.name || 'attachment'
      mimeType = file.type || 'image/png'
      sizeBytes = file.size
    }

    pendingAttachments.value.push({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url: dataUrl,
      mimeType,
      name,
      sizeBytes,
    })
  }

  function removeAttachment(id: string) {
    pendingAttachments.value = pendingAttachments.value.filter((a) => a.id !== id)
  }

  function clearPendingAttachments() {
    pendingAttachments.value = []
  }

  // Wrap provider.chat with `withRetry` from ai-core. Routing every model call
  // through this means 429 / transient-5xx get retried with jitter AND the
  // user sees a toast so they know what's happening.
  //
  // For providers that don't support prompt caching (everything except Anthropic
  // today), flatten `cachedSystemPrompt` into `systemPrompt` so they treat it as
  // a single block. The Anthropic provider keeps them split and adds
  // `cache_control: ephemeral` to the cached prefix.
  // 对不支持 cachedSystemPrompt 的 provider，这里会在真正发请求前把两段 prompt 合并。
  async function callProviderChat(provider: any, req: any): Promise<any> {
    const finalReq = provider?.id === 'anthropic'
      ? req
      : {
          ...req,
          systemPrompt: ((req.cachedSystemPrompt || '') + (req.systemPrompt || '')) || undefined,
          cachedSystemPrompt: undefined,
        }
    return await withRetry(() => provider.chat(finalReq), {
      maxAttempts: enableTimeoutsAndIterationCaps.value ? 4 : 1,
      signal: req.signal,
      onRetry: (err, attempt, delayMs) => {
        const kind = err.kind === 'rate_limit' ? 'Rate limited' :
          err.kind === 'network' ? 'Network blip' :
          err.kind === 'timeout' ? 'Timed out' :
          err.kind === 'server' ? 'Upstream error' : 'Retrying'
        try {
          window.dispatchEvent(new CustomEvent('app:retry', {
            detail: `${kind} — retrying in ${Math.round(delayMs / 100) / 10}s (attempt ${attempt + 1})`,
          }))
        } catch { /* ignore */ }
      },
    })
  }

  // Streaming variant of callProviderChat. Drains provider.stream() and
  // assembles a chat()-shaped response so the existing tool-call loop can
  // process tool_calls unchanged. While streaming, fires onTextDelta /
  // onReasoningDelta on the request so the UI can render text live.
  //
  // Tool-call assembly (concatenating per-index argument fragments and
  // JSON-parsing once at the end) lives in the provider stream itself —
  // tool_call_delta chunks are guaranteed complete by the time they arrive
  // here, so we just collect them.
  // 这个包装器负责一边把流式 token 推给 UI，一边把最终结果重新组装成 agent loop 能消费的统一格式。
  async function streamProviderChat(provider: any, req: any): Promise<any> {
    const finalReq = provider?.id === 'anthropic'
      ? req
      : {
          ...req,
          systemPrompt: ((req.cachedSystemPrompt || '') + (req.systemPrompt || '')) || undefined,
          cachedSystemPrompt: undefined,
        }

    const drain = async (): Promise<any> => {
      let content = ''
      let reasoningContent = ''
      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []
      let synthId = 0

      for await (const chunk of provider.stream(finalReq) as AsyncIterable<any>) {
        if (req.signal?.aborted) break
        if (chunk.type === 'text_delta' && chunk.delta) {
          content += chunk.delta
          req.onTextDelta?.(chunk.delta)
        } else if (chunk.type === 'reasoning_delta' && chunk.delta) {
          reasoningContent += chunk.delta
          req.onReasoningDelta?.(chunk.delta)
        } else if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
          const tc = chunk.toolCall as { id?: string; name?: string; arguments?: any }
          toolCalls.push({
            id: tc.id && tc.id !== 'unknown' ? tc.id : `tc-${Date.now()}-${synthId++}`,
            name: tc.name || '',
            arguments: (tc.arguments && typeof tc.arguments === 'object')
              ? (tc.arguments as Record<string, unknown>)
              : {},
          })
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error || 'stream error')
        }
      }

      return {
        id: '',
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        reasoningContent: reasoningContent || undefined,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      }
    }

    return await withRetry(drain, {
      maxAttempts: enableTimeoutsAndIterationCaps.value ? 4 : 1,
      signal: req.signal,
      onRetry: (err, attempt, delayMs) => {
        const kind = err.kind === 'rate_limit' ? 'Rate limited' :
          err.kind === 'network' ? 'Network blip' :
          err.kind === 'timeout' ? 'Timed out' :
          err.kind === 'server' ? 'Upstream error' : 'Retrying'
        try {
          window.dispatchEvent(new CustomEvent('app:retry', {
            detail: `${kind} — retrying in ${Math.round(delayMs / 100) / 10}s (attempt ${attempt + 1})`,
          }))
        } catch { /* ignore */ }
      },
    })
  }

  function isAutoApprovalExemptTool(toolName: string): boolean {
    return [
      STOP_TOOL_NAME,
      SET_AFFECTION_TOOL_NAME,
      SET_EXPRESSION_TOOL_NAME,
      TODO_WRITE_TOOL_NAME,
      TODO_READ_TOOL_NAME,
      RENAME_CHAT_TOOL_NAME,
      RENDER_CARD_TOOL_NAME,
    ].includes(toolName)
  }

  function approveToolApproval(approvalId: string) {
    const resolver = approvalResolvers.get(approvalId)
    if (!resolver) return
    approvalResolvers.delete(approvalId)
    const msg = messages.value.find((message) => message.pendingApproval?.id === approvalId)
    if (msg?.pendingApproval) {
      msg.pendingApproval.status = 'approved'
      msg.content = `${msg.pendingApproval.label}\n\nApproved. Running now...`
    }
    resolver(true)
  }

  function denyToolApproval(approvalId: string) {
    const resolver = approvalResolvers.get(approvalId)
    if (!resolver) return
    approvalResolvers.delete(approvalId)
    const msg = messages.value.find((message) => message.pendingApproval?.id === approvalId)
    if (msg?.pendingApproval) {
      msg.pendingApproval.status = 'denied'
      msg.content = `${msg.pendingApproval.label}\n\nDenied by user.`
    }
    resolver(false)
  }

  function requestUserToolApproval(toolCall: ToolCall): Promise<boolean> {
    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const label = describeToolCall(toolCall)
    const details = JSON.stringify(toolCall.arguments ?? {}, null, 2).slice(0, 2000)
    const content = `Approve this action?\n\n\`${label}\`${details && details !== '{}' ? `\n\n\`\`\`json\n${details}\n\`\`\`` : ''}`
    messages.value.push({
      id: approvalId,
      role: 'assistant',
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      pendingApproval: {
        id: approvalId,
        toolName: toolCall.name,
        label,
        status: 'pending',
      },
    })
    recentMessageId.value = approvalId

    return new Promise((resolve) => {
      approvalResolvers.set(approvalId, resolve)
    })
  }

  function extractApprovalJson(text: string): { approved?: boolean; reason?: string } | null {
    const trimmed = String(text || '').trim()
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
    const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed
    try {
      return JSON.parse(candidate)
    } catch {
      return null
    }
  }

  async function reviewToolCallForAutoMode(provider: any, model: string, toolCall: ToolCall, userGoal: string): Promise<{ approved: boolean; reason: string }> {
    if (agentMode.value !== 'auto' || isAutoApprovalExemptTool(toolCall.name)) {
      return { approved: true, reason: 'Approval not required.' }
    }

    const response = await callProviderChat(provider, {
      model,
      messages: [
        {
          id: `approval-${Date.now()}`,
          role: 'user',
          content: `User goal:\n${userGoal.slice(0, 3000)}\n\nRequested tool call:\n${JSON.stringify({
            name: toolCall.name,
            arguments: toolCall.arguments,
          }, null, 2)}`,
        },
      ],
      tools: [],
      systemPrompt:
        'You are SyntaxSenpai Auto Mode action reviewer. Approve only tool calls that are clearly necessary, scoped to the user goal, and not destructive or privacy-invasive beyond what the user requested. Deny commands that delete data, rewrite history, exfiltrate secrets, install unknown software, run sudo/admin escalation, force-push, or act outside the task scope. Reply only as compact JSON: {"approved":true|false,"reason":"short reason"}.',
      cachedSystemPrompt: undefined,
      signal: streamController.value?.signal,
    })

    const parsed = extractApprovalJson(response?.content || '')
    if (!parsed || typeof parsed.approved !== 'boolean') {
      return { approved: false, reason: 'Auto Mode reviewer did not return a valid approval decision.' }
    }
    return {
      approved: parsed.approved,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : parsed.approved ? 'Approved by Auto Mode reviewer.' : 'Denied by Auto Mode reviewer.',
    }
  }

  async function executeToolCallForAgentMode(provider: any, model: string, toolCall: ToolCall, userGoal: string): Promise<string> {
    if (agentMode.value === 'ask' && !isAutoApprovalExemptTool(toolCall.name)) {
      const approved = await requestUserToolApproval(toolCall)
      if (!approved) {
        return `User denied ${toolCall.name}. Do not retry this action unless the user changes their mind. Explain what was not run and ask how to proceed.`
      }
    }
    if (agentMode.value === 'auto') {
      const decision = await reviewToolCallForAutoMode(provider, model, toolCall, userGoal)
      if (!decision.approved) {
        return `Auto Mode denied ${toolCall.name}: ${decision.reason}`
      }
    }
    return executeToolCall(toolCall)
  }

  function setAgentMode(mode: AgentMode) {
    agentMode.value = mode
    localStorage.setItem('syntax-senpai-agent-mode', mode)
  }

  function setEnableTimeoutsAndIterationCaps(enabled: boolean) {
    enableTimeoutsAndIterationCaps.value = !!enabled
    localStorage.setItem(ENABLE_TIMEOUTS_AND_ITERATION_CAPS_STORAGE_KEY, enabled ? 'true' : 'false')
  }

  function setMaxToolIterations(value: number) {
    const nextValue = Math.max(1, Math.min(24, Math.round(value)))
    maxToolIterations.value = nextValue
    localStorage.setItem(MAX_TOOL_ITERATIONS_STORAGE_KEY, String(nextValue))
  }

  function setSubagentMaxIterations(value: number) {
    const nextValue = Math.max(SUBAGENT_MIN_ITERATIONS, Math.min(SUBAGENT_HARD_MAX_ITERATIONS, Math.round(value)))
    subagentMaxIterations.value = nextValue
    localStorage.setItem(SUBAGENT_MAX_ITERATIONS_STORAGE_KEY, String(nextValue))
  }

  function setSubagentConcurrency(value: number) {
    const nextValue = Math.max(SUBAGENT_MIN_CONCURRENCY, Math.min(SUBAGENT_HARD_MAX_CONCURRENCY, Math.round(value)))
    subagentConcurrency.value = nextValue
    localStorage.setItem(SUBAGENT_CONCURRENCY_STORAGE_KEY, String(nextValue))
  }

  function setApiSpikeThresholdMs(value: number) {
    const nextValue = Math.max(250, Math.min(60000, Math.round(value)))
    apiSpikeThresholdMs.value = nextValue
    localStorage.setItem(API_SPIKE_THRESHOLD_STORAGE_KEY, String(nextValue))

    apiTelemetryHistory.value = apiTelemetryHistory.value.map((sample) => ({
      ...sample,
      alert: sample.totalMs >= nextValue || sample.lastRoundTripMs >= nextValue,
    }))
    saveApiTelemetryHistory(apiTelemetryHistory.value)

    const latestSample = apiTelemetryHistory.value[0]
    apiTelemetryAlert.value = latestSample?.alert
      ? {
          active: true,
          thresholdMs: nextValue,
          message: `${latestSample.provider} ${latestSample.model} latency spiked to ${Math.round(latestSample.totalMs)} ms`,
          triggeredAt: latestSample.measuredAt,
        }
      : {
          active: false,
          thresholdMs: nextValue,
          message: '',
          triggeredAt: null,
        }
  }

  async function setWebSearchEnabled(value: boolean) {
    const enabled = !!value
    webSearchEnabled.value = enabled
    localStorage.setItem(WEB_SEARCH_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false')
    try {
      await invoke('agent:webSearchEnabled:set', enabled)
    } catch {
      // Main-process persistence is best effort; renderer gating still applies.
    }
  }

  function clearProactiveChatTimer() {
    if (!proactiveChatTimer) return
    clearTimeout(proactiveChatTimer)
    proactiveChatTimer = null
  }

  function clearOnlineProactiveTimer() {
    if (!onlineProactiveTimer) return
    clearTimeout(onlineProactiveTimer)
    onlineProactiveTimer = null
  }

  function getProactiveScheduleWindow(now = new Date()) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    let blockedByWorkHours = false
    let blockedByDoNotDisturb = false
    let nextAllowedDelayMs: number | null = null

    if (proactiveChatWorkHoursEnabled.value) {
      const startMinutes = timeStringToMinutes(proactiveChatWorkHoursStart.value)
      const endMinutes = timeStringToMinutes(proactiveChatWorkHoursEnd.value)
      if (startMinutes != null && endMinutes != null && !isMinuteInRange(currentMinutes, startMinutes, endMinutes)) {
        blockedByWorkHours = true
        nextAllowedDelayMs = minutesUntilRangeStart(currentMinutes, startMinutes) * 60 * 1000
      }
    }

    if (proactiveChatDoNotDisturbEnabled.value) {
      const startMinutes = timeStringToMinutes(proactiveChatDoNotDisturbStart.value)
      const endMinutes = timeStringToMinutes(proactiveChatDoNotDisturbEnd.value)
      if (startMinutes != null && endMinutes != null && isMinuteInRange(currentMinutes, startMinutes, endMinutes)) {
        blockedByDoNotDisturb = true
        const dndDelayMs = minutesUntilRangeStart(currentMinutes, endMinutes) * 60 * 1000
        nextAllowedDelayMs = nextAllowedDelayMs == null ? dndDelayMs : Math.max(nextAllowedDelayMs, dndDelayMs)
      }
    }

    return {
      allowed: !blockedByWorkHours && !blockedByDoNotDisturb,
      blockedByWorkHours,
      blockedByDoNotDisturb,
      nextAllowedDelayMs,
    }
  }

  function shouldScheduleProactiveChat(trigger: 'timer' | 'online' = 'timer') {
    if (!isSetup.value) return false
    if (!proactiveChatEnabled.value) return false
    if (trigger === 'timer' && !proactiveChatIdleFollowUpEnabled.value) return false
    if (trigger === 'online' && !proactiveChatOnlineGreetingEnabled.value) return false
    if (isLoading.value) return false
    if (isGroupChat.value) return false
    if (!selectedWaifu.value) return false
    return true
  }

  function buildProactiveChatStyleInstruction() {
    const temp = proactiveChatTemperature.value
    if (temp <= 0.4) {
      return 'Keep the proactive message conservative and low-pressure. Ask at most one small follow-up question and avoid sounding pushy.'
    }
    if (temp >= 1.0) {
      return 'You can sound more proactive and energetic than usual. Lead with a sharper suggestion, a more playful observation, or a stronger invitation to continue.'
    }
    return 'Keep the proactive message balanced: warm, natural, and moderately forward without overwhelming the user.'
  }

  function buildProactiveTimingInstruction(trigger: 'timer' | 'online') {
    const now = Date.now()
    const lastUserMessageAt = readStoredTimestamp(PROACTIVE_CHAT_LAST_USER_MESSAGE_AT_STORAGE_KEY)
    const lastProactiveMessageAt = readStoredTimestamp(PROACTIVE_CHAT_LAST_PROACTIVE_MESSAGE_AT_STORAGE_KEY)
    const sinceLastUserMessageMs = lastUserMessageAt == null ? null : Math.max(0, now - lastUserMessageAt)
    const sinceLastProactiveMessageMs = lastProactiveMessageAt == null ? null : Math.max(0, now - lastProactiveMessageAt)
    const longGapThresholdMs = proactiveChatLongGapHours.value * 60 * 60 * 1000
    const isLongGap = sinceLastUserMessageMs != null && sinceLastUserMessageMs >= longGapThresholdMs
    const currentLocalTime = new Date(now).toLocaleString()
    const userGapText = formatElapsedForPrompt(sinceLastUserMessageMs)
    const proactiveGapText = formatElapsedForPrompt(sinceLastProactiveMessageMs)

    if (messages.value.length === 0 || lastUserMessageAt == null) {
      return `It is currently ${currentLocalTime}. Treat this as a fresh opening message, not a continuation of an earlier thread.`
    }

    if (isLongGap) {
      return `It is currently ${currentLocalTime}. The last user message was about ${userGapText} ago, which is beyond the configured long-gap threshold. Treat this as the user returning after a meaningful pause. Do not continue the prior topic mid-sentence; re-open gently, acknowledge a fresh return in tone only, and offer one clear next step.`
    }

    if (trigger === 'online') {
      return `It is currently ${currentLocalTime}. The user has just come online again, and their last message was about ${userGapText} ago. Send a light check-in that feels like a natural return, not a pushy interruption.`
    }

    return `It is currently ${currentLocalTime}. The last user message was about ${userGapText} ago, and the last proactive message was about ${proactiveGapText} ago. Keep the follow-up context-aware and avoid sounding repetitive.`
  }

  async function sendProactiveMessage(trigger: 'timer' | 'online' = 'timer') {
    clearProactiveChatTimer()
    if (trigger === 'online') clearOnlineProactiveTimer()
    if (!shouldScheduleProactiveChat(trigger)) return
    if (!getProactiveScheduleWindow().allowed) {
      if (trigger === 'online') scheduleOnlineProactiveChat()
      else scheduleProactiveChat()
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      scheduleProactiveChat()
      return
    }

    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const waifu = selectedWaifu.value
    if (!waifu) return

    isLoading.value = true
    streamController.value = new AbortController()

    try {
      let convId = conversationId.value
      const isNewConversation = !convId
      if (!convId) {
        convId = await createConversation()
        if (convId) conversationId.value = convId
      }
      if (isNewConversation) await loadConversations()

      const key = await keyManager.getKey(selectedProvider.value)
      if (providerRequiresApiKey(selectedProvider.value) && (!key || key === '')) {
        return
      }

      const model = selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'

      let cachedSystemPrompt = createWaifuSystemPrompt(waifu, selectedProvider.value, model, affection.value)
      cachedSystemPrompt += buildMasterContextBlock()
      cachedSystemPrompt += buildLanguagePromptBlock()
      cachedSystemPrompt += buildSkillsAuthoringPromptBlock()
      cachedSystemPrompt += formatSkillsForPrompt(availableSkills.value)
      cachedSystemPrompt += buildWeChatSessionPromptBlock(currentWeChatBinding.value)

      let systemPrompt = ''
      const firstUserMessage = messages.value.find((m) => m.role === 'user')?.content || ''
      systemPrompt += buildConversationLanguageRuleBlock(firstUserMessage)
      systemPrompt += buildMemoryContext()
      systemPrompt += buildAffectionPrompt(affection.value, waifu.displayName || 'Waifu')
      systemPrompt += buildMilestoneSidecarBlock(waifu.id)
      systemPrompt += buildApiTelemetryPrompt()
      systemPrompt += activeCodingRepo.value
        ? buildActiveCodingRepoPromptBlock(activeCodingRepo.value)
        : buildCodingSessionPromptBlock(firstUserMessage)

      const runtime = new AIChatRuntime({
        provider: providerRequiresApiKey(selectedProvider.value)
          ? ({ type: selectedProvider.value as any, apiKey: key } as any)
          : ({ type: selectedProvider.value as any } as any),
        model,
        systemPrompt,
        cachedSystemPrompt,
      })

      const aiHistory: any[] = messages.value
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: (m.attachments && m.attachments.length > 0)
            ? [
                ...(m.content ? [{ type: 'text', text: m.content }] : []),
                ...m.attachments.map((a) => ({ type: 'image_url', imageUrl: { url: a.url } })),
              ]
            : m.content,
        }))

      const proactivePrompt = messages.value.length > 0
        ? trigger === 'online'
          ? 'The user has just come online again. Based on your personality and recent context, send one brief proactive message that feels like a natural check-in. Keep it to 1-3 sentences, sound natural, do not mention timers, settings, inactivity, or system prompts, and offer one specific thing you can help with right now.'
          : 'The user has gone quiet for a bit. Based on your personality and the recent conversation, send one brief proactive follow-up. Keep it to 1-3 sentences, sound natural, do not mention timers, settings, inactivity, or system prompts, and offer a specific next step or question.'
        : 'Start the conversation proactively in character. Keep it to 1-3 sentences, sound natural, and offer one specific thing you can help with right now. Do not mention system prompts, timers, or settings.'
      const proactiveStyleInstruction = buildProactiveChatStyleInstruction()
      const proactiveTimingInstruction = buildProactiveTimingInstruction(trigger)

      let assistantContent = ''
      let assistantReasoning = ''
      const assistantId = `assistant-proactive-${Date.now()}`
      let added = false
      const streamStartedAt = performance.now()

      const ensureBubble = () => {
        if (added) return
        messages.value.push({
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: now(),
          waifuId: waifu.id,
          waifuDisplayName: waifu.displayName,
        })
        added = true
        recentMessageId.value = assistantId
      }

      const updateBubble = () => {
        const msg = messages.value.find((m) => m.id === assistantId)
        if (!msg) return
        msg.content = assistantContent
      }

      const streamIter = runtime.streamMessage({
        text: `${proactivePrompt} ${proactiveStyleInstruction} ${proactiveTimingInstruction}`,
        history: aiHistory,
        cacheBreakpointIndex: aiHistory.findIndex((m: any) => m.role === 'user'),
        temperature: proactiveChatTemperature.value,
        signal: streamController.value?.signal,
      })

      for await (const chunk of streamIter) {
        if (streamController.value?.signal.aborted) break
        if (chunk.type === 'text_delta' && chunk.delta) {
          assistantContent += chunk.delta
          ensureBubble()
          updateBubble()
        } else if (chunk.type === 'reasoning_delta' && chunk.delta) {
          assistantReasoning += chunk.delta
        }
      }

      if (!assistantContent.trim()) {
        if (added) messages.value = messages.value.filter((m) => m.id !== assistantId)
        return
      }

      const streamDurationMs = performance.now() - streamStartedAt
      recordApiTelemetry(streamDurationMs, [streamDurationMs], selectedProvider.value, model)

      const cleanContent = extractMemoryFromAIResponse(assistantContent)
      const savedMessage = messages.value.find((m) => m.id === assistantId)
      if (savedMessage) {
        savedMessage.content = cleanContent
      } else {
        messages.value.push({
          id: assistantId,
          role: 'assistant',
          content: cleanContent,
          timestamp: now(),
          waifuId: waifu.id,
          waifuDisplayName: waifu.displayName,
        })
      }
      recentMessageId.value = assistantId
      writeStoredTimestamp(PROACTIVE_CHAT_LAST_PROACTIVE_MESSAGE_AT_STORAGE_KEY)

      if (convId) {
        try {
          await invoke('store:addMessage', convId, {
            id: assistantId,
            role: 'assistant',
            content: cleanContent,
            timestamp: now(),
            waifuId: waifu.id,
            waifuDisplayName: waifu.displayName,
          })
        } catch (e) {
          console.warn('Failed to save proactive assistant message:', e)
        }
      }
    } catch (err) {
      chatLog.warn('proactive message failed', {
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      isLoading.value = false
      streamController.value = null
      scheduleProactiveChat()
    }
  }

  function scheduleOnlineProactiveChat() {
    clearOnlineProactiveTimer()
    if (!shouldScheduleProactiveChat('online')) return
    const scheduleWindow = getProactiveScheduleWindow()
    if (!scheduleWindow.allowed) {
      const delayMs = Math.max(1200, scheduleWindow.nextAllowedDelayMs ?? 1200)
      onlineProactiveTimer = setTimeout(() => {
        onlineProactiveTimer = null
        void sendProactiveMessage('online')
      }, delayMs)
      return
    }
    const now = Date.now()
    const lastOnlineAt = readStoredTimestamp(PROACTIVE_CHAT_LAST_ONLINE_AT_STORAGE_KEY)
    const lastProactiveAt = readStoredTimestamp(PROACTIVE_CHAT_LAST_PROACTIVE_MESSAGE_AT_STORAGE_KEY)
    writeStoredTimestamp(PROACTIVE_CHAT_LAST_ONLINE_AT_STORAGE_KEY, now)

    const hasMeaningfulReconnect = !lastOnlineAt || (now - lastOnlineAt) >= PROACTIVE_CHAT_ONLINE_REENGAGE_MS
    const isNotDuplicateNudge = !lastProactiveAt || (now - lastProactiveAt) >= PROACTIVE_CHAT_ONLINE_DEDUP_MS
    if (!hasMeaningfulReconnect || !isNotDuplicateNudge) {
      scheduleProactiveChat()
      return
    }

    onlineProactiveTimer = setTimeout(() => {
      onlineProactiveTimer = null
      void sendProactiveMessage('online')
    }, 1200)
  }

  function scheduleProactiveChat() {
    clearProactiveChatTimer()
    if (!shouldScheduleProactiveChat('timer')) return
    const baseDelayMs = proactiveChatIntervalMinutes.value * 60 * 1000
    const scheduleWindow = getProactiveScheduleWindow()
    const delayMs = scheduleWindow.allowed
      ? baseDelayMs
      : Math.max(baseDelayMs, scheduleWindow.nextAllowedDelayMs ?? baseDelayMs)
    proactiveChatTimer = setTimeout(() => {
      proactiveChatTimer = null
      void sendProactiveMessage()
    }, delayMs)
  }

  function setProactiveChatEnabled(value: boolean) {
    const enabled = !!value
    proactiveChatEnabled.value = enabled
    localStorage.setItem(PROACTIVE_CHAT_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false')
    scheduleProactiveChat()
    if (enabled) scheduleOnlineProactiveChat()
  }

  function setProactiveChatIdleFollowUpEnabled(value: boolean) {
    const enabled = !!value
    proactiveChatIdleFollowUpEnabled.value = enabled
    localStorage.setItem(PROACTIVE_CHAT_IDLE_FOLLOW_UP_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false')
    scheduleProactiveChat()
  }

  function setProactiveChatOnlineGreetingEnabled(value: boolean) {
    const enabled = !!value
    proactiveChatOnlineGreetingEnabled.value = enabled
    localStorage.setItem(PROACTIVE_CHAT_ONLINE_GREETING_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false')
    if (enabled) scheduleOnlineProactiveChat()
    else clearOnlineProactiveTimer()
  }

  function setProactiveChatWorkHoursEnabled(value: boolean) {
    const enabled = !!value
    proactiveChatWorkHoursEnabled.value = enabled
    localStorage.setItem(PROACTIVE_CHAT_WORK_HOURS_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false')
    scheduleProactiveChat()
    scheduleOnlineProactiveChat()
  }

  function setProactiveChatWorkHoursStart(value: string) {
    const nextValue = normalizeTimeString(value, DEFAULT_PROACTIVE_CHAT_WORK_HOURS_START)
    proactiveChatWorkHoursStart.value = nextValue
    localStorage.setItem(PROACTIVE_CHAT_WORK_HOURS_START_STORAGE_KEY, nextValue)
    scheduleProactiveChat()
    scheduleOnlineProactiveChat()
  }

  function setProactiveChatWorkHoursEnd(value: string) {
    const nextValue = normalizeTimeString(value, DEFAULT_PROACTIVE_CHAT_WORK_HOURS_END)
    proactiveChatWorkHoursEnd.value = nextValue
    localStorage.setItem(PROACTIVE_CHAT_WORK_HOURS_END_STORAGE_KEY, nextValue)
    scheduleProactiveChat()
    scheduleOnlineProactiveChat()
  }

  function setProactiveChatDoNotDisturbEnabled(value: boolean) {
    const enabled = !!value
    proactiveChatDoNotDisturbEnabled.value = enabled
    localStorage.setItem(PROACTIVE_CHAT_DO_NOT_DISTURB_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false')
    scheduleProactiveChat()
    scheduleOnlineProactiveChat()
  }

  function setProactiveChatDoNotDisturbStart(value: string) {
    const nextValue = normalizeTimeString(value, DEFAULT_PROACTIVE_CHAT_DO_NOT_DISTURB_START)
    proactiveChatDoNotDisturbStart.value = nextValue
    localStorage.setItem(PROACTIVE_CHAT_DO_NOT_DISTURB_START_STORAGE_KEY, nextValue)
    scheduleProactiveChat()
    scheduleOnlineProactiveChat()
  }

  function setProactiveChatDoNotDisturbEnd(value: string) {
    const nextValue = normalizeTimeString(value, DEFAULT_PROACTIVE_CHAT_DO_NOT_DISTURB_END)
    proactiveChatDoNotDisturbEnd.value = nextValue
    localStorage.setItem(PROACTIVE_CHAT_DO_NOT_DISTURB_END_STORAGE_KEY, nextValue)
    scheduleProactiveChat()
    scheduleOnlineProactiveChat()
  }

  function setProactiveChatIntervalMinutes(value: number) {
    const nextValue = Math.max(1, Math.min(60, Math.round(value)))
    proactiveChatIntervalMinutes.value = nextValue
    localStorage.setItem(PROACTIVE_CHAT_INTERVAL_STORAGE_KEY, String(nextValue))
    scheduleProactiveChat()
    scheduleOnlineProactiveChat()
  }

  function setProactiveChatTemperature(value: number) {
    const nextValue = Math.max(0, Math.min(1.4, Math.round(value * 100) / 100))
    proactiveChatTemperature.value = nextValue
    localStorage.setItem(PROACTIVE_CHAT_TEMPERATURE_STORAGE_KEY, String(nextValue))
    scheduleProactiveChat()
    scheduleOnlineProactiveChat()
  }

  function setProactiveChatLongGapHours(value: number) {
    const nextValue = Math.max(1, Math.min(72, Math.round(value)))
    proactiveChatLongGapHours.value = nextValue
    localStorage.setItem(PROACTIVE_CHAT_LONG_GAP_HOURS_STORAGE_KEY, String(nextValue))
    scheduleProactiveChat()
    scheduleOnlineProactiveChat()
  }

  const selectedWaifu = computed(() =>
    allWaifus.value.find(w => w.id === selectedWaifuId.value) || allWaifus.value[0],
  )

  watch(selectedWaifuId, async (waifuId, previousWaifuId) => {
    affection.value = loadAffection(waifuId)

    if (!isSetup.value || waifuId === previousWaifuId) return

    messages.value = []
    conversationId.value = null
    await loadConversations()

    const saved = localStorage.getItem('syntax-senpai-setup')
    if (!saved) return

    try {
      const parsed = JSON.parse(saved)
      localStorage.setItem('syntax-senpai-setup', JSON.stringify({
        ...parsed,
        waifuId,
      }))
    } catch {
      // Ignore malformed setup state and keep the current session running.
    }

    scheduleProactiveChat()
  })

  watch(
    [
      selectedWaifuId,
      proactiveChatEnabled,
      proactiveChatIdleFollowUpEnabled,
      proactiveChatOnlineGreetingEnabled,
      proactiveChatWorkHoursEnabled,
      proactiveChatWorkHoursStart,
      proactiveChatWorkHoursEnd,
      proactiveChatDoNotDisturbEnabled,
      proactiveChatDoNotDisturbStart,
      proactiveChatDoNotDisturbEnd,
      proactiveChatIntervalMinutes,
      proactiveChatTemperature,
      proactiveChatLongGapHours,
      isLoading,
      isGroupChat,
      conversationId,
      () => messages.value.length,
    ],
    () => {
      scheduleProactiveChat()
    },
  )

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleOnlineProactiveChat()
    })
  }

  function readProviderPreferences(): Record<string, { model?: string }> {
    try {
      return JSON.parse(localStorage.getItem(PROVIDER_PREFERENCES_KEY) || '{}')
    } catch {
      return {}
    }
  }

  function saveProviderPreferences(provider: string, updates: { model?: string }) {
    const current = readProviderPreferences()
    current[provider] = {
      ...(current[provider] || {}),
      ...updates,
    }
    localStorage.setItem(PROVIDER_PREFERENCES_KEY, JSON.stringify(current))
  }

  async function hydrateProviderConfig(provider = selectedProvider.value) {
    selectedProvider.value = provider
    apiKey.value = (await keyManager.getKey(provider)) || ''
    selectedModel.value =
      readProviderPreferences()[provider]?.model ||
      DEFAULT_MODEL_BY_PROVIDER[provider] ||
      'gpt-4o'
  }

  function loadSetup() {
    const saved = localStorage.getItem('syntax-senpai-setup')
    if (saved) {
      const { waifuId, provider, model, hasSetup } = JSON.parse(saved)
      if (hasSetup) {
        selectedWaifuId.value = waifuId
        selectedProvider.value = provider
        selectedModel.value = model || DEFAULT_MODEL_BY_PROVIDER[provider] || 'gpt-4o'
        isSetup.value = true
      }
    }

    const groupChatSettings = loadGroupChatSettings()
    isGroupChat.value = groupChatSettings.enabled
    if (groupChatSettings.waifuIds.length > 0) {
      groupWaifuIds.value = groupChatSettings.waifuIds
    }

    invoke('agent:webSearchEnabled:get')
      .then((res: any) => {
        if (res?.success) {
          webSearchEnabled.value = !!res.enabled
          localStorage.setItem(WEB_SEARCH_ENABLED_STORAGE_KEY, webSearchEnabled.value ? 'true' : 'false')
        } else {
          void setWebSearchEnabled(webSearchEnabled.value)
        }
      })
      .catch(() => {
        void setWebSearchEnabled(webSearchEnabled.value)
      })

    scheduleProactiveChat()
  }

  async function setup(apiKeyValue: string, modelValue?: string) {
    const trimmedKey = apiKeyValue.trim()
    if (trimmedKey.length > 0) {
      await keyManager.setKey(selectedProvider.value, trimmedKey)
      apiKey.value = trimmedKey
    } else {
      apiKey.value = (await keyManager.getKey(selectedProvider.value)) || ''
    }

    selectedModel.value = modelValue || selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'
    saveProviderPreferences(selectedProvider.value, { model: selectedModel.value })

    localStorage.setItem('syntax-senpai-setup', JSON.stringify({
      waifuId: selectedWaifuId.value,
      provider: selectedProvider.value,
      model: selectedModel.value,
      hasSetup: true,
      demo: false,
    }))

    isSetup.value = true
    await createConversation()
  }

  async function saveApiKey(apiKeyValue: string) {
    const trimmedKey = apiKeyValue.trim()
    if (!trimmedKey) {
      throw new Error('API key cannot be empty')
    }

    await keyManager.setKey(selectedProvider.value, trimmedKey)
    apiKey.value = trimmedKey
  }

  async function createConversation(): Promise<string | null> {
    try {
      const waifu = selectedWaifu.value
      const res = await invoke(
        'store:createConversation',
        selectedWaifuId.value,
        `${waifu?.displayName || 'Conversation'} - ${new Date().toLocaleString()}`,
      )
      if (res?.success && res.conversation?.id) {
        conversationId.value = res.conversation.id
        await loadConversations()
        return res.conversation.id
      }
    } catch (err) {
      console.warn('createConversation failed:', err)
    }
    return null
  }

  async function newChat() {
    messages.value = []
    conversationId.value = null
    resetUsageTotals()
    activeTodoList.value = []
    activeCodingRepo.value = null

    // Eagerly create a new conversation so it appears in the sidebar immediately.
    const newId = await createConversation()
    if (newId) {
      conversationId.value = newId
    }
    await loadConversations()
  }

  /**
   * Delete a single message from the local view + persistence. Used by the
   * per-message "delete" button rendered inside ChatBubble actions.
   */
  async function deleteMessage(id: string) {
    const idx = messages.value.findIndex((m) => m.id === id)
    if (idx < 0) return
    messages.value = messages.value.filter((m) => m.id !== id)
    if (conversationId.value) {
      try {
        await invoke('store:deleteMessage', conversationId.value, id)
      } catch {
        /* main handler may not support single-message delete; UI state is still updated */
      }
    }
  }

  /**
   * Re-run the most recent user turn before the given assistant message. This
   * pops the assistant reply (and any tool bubbles between it and the user
   * message) and re-sends the user's text through sendMessage.
   */
  async function regenerateFromMessage(assistantId: string) {
    const idx = messages.value.findIndex((m) => m.id === assistantId)
    if (idx < 0) return
    // Walk backwards to find the user message that produced this reply.
    let userIdx = -1
    for (let i = idx - 1; i >= 0; i--) {
      if (messages.value[i].role === 'user') { userIdx = i; break }
    }
    if (userIdx < 0) return
    const userText = messages.value[userIdx].content

    // Remove the user message + everything after it (assistant reply + tool
    // bubbles). sendMessage will re-insert the user turn and run the model.
    const removed = messages.value.slice(userIdx)
    messages.value = messages.value.slice(0, userIdx)
    if (conversationId.value) {
      for (const m of removed) {
        try { await invoke('store:deleteMessage', conversationId.value, m.id) } catch { /* best effort */ }
      }
    }
    await sendMessage(userText)
  }

  function setGroupChat(enabled: boolean) {
    isGroupChat.value = enabled
    if (enabled && groupWaifuIds.value.length === 0) {
      groupWaifuIds.value = builtInWaifus.slice(0, 2).map((waifu) => waifu.id)
    }
    if (enabled && groupWaifuIds.value.length < 2) {
      groupWaifuIds.value = Array.from(new Set([
        selectedWaifuId.value,
        builtInWaifus.find((waifu) => waifu.id !== selectedWaifuId.value)?.id || selectedWaifuId.value,
      ])).slice(0, 4)
    }
    persistGroupChatSettings(isGroupChat.value, groupWaifuIds.value)
  }

  function toggleGroupWaifu(waifuId: string) {
    const idx = groupWaifuIds.value.indexOf(waifuId)
    if (idx >= 0) {
      if (groupWaifuIds.value.length > 2) {
        groupWaifuIds.value = groupWaifuIds.value.filter((id) => id !== waifuId)
      }
    } else {
      if (groupWaifuIds.value.length >= 4) {
        return
      }
      groupWaifuIds.value = [...groupWaifuIds.value, waifuId]
    }
    persistGroupChatSettings(isGroupChat.value, groupWaifuIds.value)
  }

  const activeWaifus = computed(() => {
    if (!isGroupChat.value) return [selectedWaifu.value]
    return groupWaifuIds.value
      .map((id) => allWaifus.value.find((w) => w.id === id))
      .filter(Boolean) as Waifu[]
  })

  /**
   * Waifu-authored skills available to inject into the system prompt.
   * Refreshed on store init and after any create_skill / delete — the
   * chat store consults this list when building each turn's prompt so
   * the waifu knows what she already has and can call use_skill.
   */
  type SkillSummary = Pick<Skill, 'slug' | 'name' | 'description'>
  const availableSkills = ref<SkillSummary[]>([])

  async function refreshAvailableSkills() {
    try {
      const result: any = await invoke('skills:list')
      if (result?.success && Array.isArray(result.skills)) {
        availableSkills.value = result.skills.map((s: Skill) => ({
          slug: s.slug,
          name: s.name,
          description: s.description,
        }))
      }
    } catch {
      /* skills are optional */
    }
  }

  /**
   * Pull user-authored waifus from <userData>/waifus/*.json via the main
   * process and merge them into allWaifus. Called once at store init and
   * after Settings-tab import / delete so the picker stays in sync.
   */
  async function refreshCustomWaifus() {
    try {
      const result: any = await invoke('waifus:list')
      if (result?.success && Array.isArray(result.waifus)) {
        customWaifus.value = result.waifus as Waifu[]
      }
    } catch {
      /* non-fatal — custom waifus are optional */
    }
  }

  async function loadConversations() {
    try {
      const res = await invoke('store:listConversations', selectedWaifuId.value)
      if (res?.success) conversations.value = res.conversations || []
    } catch (err) {
      console.warn('Failed to load conversations', err)
    }
  }

  async function selectConversation(id: string) {
    conversationId.value = id
    messages.value = []
    resetUsageTotals()
    activeTodoList.value = []
    activeCodingRepo.value = null
    try {
      const res = await invoke('store:getMessages', id)
      if (res?.success) {
        // DB stores `createdAt`; normalize to `timestamp` for the UI
        messages.value = (res.messages || []).map((m: any) => ({
          ...m,
          timestamp: m.timestamp || m.createdAt || '',
        }))
      }
    } catch (err) {
      console.warn('Failed to select conversation', err)
    }
  }

  async function deleteConversation(id: string) {
    try {
      const res = await invoke('store:deleteConversation', id)
      if (res?.success) {
        await loadConversations()
        if (conversationId.value === id) {
          conversationId.value = null
          messages.value = []
          activeCodingRepo.value = null
        }
      }
    } catch (err) {
      console.warn('Failed to delete conversation', err)
    }
  }

  async function renameConversation(id: string, newTitle: string) {
    try {
      const res = await invoke('store:updateConversation', id, { title: newTitle })
      if (res?.success) await loadConversations()
    } catch (err) {
      console.warn('Rename failed:', err)
    }
  }

  async function autoNameConversation(id: string, firstUserMessage: string) {
    try {
      const key = await keyManager.getKey(selectedProvider.value)
      const model = selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'
      const waifu = selectedWaifu.value
      if (providerRequiresApiKey(selectedProvider.value) && !key) return
      const runtime = new AIChatRuntime({
        provider: providerRequiresApiKey(selectedProvider.value)
          ? ({ type: selectedProvider.value as any, apiKey: key } as any)
          : ({ type: selectedProvider.value as any } as any),
        model,
        systemPrompt: `You are ${waifu?.displayName || 'an assistant'} naming a chat for your own sidebar. Read the user's first message and reply with ONE short title (2–8 words) that captures what the conversation is really about. You can have personality — a little wink, an emoji at most — but NO surrounding quotes and NO trailing punctuation. Reply with ONLY the title, nothing else.`,
      })
      let title = ''
      for await (const chunk of runtime.streamMessage({ text: firstUserMessage, history: [] })) {
        if (chunk.type === 'text_delta' && chunk.delta) title += chunk.delta
      }
      title = title.trim().replace(/^["']|["']$/g, '').slice(0, 60)
      if (title) {
        await invoke('store:updateConversation', id, { title })
        await loadConversations()
      }
    } catch {
      // naming is best-effort, never block or surface errors
    }
  }

  async function toggleFavorite(id: string) {
    try {
      const res = await invoke('store:toggleFavorite', id)
      if (res?.success) {
        // Update local state immediately
        const conv = conversations.value.find((c: any) => c.id === id)
        if (conv) conv.favorited = res.favorited
      }
    } catch (err) {
      console.warn('Toggle favorite failed:', err)
    }
  }

  // ── AI Memory methods ──

  async function loadMemories() {
    try {
      const res = await invoke('memory:getAll')
      if (res?.success) userMemories.value = res.entries || []
    } catch (err) {
      console.warn('Failed to load memories:', err)
    }
  }

  async function setMemory(key: string, value: string, category = 'general') {
    try {
      const res = await invoke('memory:set', key, value, category)
      if (res?.success) await loadMemories()
    } catch (err) {
      console.warn('Failed to set memory:', err)
    }
  }

  async function deleteMemory(key: string) {
    try {
      const res = await invoke('memory:delete', key)
      if (res?.success) await loadMemories()
    } catch (err) {
      console.warn('Failed to delete memory:', err)
    }
  }

  async function clearMemories() {
    try {
      const res = await invoke('memory:clear')
      if (res?.success) userMemories.value = []
    } catch (err) {
      console.warn('Failed to clear memories:', err)
    }
  }

  function buildMemoryContext(): string {
    let memoryBlock = ''
    if (userMemories.value.length > 0) {
      // Rank by recency + keyword overlap with the most recent user message
      // so we don't ship the entire memory store every turn. Top 8 wins
      // 1-3K tokens once a relationship has built up a real history.
      const lastUserMessage =
        [...messages.value].reverse().find((m) => m.role === 'user')?.content || ''
      const ranked = rankMemories(userMemories.value, lastUserMessage, 8)
      const lines = ranked.map((m) => `- [${m.category}] ${m.key}: ${m.value}`)
      memoryBlock = `\nCurrently stored memories:\n${lines.join('\n')}\n`
    }
    return `\n\n[User Memory - Persistent across chats]
You have a persistent memory system. Use it to remember important things about the user across conversations.${memoryBlock}
MEMORY INSTRUCTIONS — follow these on EVERY turn:
1. After reading the user's message, decide if it contains any new information worth remembering: their name, job, skills, interests, projects they're working on, tools they use, preferences (language, framework, style), goals, personal details, opinions, or anything they explicitly ask you to remember.
2. Also consider the conversation context — if the user reveals something indirectly (e.g. asking about React implies they work with it), that counts too.
3. For each piece of new information, emit a hidden memory tag at the END of your response (after your visible reply). Format:
<memory category="CATEGORY" key="KEY">VALUE</memory>

Categories: identity, preferences, projects, skills, general, user_notes
Keys should be short and descriptive (e.g. user_name, favorite_language, current_project, job_title, preferred_framework).
If a key already exists in stored memories, reuse it to update the value.

4. You can emit multiple memory tags per response.
5. Do NOT announce or mention the memory tags to the user. Just respond naturally, then append them at the very end.
6. If the user asks you to forget something, emit: <memory-delete key="KEY_TO_DELETE"/>
7. If the user shares personal details, acknowledge them warmly in your response.
8. Use stored memories actively — reference things you know about the user naturally in conversation.

Examples of what to save:
- User says "I'm a backend dev" → <memory category="identity" key="role">backend developer</memory>
- User asks about TypeScript → <memory category="skills" key="skill_typescript">uses TypeScript</memory>
- User says "I'm building a chat app" → <memory category="projects" key="current_project">building a chat app</memory>
- User says "I prefer dark themes" → <memory category="preferences" key="ui_preference">prefers dark themes</memory>
- User discusses debugging React → <memory category="skills" key="skill_react">works with React</memory>
- User says "remember I have a meeting Friday" → <memory category="user_notes" key="note_meeting">has a meeting on Friday</memory>`
  }

  function buildApiTelemetryPrompt(): string {
    const telemetry = apiTelemetry.value
    if (!telemetry.lastResponseMs || !telemetry.provider || !telemetry.model) return ''
    const recent = apiTelemetryHistory.value.slice(0, 10)
    const average = recent.length > 0
      ? Math.round(recent.reduce((sum, sample) => sum + sample.totalMs, 0) / recent.length)
      : Math.round(telemetry.lastResponseMs)
    const latestAlert = apiTelemetryAlert.value.active
      ? `ALERT: the latest response exceeded ${apiTelemetryAlert.value.thresholdMs} ms.`
      : `Status: within the normal threshold of ${apiSpikeThresholdMs.value} ms.`

    const total = Math.round(telemetry.lastResponseMs)
    const lastRoundTrip = telemetry.lastRoundTripMs ? Math.round(telemetry.lastRoundTripMs) : total
    const rounds = telemetry.roundTrips > 0 ? telemetry.roundTrips : 1

    return `\n\n[API Response Timing]
You are aware of your most recent API timing data.
- Provider: ${telemetry.provider}
- Model: ${telemetry.model}
- Last completed reply API time: ${total} ms total
- Last provider round-trip: ${lastRoundTrip} ms
- Provider round-trips used: ${rounds}
- Recent average reply time: ${average} ms
- Timeout/retry and iteration caps: ${enableTimeoutsAndIterationCaps.value ? 'enabled' : 'disabled'}
- Maximum tool iterations allowed for a reply: ${enableTimeoutsAndIterationCaps.value ? String(maxToolIterations.value) : 'uncapped by user setting'}
- Response-time spike threshold: ${enableTimeoutsAndIterationCaps.value ? `${apiSpikeThresholdMs.value} ms` : 'disabled'}
- ${latestAlert}

Do not mention these timings unless the user asks about speed, latency, slowness, or performance. If they do ask, use these numbers accurately and stay in character.`
  }

  function recordApiTelemetry(totalMs: number, roundTripMs: number[], provider: string, model: string) {
    // 这里记录整轮回复的耗时画像，后续设置页、提示词和性能告警都会读取这些数据。
    const lastRoundTripMs = roundTripMs.length > 0 ? roundTripMs[roundTripMs.length - 1] : totalMs
    const alert = enableTimeoutsAndIterationCaps.value && (totalMs >= apiSpikeThresholdMs.value || lastRoundTripMs >= apiSpikeThresholdMs.value)

    apiTelemetry.value = {
      lastResponseMs: totalMs,
      lastRoundTripMs,
      roundTrips: roundTripMs.length,
      provider,
      model,
      measuredAt: new Date().toISOString(),
    }

    const sample: ApiTelemetrySample = {
      id: `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      totalMs,
      lastRoundTripMs,
      roundTrips: roundTripMs.length,
      provider,
      model,
      measuredAt: new Date().toISOString(),
      alert,
    }

    apiTelemetryHistory.value = [sample, ...apiTelemetryHistory.value].slice(0, API_TELEMETRY_HISTORY_LIMIT)
    saveApiTelemetryHistory(apiTelemetryHistory.value)

    apiTelemetryAlert.value = alert
      ? {
          active: true,
          thresholdMs: apiSpikeThresholdMs.value,
          message: `${provider} ${model} latency spiked to ${Math.round(totalMs)} ms`,
          triggeredAt: sample.measuredAt,
        }
      : {
          active: false,
          thresholdMs: apiSpikeThresholdMs.value,
          message: '',
          triggeredAt: null,
        }
  }

  async function sendGroupMessage(text: string) {
    if (!text.trim() || isLoading.value) return

    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const trimmedText = text.trim()

    // Consume pending attachments — they'll be persisted on this user message
    // and forwarded to the model as image_url content parts.
    const attachmentsForThisTurn = pendingAttachments.value.slice()
    pendingAttachments.value = []

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedText,
      timestamp: now(),
      ...(attachmentsForThisTurn.length > 0 ? { attachments: attachmentsForThisTurn } : {}),
    }

    messages.value.push(userMsg)
    recentMessageId.value = userMsg.id
    inputValue.value = ''
    isLoading.value = true
    streamController.value = new AbortController()

    try {
      let convId = conversationId.value
      const isNewConversation = !convId
      if (!convId) {
        convId = await createConversation()
        if (convId) conversationId.value = convId
      }
      if (convId) {
        try { await invoke('store:addMessage', convId, userMsg) } catch (e) { console.warn('Failed to save user message:', e) }
      }
      if (isNewConversation) await loadConversations()

      const key = await keyManager.getKey(selectedProvider.value)
      if (providerRequiresApiKey(selectedProvider.value) && (!key || key === '')) {
        throw new Error(`No API key configured for ${selectedProvider.value}.`)
      }
      const model = selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'
      const waifus = activeWaifus.value

      const tools = getToolsForMode(agentMode.value, { webSearchEnabled: webSearchEnabled.value, codingMode: !!activeCodingRepo.value })
      const hasTools = tools.length > 0
      let systemInfo: any = null

      if (hasTools) {
        systemInfo = (window as any).systemInfo
        if (!systemInfo || !systemInfo.homedir) {
          try { systemInfo = await invoke('terminal:systemInfo') } catch {}
        }
      }

      const sharedHistory: any[] = messages.value
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => {
          const prefixed =
            message.waifuDisplayName && message.role === 'assistant'
              ? `${message.waifuDisplayName}: ${message.content}`
              : message.content
          return {
            id: message.id,
            role: message.role,
            content: (message.attachments && message.attachments.length > 0)
              ? [
                  ...(prefixed ? [{ type: 'text', text: prefixed }] : []),
                  ...message.attachments.map((a) => ({ type: 'image_url', imageUrl: { url: a.url } })),
                ]
              : prefixed,
          }
        })

      const apiRoundTrips: number[] = []
      const assistantTurns: Array<{ waifu: any; content: string }> = []
      const maxRounds = 3
      let pendingTasks = new Map<string, string[]>()

      // 群聊按“轮次 + 委派任务”推进，而不是让所有角色无限制同时输出，避免内容爆炸和重复回答。
      for (let round = 1; round <= maxRounds; round++) {
        const waifusForRound = round === 1
          ? waifus
          : waifus.filter((waifu) => (pendingTasks.get(waifu.id) || []).length > 0)

        if (waifusForRound.length === 0) {
          break
        }

        const nextRoundTasks = new Map<string, string[]>()

        for (const waifu of waifusForRound) {
          const affectionValue = loadAffection(waifu.id)
          // Stable prefix — eligible for Anthropic prompt caching. Order must
          // not change between turns or the cache breaks.
          let cachedSystemPrompt = createWaifuSystemPrompt(waifu, selectedProvider.value, model, affectionValue)
          cachedSystemPrompt += buildMasterContextBlock()
          cachedSystemPrompt += buildLanguagePromptBlock()
          cachedSystemPrompt += buildSkillsAuthoringPromptBlock()
          cachedSystemPrompt += formatSkillsForPrompt(availableSkills.value)
          cachedSystemPrompt += buildWeChatSessionPromptBlock(currentWeChatBinding.value)
          if (hasTools) {
            if (systemInfo && systemInfo.homedir) {
              cachedSystemPrompt += `\n\n[System Environment]\nOS: ${systemInfo.platform}\nUsername: ${systemInfo.username}\nHome directory: ${systemInfo.homedir}\nShell: ${systemInfo.shell ?? 'unknown'}`
            }
            cachedSystemPrompt += buildAgentAccessPrompt(agentMode.value)
            cachedSystemPrompt += buildAgentBehaviorPrompt(systemInfo?.shell, waifu.displayName || 'your waifu persona', webSearchEnabled.value)
          }

          // Volatile suffix — changes per turn, never marked cacheable.
          let systemPrompt = ''
          systemPrompt += buildConversationLanguageRuleBlock(messages.value.find((m) => m.role === 'user')?.content || trimmedText)
          systemPrompt += buildMemoryContext()
          systemPrompt += buildAffectionPrompt(affectionValue, waifu.displayName || 'Waifu')
          systemPrompt += buildMilestoneSidecarBlock(waifu.id)
          systemPrompt += buildApiTelemetryPrompt()
          systemPrompt += buildGroupChatPromptBlock(waifu, waifus, pendingTasks.get(waifu.id) || [], round)
          systemPrompt += activeCodingRepo.value
            ? buildActiveCodingRepoPromptBlock(activeCodingRepo.value)
            : buildCodingSessionPromptBlock(trimmedText)

          const runtime = new AIChatRuntime({
            provider: providerRequiresApiKey(selectedProvider.value)
              ? ({ type: selectedProvider.value as any, apiKey: key } as any)
              : ({ type: selectedProvider.value as any } as any),
            model,
            systemPrompt,
            cachedSystemPrompt,
          })

          let finalContent = ''

          // 每个 waifu 都维护自己的流式消息气泡，确保群聊里能看清是谁在输出、谁在调用工具。
          // Live streaming bubble for this waifu's turn. Used by both the
          // tools+streaming branch and the no-tools streaming branch so the
          // user sees text flowing in as the model produces it.
          const turnLiveAssistantId = `assistant-${waifu.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          let liveBubbleAdded = false

          if (hasTools) {
            const provider = runtime.getProvider()
            const aiHistory = [...sharedHistory]
            const maxIterations = effectiveMaxToolIterations.value
            const toolMsgIds: string[] = []
            const pendingCards: RenderCardPayload[] = []

            let liveText = ''
            let liveReasoning = ''

            const ensureLiveBubble = () => {
              if (liveBubbleAdded) return
              messages.value.push({
                id: turnLiveAssistantId,
                role: 'assistant',
                content: '',
                timestamp: now(),
                waifuId: waifu.id,
                waifuDisplayName: waifu.displayName,
              } as Message)
              recentMessageId.value = turnLiveAssistantId
              liveBubbleAdded = true
            }
            const updateLiveBubble = () => {
              if (!liveBubbleAdded) return
              const m = messages.value.find((x) => x.id === turnLiveAssistantId)
              if (!m) return
              m.content = liveText
            }

            const turnResult = await runAgentTurn({
              callProvider: (req) => streamProviderChat(provider, req),
              model,
              history: aiHistory,
              tools,
              systemPrompt,
              cachedSystemPrompt,
              cacheBreakpointIndex: aiHistory.findIndex((m: any) => m.role === 'user'),
              maxIterations,
              abortSignal: streamController.value?.signal,
              onAssistantIterationStart: () => {
                liveText = ''
                liveReasoning = ''
                updateLiveBubble()
              },
              onAssistantTextDelta: (delta) => {
                ensureLiveBubble()
                liveText += delta
                updateLiveBubble()
              },
              onAssistantReasoningDelta: (delta) => {
                liveReasoning += delta
              },
              handleSideEffect: async (toolCall): Promise<SideEffectResult | null> => {
                if (toolCall.name === STOP_TOOL_NAME) {
                  return {
                    resultContent: 'ok',
                    stop: true,
                    finalContent: (toolCall.arguments as any).final_message || '',
                  }
                }
                if (toolCall.name === SET_AFFECTION_TOOL_NAME) {
                  const newVal = clampAffection(Number((toolCall.arguments as any).value ?? affectionValue))
                  const milestone = updateAffectionWithMilestone(waifu.id, newVal)
                  if (selectedWaifuId.value === waifu.id) {
                    affection.value = newVal
                  }
                  if (milestone) emitMilestoneToast(waifu, milestone)
                  return { resultContent: `好感度 updated to ${newVal}` }
                }
                if (toolCall.name === SET_EXPRESSION_TOOL_NAME) {
                  const expr = String((toolCall.arguments as any).expression || 'neutral')
                  if (selectedWaifuId.value === waifu.id) {
                    live2dExpression.value = expr
                  }
                  return { resultContent: `Expression set to ${expr}` }
                }
                if (toolCall.name === TODO_WRITE_TOOL_NAME) {
                  const items = parseTodoList((toolCall.arguments as any).items)
                  activeTodoList.value = items
                  return { resultContent: `Todo list updated (${items.filter((i) => i.status === 'done').length}/${items.length} done).` }
                }
                if (toolCall.name === TODO_READ_TOOL_NAME) {
                  return { resultContent: formatTodoList(activeTodoList.value) }
                }
                if (toolCall.name === RENAME_CHAT_TOOL_NAME) {
                  const renameResult = await applyRenameChat((toolCall.arguments as any).title, conversationId.value)
                  return { resultContent: renameResult }
                }
                if (toolCall.name === RENDER_CARD_TOOL_NAME) {
                  const payload = parseRenderCardArgs(toolCall.arguments)
                  if (payload) {
                    pendingCards.push(payload)
                    return { resultContent: `Rendered ${payload.type} card.` }
                  }
                  return { resultContent: 'Error: render_card requires a valid { type, data } object. Supported types: weather, table, link_preview, code_comparison.' }
                }
                if (toolCall.name === DISPATCH_SUBAGENTS_TOOL_NAME) {
                  const args = (toolCall.arguments ?? {}) as { rationale?: string; subagents?: any[] }
                  const specs = Array.isArray(args.subagents) ? args.subagents : []
                  const dispatchMsgId = `tool-${waifu.id}-${Date.now()}-${toolCall.id}`
                  toolMsgIds.push(dispatchMsgId)
                  const initialMessage: Message = {
                    id: dispatchMsgId,
                    role: 'assistant',
                    content: `${waifu.displayName} is running 🤖 dispatch_subagents (${specs.length} subagent${specs.length === 1 ? '' : 's'} starting…)`,
                    timestamp: now(),
                    waifuId: waifu.id,
                    waifuDisplayName: waifu.displayName,
                  }
                  ;(initialMessage as any).subagents = []
                  messages.value.push(initialMessage)
                  const dispatchResult = await dispatchSubagents({
                    rationale: typeof args.rationale === 'string' ? args.rationale : '',
                    subagents: specs.map((s: any) => ({ name: s?.name, task: String(s?.task ?? '') })),
                    parentTools: tools,
                    callProvider: (req) => streamProviderChat(provider, req),
                    model,
                    cwd: activeCodingRepo.value?.path,
                    parentMaxIterations: maxIterations,
                    subagentMaxIterations: effectiveSubagentMaxIterations.value,
                    abortSignal: streamController.value?.signal,
                    executeTool: (call) => executeToolCallForAgentMode(provider, model, call, trimmedText),
                    onSnapshot: (snaps) => {
                      const msg = messages.value.find((m) => m.id === dispatchMsgId) as (Message & { subagents?: SubagentSnapshot[] }) | undefined
                      if (msg) msg.subagents = snaps as SubagentSnapshot[]
                    },
                  })
                  const completed = dispatchResult.snapshots.filter((s) => s.status === 'completed').length
                  const failed = dispatchResult.snapshots.length - completed
                  const dispatchMsg = messages.value.find((m) => m.id === dispatchMsgId)
                  if (dispatchMsg) {
                    dispatchMsg.content = `${waifu.displayName} ran 🤖 dispatch_subagents (${completed} completed, ${failed} failed of ${dispatchResult.snapshots.length})`
                  }
                  return { resultContent: dispatchResult.aggregateResult }
                }
                return null
              },
              executeTool: (toolCall) => executeToolCallForAgentMode(provider, model, toolCall, trimmedText),
              onToolStart: (toolCall) => {
                const label = describeToolCall(toolCall)
                const toolMsgId = `tool-${waifu.id}-${Date.now()}-${toolCall.id}`
                toolMsgIds.push(toolMsgId)
                messages.value.push({
                  id: toolMsgId,
                  role: 'assistant',
                  content: `${waifu.displayName} is running \`${label}\``,
                  timestamp: now(),
                  waifuId: waifu.id,
                  waifuDisplayName: waifu.displayName,
                })
                return toolMsgId
              },
              onToolResult: (toolCall, result, msgId) => {
                if (!msgId) return
                const label = describeToolCall(toolCall)
                const preview = result.length > 500 ? result.slice(0, 500) + '\u2026' : result
                const toolMsg = messages.value.find((message) => message.id === msgId)
                if (toolMsg) {
                  toolMsg.content = `${waifu.displayName} ran \`${label}\`\n\`\`\`\n${preview}\n\`\`\``
                }
              },
              onApiRoundTrip: (dur, response) => {
                apiRoundTrips.push(dur)
                recordUsage(model, response?.usage)
              },
            })

            finalContent = turnResult.finalContent

            if (pendingCards.length > 0) {
              finalContent = prependCardMarkers(pendingCards, finalContent)
            }

            // Mark every tool bubble emitted during this waifu's turn as a
            // process step so the UI folds them behind the collapsible
            // "process" panel above the final reply, instead of deleting
            // them (the previous behavior threw away the trace entirely).
            if (finalContent && toolMsgIds.length > 0) {
              const stepIds = new Set(toolMsgIds)
              for (const m of messages.value) {
                if (stepIds.has(m.id)) (m as Message).isProcessStep = true
              }
            }
          } else {
            // No-tools branch: stream directly into the live bubble.
            // Cache the reactive proxy after push and batch content writes via
            // rAF — per-chunk find() is O(n) and per-chunk reactive churn is
            // wasted work when many tokens arrive between display frames.
            // Cast on init to avoid TS narrowing the captured variable to `null`.
            let liveMsgRef = null as Message | null
            const ensureBubble = () => {
              if (liveBubbleAdded) return
              messages.value.push({
                id: turnLiveAssistantId,
                role: 'assistant',
                content: '',
                timestamp: now(),
                waifuId: waifu.id,
                waifuDisplayName: waifu.displayName,
              } as Message)
              liveMsgRef = messages.value[messages.value.length - 1]
              recentMessageId.value = turnLiveAssistantId
              liveBubbleAdded = true
            }
            let flushScheduled = false
            const flushContent = () => {
              flushScheduled = false
              if (liveMsgRef) liveMsgRef.content = finalContent
            }
            const scheduleFlush = () => {
              if (flushScheduled) return
              flushScheduled = true
              if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flushContent)
              else queueMicrotask(flushContent)
            }
            const streamStartedAt = performance.now()
            for await (const chunk of runtime.streamMessage({ text: trimmedText, history: sharedHistory, cacheBreakpointIndex: sharedHistory.findIndex((m: any) => m.role === 'user'), signal: streamController.value?.signal })) {
              if (streamController.value?.signal.aborted) break
              if (chunk.type === 'text_delta' && chunk.delta) {
                finalContent += chunk.delta
                ensureBubble()
                scheduleFlush()
              } else if (chunk.type === 'done' && chunk.usage) {
                recordUsage(model, chunk.usage)
              }
            }
            // Final synchronous write so the bubble reflects the complete
            // response before downstream code reads it.
            if (liveMsgRef) liveMsgRef.content = finalContent
            apiRoundTrips.push(performance.now() - streamStartedAt)
          }

          const { cleanedText, tasks } = extractDelegatedTasks(finalContent || 'Done.')
          const cleanContent = extractMemoryFromAIResponse(cleanedText || 'Done.')
          assistantTurns.push({ waifu, content: cleanContent })
          // sharedHistory 会把前一个 waifu 的输出注入给后一个 waifu，形成“角色彼此可见”的群聊上下文。
          sharedHistory.push({
            id: `assistant-${waifu.id}-${round}-${assistantTurns.length}`,
            role: 'assistant',
            content: `${waifu.displayName}: ${cleanContent}`,
          })

          // Finalize the live bubble (created during streaming) with the
          // cleaned content and persist it. If no bubble was created (e.g.
          // streaming yielded nothing), push a fresh one so the user still
          // sees the response.
          if (liveBubbleAdded) {
            const liveMsg = messages.value.find((m) => m.id === turnLiveAssistantId)
            if (liveMsg) {
              liveMsg.content = cleanContent
              liveMsg.timestamp = now()
              recentMessageId.value = turnLiveAssistantId
            }
            if (convId) {
              try {
                await invoke('store:addMessage', convId, {
                  id: turnLiveAssistantId,
                  role: 'assistant',
                  content: cleanContent,
                  timestamp: now(),
                  waifuId: waifu.id,
                  waifuDisplayName: waifu.displayName,
                } as Message)
              } catch (e) { console.warn('Failed to save assistant message:', e) }
            }
          } else {
            const assistantMsg: Message = {
              id: turnLiveAssistantId,
              role: 'assistant',
              content: cleanContent,
              timestamp: now(),
              waifuId: waifu.id,
              waifuDisplayName: waifu.displayName,
            }
            messages.value.push(assistantMsg)
            recentMessageId.value = turnLiveAssistantId
            if (convId) {
              try { await invoke('store:addMessage', convId, assistantMsg) } catch (e) { console.warn('Failed to save assistant message:', e) }
            }
          }

          for (const task of tasks) {
            if (!waifus.some((candidate) => candidate.id === task.targetWaifuId)) {
              continue
            }
            const currentTasks = nextRoundTasks.get(task.targetWaifuId) || []
            currentTasks.push(`${waifu.displayName}: ${task.instruction}`)
            nextRoundTasks.set(task.targetWaifuId, currentTasks)
          }
        }

        pendingTasks = nextRoundTasks
      }

      if (apiRoundTrips.length > 0) {
        recordApiTelemetry(
          apiRoundTrips.reduce((sum, value) => sum + value, 0),
          apiRoundTrips,
          selectedProvider.value,
          model,
        )
      }

      // assistantTurns is retained for parity with the previous API contract
      // but bubbles are now committed in-place during streaming above.
      void assistantTurns

      if (isNewConversation && convId) autoNameConversation(convId, text)
      extractAndSaveMemory(trimmedText)
    } catch (err: any) {
      const classified = classifyError(err, { provider: selectedProvider.value })
      chatLog.error('sendGroupMessage failed', {
        kind: classified.kind,
        status: classified.status,
        provider: selectedProvider.value,
        model: selectedModel.value,
        hint: classified.hint,
        message: classified.message,
        stack: err instanceof Error ? err.stack : undefined,
      })
      messages.value.push({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${describeError(err)}`,
        timestamp: now(),
      })
    } finally {
      isLoading.value = false
      streamController.value = null
      setTimeout(() => { recentMessageId.value = null }, 1100)
    }
  }

  async function sendMessage(
    text: string,
    opts: { source?: 'wechat'; sourceLabel?: string } = {},
  ) {
    // 单聊主入口：命令处理、显式终端执行、普通聊天、agent 工具循环都从这里分流。
    if (isGroupChat.value && groupWaifuIds.value.length > 0) {
      return sendGroupMessage(text)
    }

    if (!text.trim() || isLoading.value) return

    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const trimmedText = text.trim()
    writeStoredTimestamp(PROACTIVE_CHAT_LAST_USER_MESSAGE_AT_STORAGE_KEY)
    const setMeterMatch = trimmedText.match(/^\/setmeter\s+(-?\d+(?:\.\d+)?)$/i)

    if (setMeterMatch) {
      const newVal = clampAffection(Number(setMeterMatch[1]))
      affection.value = newVal
      const milestone = updateAffectionWithMilestone(selectedWaifuId.value, newVal)
      if (milestone) {
        const waifu = allWaifus.value.find((w) => w.id === selectedWaifuId.value)
        if (waifu) emitMilestoneToast(waifu, milestone)
      }
      inputValue.value = ''

      const assistantId = `assistant-${Date.now()}`
      messages.value.push({
        id: assistantId,
        role: 'assistant',
        content: `好感度 forced to ${newVal}.`,
        timestamp: now(),
      })
      recentMessageId.value = assistantId
      setTimeout(() => { recentMessageId.value = null }, 1100)
      return
    }

    if (/^\/code(?:\s.*)?$/i.test(trimmedText)) {
      codeModalMode.value = activeCodingRepo.value ? 'switch' : 'initial'
      showCodeModal.value = true
      inputValue.value = ''
      return
    }

    if (/^\/endcode$/i.test(trimmedText)) {
      const wasActive = !!activeCodingRepo.value
      const repoName = activeCodingRepo.value?.name
      activeCodingRepo.value = null
      inputValue.value = ''
      const assistantId = `assistant-${Date.now()}`
      messages.value.push({
        id: assistantId,
        role: 'assistant',
        content: wasActive
          ? `Coding mode off. We can stop poking at ${repoName} now~ 💤`
          : `We weren't even in coding mode. Type /code when you want me to pair up.`,
        timestamp: now(),
      })
      recentMessageId.value = assistantId
      setTimeout(() => { recentMessageId.value = null }, 1100)
      return
    }

    const clearMatch = /^\/clear$/i.test(trimmedText)
    const verifyClearMatch = /^\/(?:verify|vierfy)\s+deletion$/i.test(trimmedText)

    if (clearMatch) {
      pendingClearVerification.value = true
      inputValue.value = ''

      const assistantId = `assistant-${Date.now()}`
      messages.value.push({
        id: assistantId,
        role: 'assistant',
        content: 'Type /verify deletion to clear this chat history. (Conversation ID will stay the same.)',
        timestamp: now(),
      })
      recentMessageId.value = assistantId
      setTimeout(() => { recentMessageId.value = null }, 1100)
      return
    }

    if (pendingClearVerification.value) {
      if (verifyClearMatch) {
        pendingClearVerification.value = false
        inputValue.value = ''

        const convId = conversationId.value
        messages.value = []

        if (convId) {
          try { await invoke('store:clearMessages', convId) } catch (e) { console.warn('Failed to clear conversation messages:', e) }
          await loadConversations()
        }
        return
      } else {
        pendingClearVerification.value = false
        inputValue.value = ''
        const assistantId = `assistant-${Date.now()}`
        messages.value.push({
          id: assistantId,
          role: 'assistant',
          content: 'Clear request canceled. Continuing chat.',
          timestamp: now(),
        })
        recentMessageId.value = assistantId
        setTimeout(() => { recentMessageId.value = null }, 1100)
      }
    }

    const explicitTerminalCommand = extractExplicitTerminalCommand(trimmedText)
    if (explicitTerminalCommand) {
      // 这一分支是用户显式要求跑命令时的快速通道：直接执行终端，不再经过模型推理。
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmedText,
        timestamp: now(),
        ...(opts.source ? { source: opts.source, sourceLabel: opts.sourceLabel } : {}),
      }

      messages.value.push(userMsg)
      recentMessageId.value = userMsg.id
      inputValue.value = ''
      isLoading.value = true

      try {
        let convId = conversationId.value
        const isNewConversation = !convId
        if (!convId) {
          convId = await createConversation()
          if (convId) conversationId.value = convId
        }

        if (convId) {
          try { await invoke('store:addMessage', convId, userMsg) } catch (e) { console.warn('Failed to save user message:', e) }
        }
        if (isNewConversation) await loadConversations()

        const result = await invoke('terminal:exec', explicitTerminalCommand)
        const stdout = result?.stdout || ''
        const stderr = result?.stderr || ''
        const code = result?.code ?? 0
        let output = stdout
        if (stderr) output += (output ? '\n' : '') + `STDERR: ${stderr}`
        if (!String(output).trim()) output = `(exit code ${code})`

        const assistantId = `assistant-${Date.now()}`
        const assistantContent = `Executed:\n$ ${explicitTerminalCommand}\n\n${output}`
        const assistantMsg: Message = {
          id: assistantId,
          role: 'assistant',
          content: assistantContent,
          timestamp: now(),
        }

        messages.value.push(assistantMsg)
        recentMessageId.value = assistantId

        if (convId) {
          try { await invoke('store:addMessage', convId, assistantMsg) } catch (e) { console.warn('Failed to save assistant message:', e) }
          if (isNewConversation) autoNameConversation(convId, trimmedText)
        }
      } catch (err: any) {
        chatLog.error('explicit terminal command failed', {
          command: explicitTerminalCommand,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
        messages.value.push({
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${describeError(err)}`,
          timestamp: now(),
        })
      } finally {
        isLoading.value = false
        setTimeout(() => { recentMessageId.value = null }, 1100)
      }

      return
    }

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedText,
      timestamp: now(),
      ...(opts.source ? { source: opts.source, sourceLabel: opts.sourceLabel } : {}),
    }

    messages.value.push(userMsg)
    recentMessageId.value = userMsg.id
    inputValue.value = ''
    isLoading.value = true
    streamController.value = new AbortController()

    try {
      let convId = conversationId.value
      const isNewConversation = !convId
      if (!convId) {
        convId = await createConversation()
        if (convId) conversationId.value = convId
      }
      if (convId) {
        try { await invoke('store:addMessage', convId, userMsg) } catch (e) { console.warn('Failed to save user message:', e) }
      }
      // Refresh sidebar immediately so the new conversation is visible
      if (isNewConversation) await loadConversations()

      const key = await keyManager.getKey(selectedProvider.value)
      const waifu = selectedWaifu.value

      if (providerRequiresApiKey(selectedProvider.value) && (!key || key === '')) {
        throw new Error(`No API key configured for ${selectedProvider.value}. Open Settings and add one to chat with ${waifu?.displayName || 'your assistant'}.`)
      }

      const model = selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'

      // Stable prefix — eligible for Anthropic prompt caching. Order must
      // not change between turns or the cache breaks.
      let cachedSystemPrompt = createWaifuSystemPrompt(waifu, selectedProvider.value, model, affection.value)
      cachedSystemPrompt += buildMasterContextBlock()
      cachedSystemPrompt += buildLanguagePromptBlock()
      cachedSystemPrompt += buildSkillsAuthoringPromptBlock()
      cachedSystemPrompt += formatSkillsForPrompt(availableSkills.value)
      cachedSystemPrompt += buildWeChatSessionPromptBlock(currentWeChatBinding.value)

      // Volatile suffix — changes per turn, never marked cacheable.
      let systemPrompt = ''
      systemPrompt += buildConversationLanguageRuleBlock(messages.value.find((m) => m.role === 'user')?.content || trimmedText)
      systemPrompt += buildMemoryContext()
      systemPrompt += buildAffectionPrompt(affection.value, waifu?.displayName || 'Waifu')
      systemPrompt += buildMilestoneSidecarBlock(waifu.id)
      systemPrompt += buildApiTelemetryPrompt()
      systemPrompt += activeCodingRepo.value
        ? buildActiveCodingRepoPromptBlock(activeCodingRepo.value)
        : buildCodingSessionPromptBlock(trimmedText)

      const tools = getToolsForMode(agentMode.value, { webSearchEnabled: webSearchEnabled.value, codingMode: !!activeCodingRepo.value })
      const hasTools = tools.length > 0

      // Inject system context so the AI knows the user's environment
      if (hasTools) {
        let sys = (window as any).systemInfo
        if (!sys || !sys.homedir) {
          try { sys = await invoke('terminal:systemInfo') } catch {}
        }
        if (sys && sys.homedir) {
          cachedSystemPrompt += `\n\n[System Environment]\nOS: ${sys.platform}\nUsername: ${sys.username}\nHome directory: ${sys.homedir}\nShell: ${sys.shell ?? 'unknown'}`
        }
        cachedSystemPrompt += buildAgentAccessPrompt(agentMode.value)
        cachedSystemPrompt += buildAgentBehaviorPrompt(sys?.shell, waifu?.displayName || 'your waifu persona', webSearchEnabled.value)
      }

      const runtime = new AIChatRuntime({
        provider: providerRequiresApiKey(selectedProvider.value)
          ? ({ type: selectedProvider.value as any, apiKey: key } as any)
          : ({ type: selectedProvider.value as any } as any),
        model,
        systemPrompt,
        cachedSystemPrompt,
      })

      if (hasTools) {
        // ── Agentic loop: AI calls terminal, repeats until stop_response ──
        // 有工具时，模型会在“思考 → 调工具 → 读结果 → 再决定”之间循环，直到 stop_response 给出最终答复。
        const provider = runtime.getProvider()

        // Build AI-compatible message history (skip tool-display messages from
        // UI, and the intermediate live bubbles we now retain behind the
        // collapsible "process" panel — neither belongs in the canonical turn
        // history we send back to the model).
        // When a user message has image attachments, emit ContentPart[] so the
        // provider mapper translates them to the provider's multi-modal shape.
        const aiHistory: any[] = messages.value
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.isProcessStep && !m.id.startsWith('tool-'))
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: (m.attachments && m.attachments.length > 0)
              ? [
                  ...(m.content ? [{ type: 'text', text: m.content }] : []),
                  ...m.attachments.map((a) => ({ type: 'image_url', imageUrl: { url: a.url } })),
                ]
              : m.content,
          }))

        const maxIterations = effectiveMaxToolIterations.value
        // Tracks every bubble produced inside this turn that is NOT the final
        // assistant reply — tool execution bubbles plus intermediate live
        // bubbles from earlier iterations. After the turn settles we mark
        // each of these with `isProcessStep: true` so the UI folds them into
        // the collapsible "process" panel above the final reply.
        const processStepIds: string[] = []
        const apiRoundTrips: number[] = []
        const pendingCards: RenderCardPayload[] = []

        // Live streaming bubbles: each assistant iteration gets its own bubble
        // so later tool-thinking/output doesn't overwrite earlier text.
        let liveBubbleSequence = 0
        let liveAssistantId = `assistant-${Date.now()}-${++liveBubbleSequence}`
        let liveBubbleAdded = false
        let liveText = ''
        let liveReasoning = ''
        // Cast on init avoids TS narrowing the closure-captured variable to `null`.
        let liveMsgRef = null as Message | null
        let liveFlushScheduled = false
        let liveStreamSettled = false
        const persistedLiveBubbleIds = new Set<string>()
        const liveBubbleSaveTasks: Promise<unknown>[] = []

        const queueLiveBubbleSave = (msg: Message) => {
          if (!convId) return
          if (persistedLiveBubbleIds.has(msg.id)) return
          persistedLiveBubbleIds.add(msg.id)
          liveBubbleSaveTasks.push(
            invoke('store:addMessage', convId, {
              id: msg.id,
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp,
              waifuId: msg.waifuId,
              waifuDisplayName: msg.waifuDisplayName,
              // Carry the process-step flag through to storage so the collapse
              // behavior survives reload. The flag may still be undefined here
              // (it's only set once the turn finalizes); a second save with the
              // flag set is debounced by `persistedLiveBubbleIds`, so update
              // happens in-memory only — acceptable since the canonical reply
              // is the final live bubble, which is never a process step.
              isProcessStep: msg.isProcessStep,
            }).catch((e) => {
              console.warn('Failed to save assistant message:', e)
            }),
          )
        }

        const beginNextLiveBubble = () => {
          // The bubble that was just finalized is by definition not the final
          // reply (a new iteration is starting), so record it for the
          // post-turn process-step marking pass.
          if (liveBubbleAdded && liveAssistantId) {
            processStepIds.push(liveAssistantId)
          }
          liveAssistantId = `assistant-${Date.now()}-${++liveBubbleSequence}`
          liveBubbleAdded = false
          liveText = ''
          liveReasoning = ''
          liveMsgRef = null
          liveFlushScheduled = false
        }

        const computeLiveContent = () =>
          liveText

        const flushLiveBubble = () => {
          liveFlushScheduled = false
          // Once the turn settles, the post-turn cleanContent write owns the
          // bubble — drop any in-flight rAF callback so we don't clobber it.
          if (liveStreamSettled) return
          if (liveMsgRef) liveMsgRef.content = computeLiveContent()
        }

        const ensureLiveBubble = () => {
          if (liveBubbleAdded) return
          const message: Message = {
            id: liveAssistantId,
            role: 'assistant',
            content: '',
            timestamp: now(),
            waifuId: waifu?.id,
            waifuDisplayName: waifu?.displayName,
          }
          messages.value.push(message)
          liveMsgRef = message
          recentMessageId.value = liveAssistantId
          liveBubbleAdded = true
        }

        const finalizeLiveBubble = () => {
          if (!liveBubbleAdded || !liveMsgRef) return
          const content = computeLiveContent().trim()
          if (!content) return
          liveMsgRef.content = content
          queueLiveBubbleSave(liveMsgRef)
        }

        // Batch reactive writes via rAF — token deltas can arrive faster than
        // the display refresh, and per-chunk reactive churn (plus a per-chunk
        // O(n) find) was the dominant cost during streaming.
        const updateLiveBubble = () => {
          if (!liveBubbleAdded) return
          if (liveFlushScheduled) return
          liveFlushScheduled = true
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flushLiveBubble)
          else queueMicrotask(flushLiveBubble)
        }

        const turnResult = await runAgentTurn({
          callProvider: (req) => streamProviderChat(provider, req),
          model,
          history: aiHistory,
          tools,
          systemPrompt,
          cachedSystemPrompt,
          cacheBreakpointIndex: aiHistory.findIndex((m: any) => m.role === 'user'),
          maxIterations,
          abortSignal: streamController.value?.signal,
          onAssistantIterationStart: () => {
            finalizeLiveBubble()
            beginNextLiveBubble()
          },
          onAssistantTextDelta: (delta) => {
            ensureLiveBubble()
            liveText += delta
            updateLiveBubble()
          },
          onAssistantReasoningDelta: (delta) => {
            liveReasoning += delta
          },
          handleSideEffect: async (tc): Promise<SideEffectResult | null> => {
            // 这些工具会直接修改 store 状态，因此要在这里拦截处理，而不是交给通用工具执行器黑盒处理。
            if (tc.name === STOP_TOOL_NAME) {
              return {
                resultContent: 'ok',
                stop: true,
                finalContent: (tc.arguments as any).final_message || '',
              }
            }
            if (tc.name === SET_AFFECTION_TOOL_NAME) {
              const newVal = Math.max(0, Math.min(100, Math.round(+(tc.arguments as any).value || affection.value)))
              affection.value = newVal
              const milestone = updateAffectionWithMilestone(selectedWaifuId.value, newVal)
              if (milestone) {
                const w = allWaifus.value.find((x) => x.id === selectedWaifuId.value)
                if (w) emitMilestoneToast(w, milestone)
              }
              return { resultContent: `好感度 updated to ${newVal}` }
            }
            if (tc.name === SET_EXPRESSION_TOOL_NAME) {
              const expr = String((tc.arguments as any).expression || 'neutral')
              live2dExpression.value = expr
              return { resultContent: `Expression set to ${expr}` }
            }
            if (tc.name === TODO_WRITE_TOOL_NAME) {
              const items = parseTodoList((tc.arguments as any).items)
              activeTodoList.value = items
              return { resultContent: `Todo list updated (${items.filter((i) => i.status === 'done').length}/${items.length} done).` }
            }
            if (tc.name === TODO_READ_TOOL_NAME) {
              return { resultContent: formatTodoList(activeTodoList.value) }
            }
            if (tc.name === RENAME_CHAT_TOOL_NAME) {
              const renameResult = await applyRenameChat((tc.arguments as any).title, conversationId.value)
              return { resultContent: renameResult }
            }
            if (tc.name === RENDER_CARD_TOOL_NAME) {
              const payload = parseRenderCardArgs(tc.arguments)
              if (payload) {
                pendingCards.push(payload)
                return { resultContent: `Rendered ${payload.type} card.` }
              }
              return { resultContent: 'Error: render_card requires a valid { type, data } object. Supported types: weather, table, link_preview, code_comparison.' }
            }
            if (tc.name === DISPATCH_SUBAGENTS_TOOL_NAME) {
              const args = (tc.arguments ?? {}) as { rationale?: string; subagents?: any[] }
              const specs = Array.isArray(args.subagents) ? args.subagents : []
              const dispatchMsgId = `tool-${Date.now()}-${tc.id}`
              processStepIds.push(dispatchMsgId)
              const initialMessage: Message = {
                id: dispatchMsgId,
                role: 'assistant',
                content: `\ud83e\udd16 dispatch_subagents (${specs.length} subagent${specs.length === 1 ? '' : 's'} starting\u2026)`,
                timestamp: now(),
              }
              ;(initialMessage as any).subagents = []
              messages.value.push(initialMessage)
              recentMessageId.value = dispatchMsgId
              const dispatchResult = await dispatchSubagents({
                rationale: typeof args.rationale === 'string' ? args.rationale : '',
                subagents: specs.map((s: any) => ({ name: s?.name, task: String(s?.task ?? '') })),
                parentTools: tools,
                callProvider: (req) => streamProviderChat(provider, req),
                model,
                cwd: activeCodingRepo.value?.path,
                parentMaxIterations: maxIterations,
                subagentMaxIterations: effectiveSubagentMaxIterations.value,
                concurrency: subagentConcurrency.value,
                abortSignal: streamController.value?.signal,
                executeTool: (call) => executeToolCallForAgentMode(provider, model, call, trimmedText),
                onSnapshot: (snaps) => {
                  const msg = messages.value.find((m) => m.id === dispatchMsgId) as (Message & { subagents?: SubagentSnapshot[] }) | undefined
                  if (msg) msg.subagents = snaps as SubagentSnapshot[]
                },
              })
              const completed = dispatchResult.snapshots.filter((s) => s.status === 'completed').length
              const failed = dispatchResult.snapshots.length - completed
              const dispatchMsg = messages.value.find((m) => m.id === dispatchMsgId)
              if (dispatchMsg) {
                dispatchMsg.content = `\ud83e\udd16 dispatch_subagents (${completed} completed, ${failed} failed of ${dispatchResult.snapshots.length})`
              }
              return { resultContent: dispatchResult.aggregateResult }
            }
            return null
          },
          executeTool: (tc) => executeToolCallForAgentMode(provider, model, tc, trimmedText),
          onToolStart: (tc) => {
            const label = describeToolCall(tc)
            const toolMsgId = `tool-${Date.now()}-${tc.id}`
            processStepIds.push(toolMsgId)
            messages.value.push({
              id: toolMsgId,
              role: 'assistant',
              content: `\u{1F4BB} \`${label}\``,
              timestamp: now(),
            })
            recentMessageId.value = toolMsgId
            return toolMsgId
          },
          onToolResult: (tc, result, msgId) => {
            if (!msgId) return
            const label = describeToolCall(tc)
            const preview = result.length > 500 ? result.slice(0, 500) + '\u2026' : result
            const toolMsg = messages.value.find((m) => m.id === msgId)
            if (toolMsg) {
              toolMsg.content = `\u{1F4BB} \`${label}\`\n\`\`\`\n${preview}\n\`\`\``
            }
          },
          onApiRoundTrip: (dur, response) => {
            apiRoundTrips.push(dur)
            recordUsage(model, response?.usage)
          },
        })

        liveStreamSettled = true

        let finalContent = turnResult.finalContent

        if (pendingCards.length > 0) {
          finalContent = prependCardMarkers(pendingCards, finalContent)
        }

        // Show the AI's final response — reuse the live streaming bubble.
        // The final live bubble (`liveAssistantId`) is the canonical reply;
        // every other bubble produced during this turn (tool calls + earlier
        // iteration text/reasoning) gets folded into the collapsible "process"
        // panel rendered above the reply.
        if (finalContent) {
          recordApiTelemetry(
            apiRoundTrips.reduce((sum, value) => sum + value, 0),
            apiRoundTrips,
            selectedProvider.value,
            model,
          )

          // Extract memories from AI response and strip tags
          const cleanContent = extractMemoryFromAIResponse(finalContent)
          const liveMsg = messages.value.find((m) => m.id === liveAssistantId)
          if (liveMsg) {
            liveMsg.content = cleanContent
            recentMessageId.value = liveAssistantId
            queueLiveBubbleSave(liveMsg)
          } else {
            const finalMessage: Message = {
              id: liveAssistantId,
              role: 'assistant',
              content: cleanContent,
              timestamp: now(),
              waifuId: waifu?.id,
              waifuDisplayName: waifu?.displayName,
            }
            messages.value.push(finalMessage)
            recentMessageId.value = liveAssistantId
            queueLiveBubbleSave(finalMessage)
          }

          // Mark every bubble produced earlier in this turn as a process step
          // so the UI folds them behind the collapsible panel. Skip the final
          // reply itself (which has the just-written `cleanContent`).
          if (processStepIds.length > 0) {
            const stepIds = new Set(processStepIds.filter((id) => id !== liveAssistantId))
            if (stepIds.size > 0) {
              for (const m of messages.value) {
                if (stepIds.has(m.id)) (m as Message).isProcessStep = true
              }
            }
          }

          await Promise.allSettled(liveBubbleSaveTasks)
          // Auto-name after first exchange (runs in background, doesn't block UI)
          if (isNewConversation && convId) autoNameConversation(convId, text)
        } else if (liveBubbleAdded) {
          // No final content but the live bubble was created — drop it.
          messages.value = messages.value.filter((m) => m.id !== liveAssistantId)
        }
      } else {
        // ── No tools: streaming mode ──
        // 无工具模式只负责流式输出文本并在结束后落库，逻辑更简单，但仍复用相同的会话状态。
        const aiMessages = messages.value.map((m) => ({ id: m.id, role: m.role, content: m.content }))
        let assistantContent = ''
        let assistantReasoning = ''
        const assistantId = `assistant-${Date.now()}`
        let added = false
        const streamStartedAt = performance.now()

        const ensureBubble = () => {
          if (added) return
          messages.value.push({
            id: assistantId,
            role: 'assistant',
            content: '',
            timestamp: now(),
          })
          added = true
          recentMessageId.value = assistantId
        }
        const updateBubble = () => {
          const last = messages.value.find((m) => m.id === assistantId)
          if (!last) return
          last.content = assistantContent
        }

        const streamIter = runtime.streamMessage({ text, history: aiMessages, cacheBreakpointIndex: aiMessages.findIndex((m: any) => m.role === 'user'), signal: streamController.value?.signal })
        for await (const chunk of streamIter) {
          if (streamController.value?.signal.aborted) break
          if (chunk.type === 'text_delta' && chunk.delta) {
            assistantContent += chunk.delta
            ensureBubble()
            updateBubble()
          } else if (chunk.type === 'reasoning_delta' && chunk.delta) {
            assistantReasoning += chunk.delta
          } else if (chunk.type === 'done' && chunk.usage) {
            recordUsage(model, chunk.usage)
          }
        }

        if (assistantContent) {
          const streamDurationMs = performance.now() - streamStartedAt
          recordApiTelemetry(streamDurationMs, [streamDurationMs], selectedProvider.value, model)

          // Extract memories from AI response and strip tags from displayed + stored content
          const cleanContent = extractMemoryFromAIResponse(assistantContent)
          const last = messages.value[messages.value.length - 1]
          if (last?.id === assistantId) last.content = cleanContent

          if (convId) {
            try {
              await invoke('store:addMessage', convId, {
                id: assistantId,
                role: 'assistant',
                content: cleanContent,
                timestamp: now(),
              })
            } catch (e) { console.warn('Failed to save assistant message:', e) }
            if (isNewConversation) autoNameConversation(convId, text)
          }
        }
      }
      // Auto-extract memory from user messages (name, preferences, etc.)
      extractAndSaveMemory(trimmedText)

    } catch (err: any) {
      const classified = classifyError(err, { provider: selectedProvider.value })
      chatLog.error('sendMessage failed', {
        kind: classified.kind,
        status: classified.status,
        provider: selectedProvider.value,
        model: selectedModel.value,
        hint: classified.hint,
        message: classified.message,
        stack: err instanceof Error ? err.stack : undefined,
      })
      messages.value.push({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${describeError(err)}`,
        timestamp: now(),
      })
    } finally {
      isLoading.value = false
      streamController.value = null
      setTimeout(() => { recentMessageId.value = null }, 1100)
    }
  }

  function handleExternalConversationEvent(event: any) {
    if (!event?.conversationId || conversationId.value !== event.conversationId) return

    if (event.type === 'user_message' && event.message) {
      const exists = messages.value.some((message) => message.id === event.message.id)
      if (!exists) {
        messages.value.push({
          id: event.message.id,
          role: event.message.role || 'user',
          content: event.message.content || '',
          timestamp: event.message.timestamp || '',
        })
      }
      recentMessageId.value = event.message.id
      return
    }

    if (event.type === 'assistant_start' && event.messageId) {
      const exists = messages.value.some((message) => message.id === event.messageId)
      if (!exists) {
        messages.value.push({
          id: event.messageId,
          role: 'assistant',
          content: '',
          timestamp: event.timestamp || '',
        })
      }
      recentMessageId.value = event.messageId
      return
    }

    if (event.type === 'assistant_chunk' && event.messageId) {
      const existing = messages.value.find((message) => message.id === event.messageId)
      if (existing) {
        existing.content = `${existing.content || ''}${event.chunk || ''}`
      } else {
        messages.value.push({
          id: event.messageId,
          role: 'assistant',
          content: event.chunk || '',
          timestamp: event.timestamp || '',
        })
      }
      recentMessageId.value = event.messageId
      return
    }

    if (event.type === 'assistant_end' && event.messageId) {
      const existing = messages.value.find((message) => message.id === event.messageId)
      if (existing) {
        existing.content = event.finalMessage || existing.content
        existing.timestamp = event.timestamp || existing.timestamp
      } else {
        messages.value.push({
          id: event.messageId,
          role: 'assistant',
          content: event.finalMessage || '',
          timestamp: event.timestamp || '',
        })
      }
      recentMessageId.value = event.messageId
      return
    }

    if (event.type === 'assistant_error' && event.messageId) {
      const errorContent = `Error: ${event.error || 'Unknown mobile chat error'}`
      const existing = messages.value.find((message) => message.id === event.messageId)
      if (existing) {
        existing.content = errorContent
        existing.timestamp = event.timestamp || existing.timestamp
      } else {
        messages.value.push({
          id: event.messageId,
          role: 'assistant',
          content: errorContent,
          timestamp: event.timestamp || '',
        })
      }
      recentMessageId.value = event.messageId
    }
  }

  function extractMemoryFromAIResponse(responseText: string): string {
    // 模型可通过隐藏 memory tag 写长期记忆；这里负责解析标签并把它们从最终展示文本里剥掉。
    const addedMemories: Array<{ key: string; value: string; category: string }> = []
    const deletedMemoryKeys: string[] = []

    // Parse <memory category="..." key="...">value</memory> tags
    const memoryTagRegex = /<memory\s+category="([^"]+)"\s+key="([^"]+)">([^<]+)<\/memory>/gi
    let match: RegExpExecArray | null
    while ((match = memoryTagRegex.exec(responseText)) !== null) {
      const category = match[1].trim()
      const key = match[2].trim()
      const value = match[3].trim()
      if (key && value) {
        setMemory(key, value, category)
        addedMemories.push({ key, value, category })
      }
    }

    // Parse <memory-delete key="..."/> tags
    const deleteTagRegex = /<memory-delete\s+key="([^"]+)"\s*\/>/gi
    let delMatch: RegExpExecArray | null
    while ((delMatch = deleteTagRegex.exec(responseText)) !== null) {
      const key = delMatch[1].trim()
      if (key) {
        const existing = userMemories.value.find((m) =>
          m.key.toLowerCase() === key.toLowerCase() || m.key.toLowerCase().includes(key.toLowerCase()),
        )
        if (existing) {
          deleteMemory(existing.key)
          deletedMemoryKeys.push(existing.key)
        }
      }
    }

    if (addedMemories.length || deletedMemoryKeys.length) {
      window.dispatchEvent(new CustomEvent('app:memory-updated', {
        detail: {
          added: addedMemories,
          deleted: deletedMemoryKeys,
        },
      }))
    }

    // Strip all memory tags from the displayed content
    return responseText
      .replace(/<memory\s+category="[^"]*"\s+key="[^"]*">[^<]*<\/memory>/gi, '')
      .replace(/<memory-delete\s+key="[^"]*"\s*\/?>/gi, '')
      .replace(/<set_?affection\b[^>]*>([\s\S]*?)<\/set_?affection>/gi, '')
      .replace(/<set_?affection\b[^>]*\/?>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()
  }

  function extractAndSaveMemory(userText: string) {
    // 这是本地启发式记忆提取：即使模型没写 memory tag，也尽量从用户原话里抓常见身份和偏好信息。
    const lower = userText.toLowerCase()

    // "remember that..." or "remember my..." patterns
    const rememberMatch = userText.match(/remember\s+(?:that\s+)?(?:my\s+)?(.+)/i)
    if (rememberMatch) {
      const memoryContent = rememberMatch[1].replace(/[.!?]+$/, '').trim()
      if (memoryContent.length > 2) {
        const key = `user_note_${Date.now()}`
        setMemory(key, memoryContent, 'user_notes')
      }
    }

    // "my name is ..."
    const nameMatch = userText.match(/(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
    if (nameMatch) {
      setMemory('user_name', nameMatch[1].trim(), 'identity')
    }

    // "i like / i love / my favorite..."
    const prefMatch = userText.match(/(?:i (?:like|love|prefer|enjoy))\s+(.{3,50}?)(?:\.|!|,|$)/i)
    if (prefMatch) {
      const key = `preference_${Date.now()}`
      setMemory(key, prefMatch[1].trim(), 'preferences')
    }

    // "i work with / i use / i'm using..."
    const toolMatch = userText.match(/(?:i (?:work with|use|am using|'m using))\s+(.{2,40}?)(?:\.|!|,|$)/i)
    if (toolMatch) {
      const tool = toolMatch[1].trim()
      setMemory(`tool_${tool.toLowerCase().replace(/\s+/g, '_')}`, tool, 'skills')
    }

    // "i'm a / i am a / i work as..."
    const roleMatch = userText.match(/(?:i(?:'m| am) (?:a |an )?|i work as (?:a |an )?)([a-z][\w\s]{2,30}?)(?:\.|!|,|$)/i)
    if (roleMatch && !nameMatch) {
      const role = roleMatch[1].trim()
      if (role.length > 2 && !/^(?:just|really|very|so|not|also)/.test(role.toLowerCase())) {
        setMemory('role', role, 'identity')
      }
    }

    // "i'm working on / i'm building / my project..."
    const projectMatch = userText.match(/(?:i(?:'m| am) (?:working on|building|making|developing)|my project(?:.*?)is)\s+(.{3,60}?)(?:\.|!|,|$)/i)
    if (projectMatch) {
      setMemory('current_project', projectMatch[1].trim(), 'projects')
    }

    // "my favorite ... is ..."
    const favMatch = userText.match(/my (?:fav(?:orite)?|preferred)\s+(\w+)\s+is\s+(.{2,40}?)(?:\.|!|,|$)/i)
    if (favMatch) {
      setMemory(`favorite_${favMatch[1].toLowerCase()}`, favMatch[2].trim(), 'preferences')
    }

    // "forget ..." - delete a memory
    const forgetMatch = lower.match(/forget\s+(?:about\s+)?(?:my\s+)?(.+)/i)
    if (forgetMatch) {
      const target = forgetMatch[1].replace(/[.!?]+$/, '').trim().toLowerCase()
      const match = userMemories.value.find((m) =>
        m.value.toLowerCase().includes(target) || m.key.toLowerCase().includes(target),
      )
      if (match) deleteMemory(match.key)
    }
  }

  function stopStream() {
    const ctrl = streamController.value
    if (!ctrl || ctrl.signal.aborted) return
    ctrl.abort()
    chatLog.info('stream aborted by user')
  }

  return {
    // 这里导出的就是给 UI 和其他集成层使用的 store 公共 API。
    isSetup,
    selectedWaifuId,
    customWaifus,
    allWaifus,
    refreshCustomWaifus,
    availableSkills,
    refreshAvailableSkills,
    selectedProvider,
    selectedModel,
    apiKey,
    messages,
    inputValue,
    isLoading,
    stopStream,
    conversationId,
    conversations,
    recentMessageId,
    activeCodingRepo,
    showCodeModal,
    codeModalMode,
    agentMode,
    selectedWaifu,
    affection,
    live2dExpression,
    apiTelemetry,
    apiTelemetryHistory,
    apiTelemetryAlert,
    enableTimeoutsAndIterationCaps,
    maxToolIterations,
    apiSpikeThresholdMs,
    webSearchEnabled,
    proactiveChatEnabled,
    proactiveChatIdleFollowUpEnabled,
    proactiveChatOnlineGreetingEnabled,
    proactiveChatWorkHoursEnabled,
    proactiveChatWorkHoursStart,
    proactiveChatWorkHoursEnd,
    proactiveChatDoNotDisturbEnabled,
    proactiveChatDoNotDisturbStart,
    proactiveChatDoNotDisturbEnd,
    proactiveChatIntervalMinutes,
    proactiveChatTemperature,
    proactiveChatLongGapHours,
    subagentMaxIterations,
    subagentConcurrency,
    usageTotals,
    activeTodoList,
    approveToolApproval,
    denyToolApproval,
    pendingAttachments,
    userMemories,
    sidebarFilter,
    isGroupChat,
    groupWaifuIds,
    activeWaifus,
    loadSetup,
    hydrateProviderConfig,
    saveApiKey,
    setup,
    setAgentMode,
    setEnableTimeoutsAndIterationCaps,
    setMaxToolIterations,
    setApiSpikeThresholdMs,
    setSubagentMaxIterations,
    setSubagentConcurrency,
    setWebSearchEnabled,
    setProactiveChatEnabled,
    setProactiveChatIdleFollowUpEnabled,
    setProactiveChatOnlineGreetingEnabled,
    setProactiveChatWorkHoursEnabled,
    setProactiveChatWorkHoursStart,
    setProactiveChatWorkHoursEnd,
    setProactiveChatDoNotDisturbEnabled,
    setProactiveChatDoNotDisturbStart,
    setProactiveChatDoNotDisturbEnd,
    setProactiveChatIntervalMinutes,
    setProactiveChatTemperature,
    setProactiveChatLongGapHours,
    deleteMessage,
    regenerateFromMessage,
    addAttachment,
    removeAttachment,
    clearPendingAttachments,
    newChat,
    setGroupChat,
    toggleGroupWaifu,
    createConversation,
    loadConversations,
    selectConversation,
    deleteConversation,
    renameConversation,
    toggleFavorite,
    loadMemories,
    setMemory,
    deleteMemory,
    clearMemories,
    sendMessage,
    handleExternalConversationEvent,
    wechatBindings,
    currentWeChatBinding,
    handleWeChatInbound,
    relayAssistantToWeChat,
    setWeChatBinding,
  }
})
