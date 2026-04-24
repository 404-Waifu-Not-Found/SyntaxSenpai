import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { buildSystemPrompt, builtInWaifus, detectMilestone, describeMilestone, formatSkillsForPrompt } from '@syntax-senpai/waifu-core'
import type { SentimentResult, MilestoneEvent, Waifu, Skill } from '@syntax-senpai/waifu-core'
import { AIChatRuntime, withRetry, classifyError, describeError } from '@syntax-senpai/ai-core'
import { useIpc } from '../composables/use-ipc'
import { useKeyManager } from '../composables/use-key-manager'
import { createLogger } from '../composables/logger'
import { getToolsForMode, executeToolCall, describeToolCall, parseTodoList, loadPluginTools, STOP_TOOL_NAME, SET_AFFECTION_TOOL_NAME, TODO_WRITE_TOOL_NAME, RENAME_CHAT_TOOL_NAME, RENDER_CARD_TOOL_NAME, CARD_MARKER_FENCE, type AgentMode, type RenderCardPayload, type RenderCardType, type TodoItem } from '../agent-tools'
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

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const row = MODEL_COST_PER_1K.find((r) => r.match.test(model || ''))
  if (!row) return 0
  return (promptTokens / 1000) * row.input + (completionTokens / 1000) * row.output
}

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

