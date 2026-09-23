import { describe, expect, it } from 'vitest'
import { normalizeVoiceoverText, stripBoardDiagrams } from '../assistant-output'

describe('assistant game output safety', () => {
  it('removes a tic-tac-toe grid but keeps the surrounding reply', () => {
    expect(stripBoardDiagrams('Your turn!\nHere is the board:\n[ ][X][ ]\n[O][ ][ ]\n[ ][ ][O]\nClick a square.'))
      .toBe('Your turn!\nClick a square.')
  })

  it('removes chess ASCII and pipe-grid rows', () => {
    expect(stripBoardDiagrams('The position is sharp.\n8 | r n b q k b n r\n7 | p p p p p p p p\nr n b q k b n r\n| X | O | X |\n| X |   | O |\nYour move.'))
      .toBe('The position is sharp.\nYour move.')
  })

  it('keeps ordinary code blocks and prose', () => {
    const response = 'Here is the parser:\n```ts\nconst answer = 42\n```'
    expect(stripBoardDiagrams(response)).toBe(response)
  })

  it('reduces voice-over content to a clean spoken line', () => {
    expect(normalizeVoiceoverText('**Nice move!** ✨\n[board](https://example.com)'))
      .toBe('Nice move!')
  })

  it('omits card tables, emoji, code, and excess narration from speech', () => {
    const text = 'Here is the forecast ✨. ```syntax-senpai-card\n{ "type": "weather" }\n```\n| Date | Rain |\n| --- | --- |\nThe sky will stay clear. ```const x = 1```'
    expect(normalizeVoiceoverText(text)).toBe('Here is the forecast. The sky will stay clear.')
  })

  it('does not speak a board diagram by itself', () => {
    expect(normalizeVoiceoverText('[X][O][X]\n[O][X][O]\n[X][O][X]')).toBe('')
  })

  it('keeps speech clean of coordinate notation', () => {
    expect(normalizeVoiceoverText('I replied with Nf6 after your e4.')).toBe('')
  })
})
