import { describe, expect, it } from 'vitest'
import { fallbackConversationTitle, needsAutomaticConversationTitle } from '../conversation-title'

describe('conversation title helpers', () => {
  it('recognizes eager timestamp titles as placeholders', () => {
    expect(needsAutomaticConversationTitle('Hana 💻 - 9/22/2026, 2:27 PM', 'Hana 💻')).toBe(true)
    expect(needsAutomaticConversationTitle('A real title', 'Hana 💻')).toBe(false)
  })

  it('creates a readable local fallback from the first message', () => {
    expect(fallbackConversationTitle('  play tic tac toe with me, please!  ')).toBe('play tic tac toe with me, please')
    expect(fallbackConversationTitle('')).toBe('New conversation')
  })
})
