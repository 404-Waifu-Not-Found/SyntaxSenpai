export type NewChatSuggestionKind = 'news' | 'weather' | 'game'

export interface NewChatSuggestion {
  kind: NewChatSuggestionKind
  label: string
  prompt: string
}

export interface SuggestionHistoryMessage {
  role?: string
  content?: unknown
}

export interface MemorySuggestionSource {
  category?: string
  key?: string
}

/** Keep the three quick-start actions stable; memory personalizes their details. */
export function getNewChatSuggestionKinds(_memories: MemorySuggestionSource[]): NewChatSuggestionKind[] {
  return ['news', 'weather', 'game']
}

const SUGGESTION_KINDS = new Set<NewChatSuggestionKind>(['news', 'weather', 'game'])
const DEFAULT_SUGGESTION_ORDER: NewChatSuggestionKind[] = ['news', 'weather', 'game']

/** Parse and bound provider output before it is displayed or sent as a prompt. */
export function parseNewChatSuggestions(raw: string, characterName = ''): NewChatSuggestion[] {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = unfenced.indexOf('[')
  const end = unfenced.lastIndexOf(']')
  if (start < 0 || end <= start) return []

  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    const suggestions: NewChatSuggestion[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const kind = String(item.kind || '') as NewChatSuggestionKind
      const label = typeof item.label === 'string' ? item.label.replace(/\s+/g, ' ').trim().slice(0, 36) : ''
      const prompt = typeof item.prompt === 'string' ? item.prompt.replace(/\s+/g, ' ').trim().slice(0, 180) : ''
      const normalizedPrompt = prompt.toLocaleLowerCase()
      if (!SUGGESTION_KINDS.has(kind) || !label || prompt.length < 8 || seen.has(normalizedPrompt)) continue
      seen.add(normalizedPrompt)
      suggestions.push({ kind, label, prompt })
      if (suggestions.length === 3) break
    }
    if (suggestions.length !== DEFAULT_SUGGESTION_ORDER.length) return []
    const suggestionsByKind = new Map(suggestions.map((suggestion) => [suggestion.kind, suggestion]))
    if (DEFAULT_SUGGESTION_ORDER.some((kind) => !suggestionsByKind.has(kind))) return []

    return DEFAULT_SUGGESTION_ORDER.map((kind) => {
      const suggestion = suggestionsByKind.get(kind)!
      if (kind !== 'game' || !characterName || suggestion.prompt.toLocaleLowerCase().includes(characterName.toLocaleLowerCase())) {
        return suggestion
      }
      return { ...suggestion, prompt: `Play a game with ${characterName}. ${suggestion.prompt}`.slice(0, 180) }
    })
  } catch {
    return []
  }
}

/** Build small text-only context; attachments and tool output never enter suggestions. */
export function buildNewChatSuggestionContext(
  memories: Array<{ category?: string; key?: string; value?: string }>,
  conversations: Array<{ title?: string; summary?: string; messages?: SuggestionHistoryMessage[] }>,
): string {
  const memoryLines = memories
    .slice(0, 24)
    .map((memory) => `- [${String(memory.category || 'general').slice(0, 40)}] ${String(memory.key || '').slice(0, 100)}: ${String(memory.value || '').slice(0, 400)}`)
  const chatBlocks = conversations.slice(0, 5).map((conversation, index) => {
    const messages = (conversation.messages || [])
      .filter((message) => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
      .slice(-8)
      .map((message) => `${message.role}: ${String(message.content).replace(/\s+/g, ' ').slice(0, 700)}`)
    const heading = String(conversation.title || `Recent chat ${index + 1}`).slice(0, 120)
    const summary = String(conversation.summary || '').replace(/\s+/g, ' ').slice(0, 500)
    return [`### ${heading}`, ...(summary ? [`Summary: ${summary}`] : []), ...messages].join('\n')
  })
  return [
    memoryLines.length ? `Saved memories:\n${memoryLines.join('\n')}` : 'Saved memories: none',
    chatBlocks.length ? `Recent conversations:\n${chatBlocks.join('\n\n')}` : 'Recent conversations: none',
  ].join('\n\n')
}

/** Stable, non-sensitive fingerprint for deciding whether cached suggestions are still relevant. */
export function fingerprintSuggestionContext(context: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < context.length; index += 1) {
    hash ^= context.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
