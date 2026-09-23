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
  return `${buildSystemPrompt(input.waifu, relationship, context)}${languageBlock}${environmentBlock}`
}
