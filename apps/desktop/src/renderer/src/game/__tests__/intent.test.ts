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

  it('recognizes the exact composer request that should open the board immediately', () => {
    expect(detectGameLaunchIntent('play chess with me')).toMatchObject({
      kind: 'chess',
      difficulty: 'balanced',
      humanSide: 'w',
      humanStarts: true,
    })
  })

  it('opens a playable default for the new-chat game suggestion', () => {
    expect(detectGameLaunchIntent('Play a game with Aria ✨.')).toMatchObject({
      kind: 'tictactoe',
      difficulty: 'balanced',
      humanStarts: true,
    })
  })

  it('resolves an ordinal follow-up against games the assistant just offered', () => {
    const options = 'Here are a few options: 1. Tic-Tac-Toe, Connect Four, and Chess.'
    expect(detectGameLaunchIntent('play the first one', options)?.kind).toBe('tictactoe')
    expect(detectGameLaunchIntent('let us play option 2', options)?.kind).toBe('connect4')
    expect(detectGameLaunchIntent('number 3 please', options)?.kind).toBe('chess')
  })

  it('does not guess an ordinal game without an offered game list', () => {
    expect(detectGameLaunchIntent('play the first one', 'The first one sounds fun.')).toBe(null)
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

  it('opens named games and a default board from localized prompts', () => {
    for (const prompt of [
      '我们来下一盘国际象棋吧。',
      'Jouons rapidement aux échecs.',
      'Давай сыграем в шахматы.',
      'チェスを一局しよう。',
    ]) {
      expect(detectGameLaunchIntent(prompt)?.kind).toBe('chess')
    }

    for (const prompt of [
      '和Aria玩个游戏。',
      'Joue à un jeu avec Aria.',
      'Сыграй со мной в игру, Aria.',
      'Ariaとゲームをしよう。',
    ]) {
      expect(detectGameLaunchIntent(prompt)?.kind).toBe('tictactoe')
    }
  })

  it('does not open a board for cancellation or a question about games', () => {
    expect(detectGameLaunchIntent("Don't play a game yet.")).toBe(null)
    expect(detectGameLaunchIntent('What games can we play?')).toBe(null)
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
