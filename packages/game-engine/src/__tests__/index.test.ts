import { describe, expect, it } from 'vitest'
import {
  createGameController,
  IllegalGameMoveError,
} from '../index'

describe('minigame engines', () => {
  it('plays Tic-Tac-Toe with a legal minimax move', () => {
    const game = createGameController('tictactoe', { difficulty: 'strong' })
    expect(game.snapshot().turn).toBe('human')

    game.applyMove('0', 'human')
    const move = game.bestMove()

    expect(move).toBeTruthy()
    expect(game.legalMoves()).toContain(move)
    expect(game.applyMove(move!, 'agent').moveCount).toBe(2)
  })

  it('keeps Connect Four moves in open columns and searches for a move', () => {
    const game = createGameController('connect4', { difficulty: 'balanced' })
    game.applyMove('3', 'human')
    const move = game.bestMove()

    expect(move).toBeTruthy()
    expect(game.legalMoves()).toContain(move)
    const snapshot = game.applyMove(move!, 'agent')
    expect((snapshot.board as string[][]).flat()).toContain('agent')
  })

  it('uses chess.js to reject illegal moves and an engine to select legal moves', () => {
    const game = createGameController('chess', { difficulty: 'balanced' })

    expect(() => game.applyMove('e5', 'human')).toThrow(IllegalGameMoveError)
    const afterOpening = game.applyMove('e4', 'human')
    expect((afterOpening.board as { fen: string }).fen).not.toBe('start')

    const move = game.bestMove()
    expect(move).toBeTruthy()
    expect(game.legalMoves()).toContain(move)
    expect(game.applyMove(move!, 'agent').moveCount).toBe(2)
  })

  it('searches strong chess moves without changing the live position', () => {
    const game = createGameController('chess', { difficulty: 'strong' })
    game.applyMove('e2e4', 'human')
    const before = game.snapshot()
    const move = game.bestMove()

    expect(move).toBeTruthy()
    expect(before.legalMoves).toContain(move)
    expect(game.snapshot()).toEqual(before)
    expect(game.applyMove(move!, 'agent').moveCount).toBe(2)
  })

  it('lets the engine open when the user elects to play second', () => {
    const game = createGameController('tictactoe', { humanStarts: false })
    expect(game.snapshot().turn).toBe('agent')
    const move = game.bestMove()
    expect(move).toBeTruthy()
    const after = game.applyMove(move!, 'agent')
    expect(after.turn).toBe('human')
  })
})
