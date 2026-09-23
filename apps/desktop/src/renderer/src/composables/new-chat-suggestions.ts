export type NewChatSuggestionKind = 'project' | 'skill' | 'personal' | 'build' | 'learn' | 'game'

export interface MemorySuggestionSource {
  category?: string
  key?: string
}

/** Choose quick-start actions only from the kinds of memories actually saved. */
export function getNewChatSuggestionKinds(memories: MemorySuggestionSource[]): NewChatSuggestionKind[] {
  const categories = new Set(memories.map((memory) => String(memory.category || '').toLowerCase()))
  const keys = memories.map((memory) => String(memory.key || '').toLowerCase())
  const kinds: NewChatSuggestionKind[] = []

  if (categories.has('projects') || keys.some((key) => /project|current_work|active_goal/.test(key))) kinds.push('project')
  if (categories.has('skills') || keys.some((key) => /skill|learning_goal|study_topic/.test(key))) kinds.push('skill')
  if (memories.length > 0) kinds.push('personal')

  for (const kind of ['build', 'learn', 'game'] as const) {
    if (kinds.length >= 3) break
    if (!kinds.includes(kind)) kinds.push(kind)
  }

  return kinds.slice(0, 3)
}
