import { describe, expect, it } from 'vitest'
import { getNewChatSuggestionKinds } from '../new-chat-suggestions'

describe('getNewChatSuggestionKinds', () => {
  it('uses saved project and skill memory before generic quick starts', () => {
    expect(getNewChatSuggestionKinds([
      { category: 'projects', key: 'current_project' },
      { category: 'skills', key: 'skill_typescript' },
    ])).toEqual(['project', 'skill', 'personal'])
  })

  it('recognizes project keys even when saved under another category', () => {
    expect(getNewChatSuggestionKinds([{ category: 'general', key: 'active_project' }])).toEqual(['project', 'personal', 'build'])
  })

  it('provides three useful defaults when there is no saved memory', () => {
    expect(getNewChatSuggestionKinds([])).toEqual(['build', 'learn', 'game'])
  })
})
