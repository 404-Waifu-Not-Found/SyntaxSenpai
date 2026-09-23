import { describe, expect, it } from 'vitest'
import {
  buildNewChatSuggestionContext,
  fingerprintSuggestionContext,
  getNewChatSuggestionKinds,
  parseNewChatSuggestions,
} from '../new-chat-suggestions'

describe('getNewChatSuggestionKinds', () => {
  it('keeps the default action types stable even when memories are available', () => {
    expect(getNewChatSuggestionKinds([
      { category: 'projects', key: 'current_project' },
      { category: 'skills', key: 'skill_typescript' },
    ])).toEqual(['news', 'weather', 'game'])
  })

  it('provides news, weather, and game defaults when there is no saved memory', () => {
    expect(getNewChatSuggestionKinds([])).toEqual(['news', 'weather', 'game'])
  })
})

describe('personalized new-chat suggestions', () => {
  it('accepts exactly three safe, bounded suggestions from JSON or a fenced response', () => {
    const suggestions = parseNewChatSuggestions(`\`\`\`json
      [{"kind":"news","label":"Today's news","prompt":"Fetch me the news for today."},
       {"kind":"weather","label":"Weather forecast","prompt":"Get me today's weather forecast."},
       {"kind":"game","label":"Play with Aria","prompt":"Play a game with Aria."}]
    \`\`\``)
    expect(suggestions).toHaveLength(3)
    expect(suggestions.map(({ kind }) => kind)).toEqual(['news', 'weather', 'game'])
    expect(suggestions[2].prompt).toContain('Aria')
  })

  it('rejects incomplete, unsupported, and duplicate suggestions', () => {
    expect(parseNewChatSuggestions(JSON.stringify([
      { kind: 'news', label: 'News', prompt: 'Fetch the latest news for today.' },
      { kind: 'news', label: 'Again', prompt: 'Fetch me more news for today.' },
      { kind: 'game', label: 'Nope', prompt: 'Play a game with Aria.' },
    ]))).toEqual([])
  })

  it('ensures the selected character is named in the game prompt', () => {
    const suggestions = parseNewChatSuggestions(JSON.stringify([
      { kind: 'news', label: 'News', prompt: 'Fetch the news for today.' },
      { kind: 'weather', label: 'Weather', prompt: 'Get today’s weather forecast.' },
      { kind: 'game', label: 'Game', prompt: 'Let’s play Tic-Tac-Toe.' },
    ]), 'Hana 💻')
    expect(suggestions[2].prompt).toContain('Hana 💻')
  })

  it('includes saved memories and recent chat excerpts but excludes non-text/tool messages', () => {
    const context = buildNewChatSuggestionContext(
      [{ category: 'projects', key: 'active', value: 'Settings export/import' }],
      [{ title: 'Backup work', messages: [
        { role: 'user', content: 'Add automatic backups' },
        { role: 'tool', content: 'internal command output' },
        { role: 'assistant', content: [{ type: 'text', text: 'not plain text' }] },
      ] }],
    )
    expect(context).toContain('Settings export/import')
    expect(context).toContain('Add automatic backups')
    expect(context).not.toContain('internal command output')
    expect(context).not.toContain('not plain text')
  })

  it('fingerprints context deterministically and changes when history changes', () => {
    expect(fingerprintSuggestionContext('same')).toBe(fingerprintSuggestionContext('same'))
    expect(fingerprintSuggestionContext('memory A')).not.toBe(fingerprintSuggestionContext('memory B'))
  })
})
