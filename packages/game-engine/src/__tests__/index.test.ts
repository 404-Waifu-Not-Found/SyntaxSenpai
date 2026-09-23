import { describe, expect, it, vi } from 'vitest'
import {
  createGameController,
  IllegalGameMoveError,
} from '../index'

describe('minigame engines', () => {
  it('plays Tic-Tac-Toe with a legal minimax move', async () => {
    const game = createGameController('tictactoe', { difficulty: 'strong' })
    expect(game.snapshot().turn).toBe('human')

    game.applyMove('0', 'human')
    const move = await game.bestMove()

    expect(move).toBeTruthy()
    expect(game.legalMoves()).toContain(move)
    expect(game.applyMove(move!, 'agent').moveCount).toBe(2)
  })

  it('keeps Connect Four moves in open columns and searches for a move', async () => {
    const game = createGameController('connect4', { difficulty: 'balanced' })
    game.applyMove('3', 'human')
    const move = await game.bestMove()

    expect(move).toBeTruthy()
    expect(game.legalMoves()).toContain(move)
    const snapshot = game.applyMove(move!, 'agent')
    expect((snapshot.board as string[][]).flat()).toContain('agent')
  })

  it('uses Stockfish MultiPV and picks its third distinct legal chess move', async () => {
    const game = createGameController('chess', {
      difficulty: 'balanced',
      chessMoveProvider: async () => ['e7e5', 'c7c5', 'g8f6'],
    })

    expect(() => game.applyMove('e5', 'human')).toThrow(IllegalGameMoveError)
    const afterOpening = game.applyMove('e4', 'human')
    expect((afterOpening.board as { fen: string }).fen).not.toBe('start')

    const move = await game.bestMove()
    expect(move).toBe('Nf6')
    expect(game.legalMoves()).toContain(move)
    expect(game.applyMove(move!, 'agent').moveCount).toBe(2)
  })

  it('shares Stockfish evaluation and SAN variations in the game snapshot', async () => {
    const game = createGameController('chess', {
      chessAnalysisProvider: async () => ({
        depth: 17,
        bestMove: 'e7e5',
        stoppedForMate: false,
        lines: [
          { rank: 1, depth: 17, score: { type: 'cp', value: 32 }, moves: ['e7e5', 'g1f3'] },
          { rank: 2, depth: 17, score: { type: 'cp', value: 20 }, moves: ['c7c5', 'g1f3'] },
          { rank: 3, depth: 17, score: { type: 'cp', value: 11 }, moves: ['g8f6', 'b1c3'] },
        ],
      }),
    })
    game.applyMove('e2e4', 'human')

    expect(await game.bestMove()).toBe('Nf6')
    const afterAgent = game.applyMove('Nf6', 'agent')

    expect(afterAgent.chessAnalysis).toMatchObject({
      depth: 17,
      evaluation: { type: 'cp', value: -32, perspective: 'white' },
      playedRank: 3,
      forcedMateWithinThree: false,
    })
    expect(afterAgent.chessAnalysis?.lines[0]).toMatchObject({ rank: 1, moves: ['e5', 'Nf3'] })
  })

  it('immediately selects a forced mate-in-three line instead of a weaker MultiPV choice', async () => {
    const options = vi.fn(async () => ({
      depth: 18,
      bestMove: 'e7e5',
      stoppedForMate: true,
      lines: [{ rank: 1, depth: 18, score: { type: 'mate' as const, value: 3 }, moves: ['e7e5', 'g1f3', 'b8c6'] }],
    }))
    const game = createGameController('chess', { chessAnalysisProvider: options })
    game.applyMove('e2e4', 'human')

    expect(await game.bestMove()).toBe('e5')
    expect(options).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stopOnMateIn: 3 }))
    const afterAgent = game.applyMove('e5', 'agent')
    expect(afterAgent.chessAnalysis).toMatchObject({
      evaluation: { type: 'mate', value: -3, perspective: 'white' },
      playedRank: 1,
      forcedMateWithinThree: true,
      lines: [{ rank: 1, moves: ['e5', 'Nf3', 'Nc6'] }],
    })
  })

  it('keeps the live chess position unchanged while Stockfish analyzes it', async () => {
    const game = createGameController('chess', {
      difficulty: 'strong',
      chessMoveProvider: async () => ['e7e5', 'c7c5', 'g8f6'],
    })
    game.applyMove('e2e4', 'human')
    const before = game.snapshot()
    const move = await game.bestMove()

    expect(move).toBeTruthy()
    expect(before.legalMoves).toContain(move)
    expect(game.snapshot()).toEqual(before)
    expect(game.applyMove(move!, 'agent').moveCount).toBe(2)
  })

  it('lets the engine open when the user elects to play second', async () => {
    const game = createGameController('tictactoe', { humanStarts: false })
    expect(game.snapshot().turn).toBe('agent')
    const move = await game.bestMove()
    expect(move).toBeTruthy()
    const after = game.applyMove(move!, 'agent')
    expect(after.turn).toBe('human')
  })
})
