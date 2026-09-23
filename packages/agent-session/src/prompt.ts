import { buildSystemPrompt, type Waifu } from '@syntax-senpai/waifu-core'

export interface AgentPromptInput {
  waifu: Waifu
  provider: string
  model: string
  affection: number
  firstUserText?: string
  environment?: string
}

/** Shared base prompt used by both the Electron adapter and headless runner. */
export function buildAgentSessionPrompt(input: AgentPromptInput): string {
  const relationship = {
    waifuId: input.waifu.id,
    userId: 'local-user',
    affectionLevel: input.affection,
    selectedAIProvider: input.provider,
    selectedModel: input.model,
    createdAt: new Date().toISOString(),
    lastInteractedAt: new Date().toISOString(),
  }
  const context = {
    userId: 'local-user',
    affectionLevel: input.affection,
    platform: 'desktop' as const,
    availableTools: Object.entries(input.waifu.capabilities || {})
      .filter(([, enabled]) => !!enabled)
      .map(([name]) => name),
  }
  const languageBlock = input.firstUserText == null
    ? ''
    : `\n\n[Conversation language rule]\nReply in the language of this first user message:\n"""${input.firstUserText.slice(0, 500)}"""`
  const environmentBlock = input.environment
    ? `\n\n[Execution Environment]\n${input.environment}`
    : ''
  const taskPersistenceBlock = `

[Persistent Task Attempts]
- For a concrete task that fails on the first approach, diagnose the actual failure and make at least three materially different, reasonable attempts before concluding it cannot be done.
- Each attempt must change the approach based on evidence (for example: use the command appropriate to the reported OS/shell, check for an available equivalent, use another installed tool/API, or consult authoritative documentation). Do not count repeating the same failed command with unchanged inputs as a new attempt.
- If the task remains blocked, briefly name the distinct approaches already attempted and the concrete blocker in the final response.
- Stop as soon as the task succeeds. Do not manufacture extra attempts after success, and do not retry actions that succeeded.
- Stop before three attempts only for a genuine hard blocker or safety boundary, such as missing credentials, unavailable permissions/approval, required user-only input, or an unsafe/destructive action. Explain the specific blocker; never bypass safeguards or claim success without evidence.`
  const responseLimitsBlock = `

[Concise Final Responses]
- Keep the final user-facing response to 50 words maximum. Prefer a short, direct summary and mention only essential results or blockers.
- When using voice output, write a separate spoken summary for the voice tool: one or two natural sentences, at most 35 words. Do not copy the full written answer into it. Include only what a person would naturally say aloud; omit cards, tables, emoji, markdown, code, logs, tool data, and diagrams.`
  return `${buildSystemPrompt(input.waifu, relationship, context)}${languageBlock}${environmentBlock}${taskPersistenceBlock}${responseLimitsBlock}`
}
