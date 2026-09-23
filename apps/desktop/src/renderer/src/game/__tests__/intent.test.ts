import { describe, expect, it } from 'vitest'
import { detectGameLaunchIntent } from '../intent'

describe('detectGameLaunchIntent', () => {
  it('opens Tic-Tac-Toe for a direct play request', () => {
    expect(detectGameLaunchIntent('play tic tac toe with me')).toEqual({
      kind: 'tictactoe',
      difficulty: 'balanced',
      humanSide: 'w',
      humanStarts: true,
    })
  })

  it('understands Connect Four and a stronger challenge', () => {
    expect(detectGameLaunchIntent('open connect 4 on hard')).toMatchObject({
      kind: 'connect4',
      difficulty: 'strong',
    })
  })

  it('starts chess with the agent when the user chooses black', () => {
    expect(detectGameLaunchIntent('chess, I will play black')).toMatchObject({
      kind: 'chess',
      humanSide: 'b',
      humanStarts: true,
    })
  })

  it('opens the chess panel from localized quick-start prompts', () => {
    for (const prompt of [
      '我们来下一盘国际象棋吧。',
      'Jouons rapidement aux échecs.',
      'Давай сыграем в шахматы.',
      'チェスを一局しよう。',
    ]) {
      expect(detectGameLaunchIntent(prompt)?.kind).toBe('chess')
    }
  })

  it('does not guess a game from unrelated text', () => {
    expect(detectGameLaunchIntent('Can you explain the engine design?')).toEqual(null)
  })

  it('lets the agent open first when requested', () => {
    expect(detectGameLaunchIntent('play chess, you start')).toMatchObject({
      kind: 'chess',
      humanStarts: false,
    })
  })
})