function annotateToolResult(result: string, iteration: number, maxIterations: number): string {
  const remaining = Math.max(0, maxIterations - iteration)
  if (remaining <= 0) {
    return `${result}\n\n[runtime] This was your LAST tool iteration. You MUST call stop_response in your next reply.`
  }
  if (remaining <= 2) {
    return `${result}\n\n[runtime] ${remaining} tool iteration${remaining === 1 ? '' : 's'} left — wrap up and call stop_response soon.`
  }
  return result
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
const MAX_TOOL_ITERATIONS_STORAGE_KEY = 'syntax-senpai-max-tool-iterations'
const WEB_SEARCH_ENABLED_STORAGE_KEY = 'syntax-senpai-web-search-enabled'
const DEFAULT_API_SPIKE_THRESHOLD_MS = 5000
const DEFAULT_MAX_TOOL_ITERATIONS = 12
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

/**
 * Milestone queue keyed by waifuId. When the AI adjusts affection and
 * crosses a tier boundary, the event sits here until the next turn's
 * system prompt picks it up and injects a one-shot sidecar.
 */
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

function buildAgentBehaviorPrompt(shell: string | null | undefined, waifuName: string, isWebSearchEnabled: boolean): string {
  const shellLine = shell ? `\n- Shell: ${shell}. Each terminal call is a new process — \`cd\` does NOT persist between calls; use absolute paths or chain with \`&&\`.` : ''
  const webSearchLine = isWebSearchEnabled
    ? '- web_search → DuckDuckGo result links/snippets only. NOT a realtime data source. Never use it for weather, stocks, scores, prices, time, or any live facts. Use only to find URLs the user can open.'
    : '- web_search is disabled by the user. Do not call it. If links would help, say web search must be enabled in Settings.'
  return `\n\n[Agent Behavior]
You can act on the user's machine through tools. Your goal is to actually finish the task, verified, not to sound like you finished it.

Tool selection — prioritize terminal commands for solving problems:
- terminal → default first choice: running programs, git, installs, diagnostics, network checks, realtime data via public APIs, command-line verification. NOT for editing text files.
- read_file → look at source/config/logs. Always use this before edit_file so you know the exact whitespace.
- write_file → create a new file, or deliberately replace a whole file.
- edit_file → change one specific block of an existing file. Exact-string match, must be unique.
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
- Before edits: read_file the target first. Follow the repo's existing patterns (indentation, quoting, import order) — do not reformat untouched lines.
- Prefer edit_file over write_file for partial changes. Use write_file only for new files or intentional full rewrites.
- Verify before stop_response: if the repo has a typecheck/lint/test relevant to your change, run it. Fix failures; do not report success over a broken build.

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

Read before you write:
- Before any edit_file or write_file, read the target file with read_file so you know its exact contents, indentation style, and surrounding context.
- For anything non-trivial (new feature, bug that crosses files, refactor), first skim siblings or related files to understand existing patterns. Don't invent a new pattern if the repo already has one.

Prefer surgical edits:
- edit_file > write_file whenever part of the file should survive. Only use write_file for new files or full rewrites you have explicit reason to do.
- If edit_file fails because old_text isn't unique, expand the snippet with a few more lines of context — don't guess.

Match the codebase:
- Match the file's indentation (tabs vs spaces, 2 vs 4), quoting style, semicolon convention, trailing-comma convention, and import order. Do NOT reformat lines you weren't asked to touch.
- Use existing utilities/helpers before creating new ones. Grep the repo if unsure.

Finish the job:
- No TODO placeholders, no \`throw new Error('not implemented')\`, no commented-out code unless the user asked for a stub.
- Handle the obvious edge cases (empty inputs, missing files, null/undefined) but don't invent defensive code for scenarios that can't happen.
- When you reference a location in your reply, use \`file.ext:line\` format so the user can jump to it.

Verify before stop_response:
- If the project has a typecheck, lint, or test command that's relevant to your change and it's reasonable to run, run it. If something fails, fix it — don't report success.
- Read back the file you edited with read_file to confirm the change landed as intended, unless you just wrote it fresh.
- stop_response.final_message should state what actually changed and any follow-ups the user still needs to do (e.g. install a new dep, restart the dev server).`
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

export const useChatStore = defineStore('chat', () => {
  const { invoke } = useIpc()
  const keyManager = useKeyManager()

  const isSetup = ref(false)
  const selectedWaifuId = ref(builtInWaifus[0]?.id || 'aria')
  // User-authored waifus loaded from <userData>/waifus/*.json via the
  // waifus:list IPC. Refreshed at store init and after import/delete
  // so picker + active-waifu resolution see them without restart.
  const customWaifus = ref<Waifu[]>([])
  const allWaifus = computed<Waifu[]>(() => [...builtInWaifus, ...customWaifus.value])
  const selectedProvider = ref('anthropic')
  const selectedModel = ref(DEFAULT_MODEL_BY_PROVIDER.anthropic)
  const apiKey = ref('')
  const messages = ref<Message[]>([])
  const inputValue = ref('')
  const isLoading = ref(false)
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
  const apiTelemetry = ref<ApiTelemetry>(createEmptyApiTelemetry())
  const apiTelemetryHistory = ref<ApiTelemetrySample[]>(loadApiTelemetryHistory())
  const apiTelemetryAlert = ref<ApiTelemetryAlert>(createEmptyApiAlert())
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

  // Cumulative token + cost counters for the current conversation. Reset on
  // conversation switch. Stored on the store so App.vue can render them.
  const usageTotals = ref({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    turns: 0,
  })

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
  async function callProviderChat(provider: any, req: any): Promise<any> {
    return await withRetry(() => provider.chat(req), {
      maxAttempts: 4,
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

  function setAgentMode(mode: AgentMode) {
    agentMode.value = mode
    localStorage.setItem('syntax-senpai-agent-mode', mode)
  }

  function setMaxToolIterations(value: number) {
    const nextValue = Math.max(1, Math.min(24, Math.round(value)))
    maxToolIterations.value = nextValue
    localStorage.setItem(MAX_TOOL_ITERATIONS_STORAGE_KEY, String(nextValue))
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
  })

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
      const lines = userMemories.value.map((m) => `- [${m.category}] ${m.key}: ${m.value}`)
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
- Maximum tool iterations allowed for a reply: ${maxToolIterations.value}
- Response-time spike threshold: ${apiSpikeThresholdMs.value} ms
- ${latestAlert}

Do not mention these timings unless the user asks about speed, latency, slowness, or performance. If they do ask, use these numbers accurately and stay in character.`
  }

  function recordApiTelemetry(totalMs: number, roundTripMs: number[], provider: string, model: string) {
    const lastRoundTripMs = roundTripMs.length > 0 ? roundTripMs[roundTripMs.length - 1] : totalMs
    const alert = totalMs >= apiSpikeThresholdMs.value || lastRoundTripMs >= apiSpikeThresholdMs.value

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
          let systemPrompt = createWaifuSystemPrompt(waifu, selectedProvider.value, model, affectionValue)
          systemPrompt += buildMasterContextBlock()
          systemPrompt += buildLanguagePromptBlock()
          systemPrompt += buildConversationLanguageRuleBlock(messages.value.find((m) => m.role === 'user')?.content || trimmedText)
          systemPrompt += buildMemoryContext()
          systemPrompt += buildAffectionPrompt(affectionValue, waifu.displayName || 'Waifu')
          systemPrompt += buildMilestoneSidecarBlock(waifu.id)
          systemPrompt += buildSkillsAuthoringPromptBlock()
          systemPrompt += formatSkillsForPrompt(availableSkills.value)
          systemPrompt += buildApiTelemetryPrompt()
          systemPrompt += buildGroupChatPromptBlock(waifu, waifus, pendingTasks.get(waifu.id) || [], round)
          systemPrompt += activeCodingRepo.value
            ? buildActiveCodingRepoPromptBlock(activeCodingRepo.value)
            : buildCodingSessionPromptBlock(trimmedText)

          if (hasTools) {
            if (systemInfo && systemInfo.homedir) {
              systemPrompt += `\n\n[System Environment]\nOS: ${systemInfo.platform}\nUsername: ${systemInfo.username}\nHome directory: ${systemInfo.homedir}\nShell: ${systemInfo.shell ?? 'unknown'}`
            }
            systemPrompt += buildAgentBehaviorPrompt(systemInfo?.shell, waifu.displayName || 'your waifu persona', webSearchEnabled.value)
          }

          const runtime = new AIChatRuntime({
            provider: providerRequiresApiKey(selectedProvider.value)
              ? ({ type: selectedProvider.value as any, apiKey: key } as any)
              : ({ type: selectedProvider.value as any } as any),
            model,
            systemPrompt,
          })

          let finalContent = ''

          if (hasTools) {
            const provider = runtime.getProvider()
            const aiHistory = [...sharedHistory]
            const maxIterations = maxToolIterations.value
            let stopped = false
            const toolMsgIds: string[] = []
            const pendingCards: RenderCardPayload[] = []

            for (let iteration = 0; iteration <= maxIterations; iteration++) {
              const requestStartedAt = performance.now()
              const response = await callProviderChat(provider, {
                model,
                messages: aiHistory,
                tools,
                systemPrompt,
              })
              apiRoundTrips.push(performance.now() - requestStartedAt)
              recordUsage(model, response?.usage)

              if (!response.toolCalls || response.toolCalls.length === 0) {
                finalContent = response.content || ''
                break
              }

              aiHistory.push({
                id: response.id || `assistant-tc-${waifu.id}-${Date.now()}`,
                role: 'assistant',
                content: response.content || '',
                toolCalls: response.toolCalls,
                reasoningContent: (response as any).reasoningContent,
              })

              for (const toolCall of response.toolCalls) {
                if (toolCall.name === STOP_TOOL_NAME) {
                  finalContent = (toolCall.arguments as any).final_message || response.content || ''
                  aiHistory.push({
                    id: `tool-result-${Date.now()}-${toolCall.id}`,
                    role: 'tool',
                    content: 'ok',
                    toolCallId: toolCall.id,
                  })
                  stopped = true
                  break
                }

                if (toolCall.name === SET_AFFECTION_TOOL_NAME) {
                  const newVal = clampAffection(Number((toolCall.arguments as any).value ?? affectionValue))
                  const milestone = updateAffectionWithMilestone(waifu.id, newVal)
                  if (selectedWaifuId.value === waifu.id) {
                    affection.value = newVal
                  }
                  if (milestone) emitMilestoneToast(waifu, milestone)

                  aiHistory.push({
                    id: `tool-result-${Date.now()}-${toolCall.id}`,
                    role: 'tool',
                    content: `好感度 updated to ${newVal}`,
                    toolCallId: toolCall.id,
                  })
                  continue
                }

                if (toolCall.name === TODO_WRITE_TOOL_NAME) {
                  const items = parseTodoList((toolCall.arguments as any).items)
                  activeTodoList.value = items
                  aiHistory.push({
                    id: `tool-result-${Date.now()}-${toolCall.id}`,
                    role: 'tool',
                    content: `Todo list updated (${items.filter((i) => i.status === 'done').length}/${items.length} done).`,
                    toolCallId: toolCall.id,
                  })
                  continue
                }

                if (toolCall.name === RENAME_CHAT_TOOL_NAME) {
                  const result = await applyRenameChat((toolCall.arguments as any).title, conversationId.value)
                  aiHistory.push({
                    id: `tool-result-${Date.now()}-${toolCall.id}`,
                    role: 'tool',
                    content: result,
                    toolCallId: toolCall.id,
                  })
                  continue
                }

                if (toolCall.name === RENDER_CARD_TOOL_NAME) {
                  const payload = parseRenderCardArgs(toolCall.arguments)
                  if (payload) {
                    pendingCards.push(payload)
                    aiHistory.push({
                      id: `tool-result-${Date.now()}-${toolCall.id}`,
                      role: 'tool',
                      content: `Rendered ${payload.type} card.`,
                      toolCallId: toolCall.id,
                    })
                  } else {
                    aiHistory.push({
                      id: `tool-result-${Date.now()}-${toolCall.id}`,
                      role: 'tool',
                      content: 'Error: render_card requires a valid { type, data } object. Supported types: weather, table, link_preview, code_comparison.',
                      toolCallId: toolCall.id,
                    })
                  }
                  continue
                }

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

                const result = await executeToolCall(toolCall)
                const preview = result.length > 500 ? result.slice(0, 500) + '\u2026' : result
                const toolMsg = messages.value.find((message) => message.id === toolMsgId)
                if (toolMsg) {
                  toolMsg.content = `${waifu.displayName} ran \`${label}\`\n\`\`\`\n${preview}\n\`\`\``
                }

                aiHistory.push({
                  id: `tool-result-${Date.now()}-${toolCall.id}`,
                  role: 'tool',
                  content: annotateToolResult(result, iteration, maxIterations),
                  toolCallId: toolCall.id,
                })
              }

              if (stopped) break

              if (iteration === maxIterations) {
                finalContent = '(Reached maximum iterations — stopping.)'
              }
            }

            if (pendingCards.length > 0) {
              finalContent = prependCardMarkers(pendingCards, finalContent)
            }

            if (finalContent && toolMsgIds.length > 0) {
              const idsToRemove = new Set(toolMsgIds)
              messages.value = messages.value.filter((message) => !idsToRemove.has(message.id))
            }
          } else {
            const streamStartedAt = performance.now()
            for await (const chunk of runtime.streamMessage({ text: trimmedText, history: sharedHistory })) {
              if (chunk.type === 'text_delta' && chunk.delta) {
                finalContent += chunk.delta
              }
            }
            apiRoundTrips.push(performance.now() - streamStartedAt)
          }

          const { cleanedText, tasks } = extractDelegatedTasks(finalContent || 'Done.')
          const cleanContent = extractMemoryFromAIResponse(cleanedText || 'Done.')
          assistantTurns.push({ waifu, content: cleanContent })
          sharedHistory.push({
            id: `assistant-${waifu.id}-${round}-${assistantTurns.length}`,
            role: 'assistant',
            content: `${waifu.displayName}: ${cleanContent}`,
          })

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

      for (const turn of assistantTurns) {
        const assistantId = `assistant-${turn.waifu.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const assistantMsg: Message = {
          id: assistantId,
          role: 'assistant',
          content: turn.content,
          timestamp: now(),
          waifuId: turn.waifu.id,
          waifuDisplayName: turn.waifu.displayName,
        }

        messages.value.push(assistantMsg)
        recentMessageId.value = assistantId

        if (convId) {
          try { await invoke('store:addMessage', convId, assistantMsg) } catch (e) { console.warn('Failed to save assistant message:', e) }
        }
      }

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
      setTimeout(() => { recentMessageId.value = null }, 1100)
    }
  }

  async function sendMessage(text: string) {
    if (isGroupChat.value && groupWaifuIds.value.length > 0) {
      return sendGroupMessage(text)
    }

    if (!text.trim() || isLoading.value) return

    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const trimmedText = text.trim()
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
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmedText,
        timestamp: now(),
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
      // Refresh sidebar immediately so the new conversation is visible
      if (isNewConversation) await loadConversations()

      const key = await keyManager.getKey(selectedProvider.value)
      const waifu = selectedWaifu.value

      if (providerRequiresApiKey(selectedProvider.value) && (!key || key === '')) {
        throw new Error(`No API key configured for ${selectedProvider.value}. Open Settings and add one to chat with ${waifu?.displayName || 'your assistant'}.`)
      }

      const model = selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'
      let systemPrompt = createWaifuSystemPrompt(waifu, selectedProvider.value, model, affection.value)

      // The user is your Master — applies to every conversation, not just group.
      systemPrompt += buildMasterContextBlock()
      systemPrompt += buildLanguagePromptBlock()
      systemPrompt += buildConversationLanguageRuleBlock(messages.value.find((m) => m.role === 'user')?.content || trimmedText)

      // Inject persistent memory context
      systemPrompt += buildMemoryContext()

      // Inject 好感度 system
      systemPrompt += buildAffectionPrompt(affection.value, waifu?.displayName || 'Waifu')

      // One-shot sidecar when the user just crossed an affection tier.
      systemPrompt += buildMilestoneSidecarBlock(waifu.id)

      // Teach the waifu about skills + tools she can author, then list
      // what she already has so she can pull them in with use_skill.
      systemPrompt += buildSkillsAuthoringPromptBlock()
      systemPrompt += formatSkillsForPrompt(availableSkills.value)

      // Let the waifu know how fast the last API reply was.
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
          systemPrompt += `\n\n[System Environment]\nOS: ${sys.platform}\nUsername: ${sys.username}\nHome directory: ${sys.homedir}\nShell: ${sys.shell ?? 'unknown'}`
        }
        systemPrompt += buildAgentBehaviorPrompt(sys?.shell, waifu?.displayName || 'your waifu persona', webSearchEnabled.value)
      }

      const runtime = new AIChatRuntime({
        provider: providerRequiresApiKey(selectedProvider.value)
          ? ({ type: selectedProvider.value as any, apiKey: key } as any)
          : ({ type: selectedProvider.value as any } as any),
        model,
        systemPrompt,
      })

      if (hasTools) {
        // ── Agentic loop: AI calls terminal, repeats until stop_response ──
        const provider = runtime.getProvider()

        // Build AI-compatible message history (skip tool-display messages from UI).
        // When a user message has image attachments, emit ContentPart[] so the
        // provider mapper translates them to the provider's multi-modal shape.
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

        const maxIterations = maxToolIterations.value
        let finalContent = ''
        let stopped = false
        const toolMsgIds: string[] = [] // track tool bubbles so we can remove them later
        const apiRoundTrips: number[] = []
        const pendingCards: RenderCardPayload[] = []

        for (let i = 0; i <= maxIterations; i++) {
          const requestStartedAt = performance.now()
          const response = await callProviderChat(provider, {
            model,
            messages: aiHistory,
            tools,
            systemPrompt,
          })
          apiRoundTrips.push(performance.now() - requestStartedAt)
          recordUsage(model, response?.usage)

          // No tool calls → natural stop, use the text response
          if (!response.toolCalls || response.toolCalls.length === 0) {
            finalContent = response.content
            break
          }

          // Add assistant's tool-call message to AI history.
          // `reasoningContent` must be echoed back on DeepSeek reasoner models —
          // they 400 with "reasoning_content in the thinking mode must be passed
          // back to the API" otherwise.
          aiHistory.push({
            id: response.id || `assistant-tc-${Date.now()}`,
            role: 'assistant',
            content: response.content || '',
            toolCalls: response.toolCalls,
            reasoningContent: (response as any).reasoningContent,
          })

          // Process each tool call
          for (const tc of response.toolCalls) {
            // ── stop_response: AI is done ──
            if (tc.name === STOP_TOOL_NAME) {
              finalContent = (tc.arguments as any).final_message || response.content || ''
              stopped = true

              aiHistory.push({
                id: `tool-result-${Date.now()}-${tc.id}`,
                role: 'tool',
                content: 'ok',
                toolCallId: tc.id,
              })
              break
            }

            // ── set_affection: AI adjusts 好感度 ──
            if (tc.name === SET_AFFECTION_TOOL_NAME) {
              const newVal = Math.max(0, Math.min(100, Math.round(+(tc.arguments as any).value || affection.value)))
              affection.value = newVal
              const milestone = updateAffectionWithMilestone(selectedWaifuId.value, newVal)
              if (milestone) {
                const waifu = allWaifus.value.find((w) => w.id === selectedWaifuId.value)
                if (waifu) emitMilestoneToast(waifu, milestone)
              }

              aiHistory.push({
                id: `tool-result-${Date.now()}-${tc.id}`,
                role: 'tool',
                content: `好感度 updated to ${newVal}`,
                toolCallId: tc.id,
              })
              continue
            }

            // ── todo_write: AI posts a visible checklist ──
            if (tc.name === TODO_WRITE_TOOL_NAME) {
              const items = parseTodoList((tc.arguments as any).items)
              activeTodoList.value = items
              aiHistory.push({
                id: `tool-result-${Date.now()}-${tc.id}`,
                role: 'tool',
                content: `Todo list updated (${items.filter((i) => i.status === 'done').length}/${items.length} done).`,
                toolCallId: tc.id,
              })
              continue
            }

            // ── rename_chat: AI renames the current conversation ──
            if (tc.name === RENAME_CHAT_TOOL_NAME) {
              const result = await applyRenameChat((tc.arguments as any).title, conversationId.value)
              aiHistory.push({
                id: `tool-result-${Date.now()}-${tc.id}`,
                role: 'tool',
                content: result,
                toolCallId: tc.id,
              })
              continue
            }

            // ── render_card: AI emits a rich inline card (weather/table/etc.) ──
            if (tc.name === RENDER_CARD_TOOL_NAME) {
              const payload = parseRenderCardArgs(tc.arguments)
              if (payload) {
                pendingCards.push(payload)
                aiHistory.push({
                  id: `tool-result-${Date.now()}-${tc.id}`,
                  role: 'tool',
                  content: `Rendered ${payload.type} card.`,
                  toolCallId: tc.id,
                })
              } else {
                aiHistory.push({
                  id: `tool-result-${Date.now()}-${tc.id}`,
                  role: 'tool',
                  content: 'Error: render_card requires a valid { type, data } object. Supported types: weather, table, link_preview, code_comparison.',
                  toolCallId: tc.id,
                })
              }
              continue
            }

            // ── tool call: run it ──
            const label = describeToolCall(tc)
            const toolMsgId = `tool-${Date.now()}-${tc.id}`
            toolMsgIds.push(toolMsgId)

            // Show "running" indicator in chat
            messages.value.push({
              id: toolMsgId,
              role: 'assistant',
              content: `\u{1F4BB} \`${label}\``,
              timestamp: now(),
            })
            recentMessageId.value = toolMsgId

            const result = await executeToolCall(tc)
            const preview = result.length > 500 ? result.slice(0, 500) + '\u2026' : result

            // Update chat bubble with output
            const toolMsg = messages.value.find((m) => m.id === toolMsgId)
            if (toolMsg) {
              toolMsg.content = `\u{1F4BB} \`${label}\`\n\`\`\`\n${preview}\n\`\`\``
            }

            aiHistory.push({
              id: `tool-result-${Date.now()}-${tc.id}`,
              role: 'tool',
              content: annotateToolResult(result, i, maxIterations),
              toolCallId: tc.id,
            })
          }

          if (stopped) break

          if (i === maxIterations) {
            finalContent = '(Reached maximum iterations \u2014 stopping.)'
          }
        }

        if (pendingCards.length > 0) {
          finalContent = prependCardMarkers(pendingCards, finalContent)
        }

        // Remove tool execution messages now that we have the final response
        if (finalContent && toolMsgIds.length > 0) {
          const idsToRemove = new Set(toolMsgIds)
          messages.value = messages.value.filter((m) => !idsToRemove.has(m.id))
        }

        // Show the AI's final response
        if (finalContent) {
          recordApiTelemetry(
            apiRoundTrips.reduce((sum, value) => sum + value, 0),
            apiRoundTrips,
            selectedProvider.value,
            model,
          )

          // Extract memories from AI response and strip tags
          const cleanContent = extractMemoryFromAIResponse(finalContent)
          const assistantId = `assistant-${Date.now()}`
          messages.value.push({
            id: assistantId,
            role: 'assistant',
            content: cleanContent,
            timestamp: now(),
          })
          recentMessageId.value = assistantId

          if (convId) {
            try {
              await invoke('store:addMessage', convId, {
                id: assistantId,
                role: 'assistant',
                content: cleanContent,
                timestamp: now(),
              })
            } catch (e) { console.warn('Failed to save assistant message:', e) }
          }
          // Auto-name after first exchange (runs in background, doesn't block UI)
          if (isNewConversation && convId) autoNameConversation(convId, text)
        }
      } else {
        // ── No tools: streaming mode ──
        const aiMessages = messages.value.map((m) => ({ id: m.id, role: m.role, content: m.content }))
        let assistantContent = ''
        const assistantId = `assistant-${Date.now()}`
        let added = false
        const streamStartedAt = performance.now()

        for await (const chunk of runtime.streamMessage({ text, history: aiMessages })) {
          if (chunk.type === 'text_delta' && chunk.delta) {
            assistantContent += chunk.delta
            if (!added) {
              messages.value.push({
                id: assistantId,
                role: 'assistant',
                content: assistantContent,
                timestamp: now(),
              })
              added = true
              recentMessageId.value = assistantId
            } else {
              const last = messages.value[messages.value.length - 1]
              if (last?.id === assistantId) last.content = assistantContent
            }
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
    // Parse <memory category="..." key="...">value</memory> tags
    const memoryTagRegex = /<memory\s+category="([^"]+)"\s+key="([^"]+)">([^<]+)<\/memory>/gi
    let match: RegExpExecArray | null
    while ((match = memoryTagRegex.exec(responseText)) !== null) {
      const category = match[1].trim()
      const key = match[2].trim()
      const value = match[3].trim()
      if (key && value) {
        setMemory(key, value, category)
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
        if (existing) deleteMemory(existing.key)
      }
    }

    // Strip all memory tags from the displayed content
    return responseText
      .replace(/<memory\s+category="[^"]*"\s+key="[^"]*">[^<]*<\/memory>/gi, '')
      .replace(/<memory-delete\s+key="[^"]*"\s*\/>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()
  }

  function extractAndSaveMemory(userText: string) {
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

  return {
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
    conversationId,
    conversations,
    recentMessageId,
    activeCodingRepo,
    showCodeModal,
    codeModalMode,
    agentMode,
    selectedWaifu,
    affection,
    apiTelemetry,
    apiTelemetryHistory,
    apiTelemetryAlert,
    maxToolIterations,
    apiSpikeThresholdMs,
    webSearchEnabled,
    usageTotals,
    activeTodoList,
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
    setMaxToolIterations,
    setApiSpikeThresholdMs,
    setWebSearchEnabled,
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
  }
})
