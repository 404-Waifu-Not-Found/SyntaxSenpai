import { describe, expect, it } from 'vitest'
import { checkWinAt, chooseAiMove, createEmptyBoard, hasEmptyCell, type Cell } from '../gomoku-engine'

describe('gomoku-engine', () => {
  it('creates empty board by size', () => {
    const board = createEmptyBoard(15)
    expect(board).toHaveLength(225)
    expect(hasEmptyCell(board)).toBe(true)
  })

  it('detects five in a row', () => {
    const size = 15
    const board = createEmptyBoard(size)
    const row = 6
    for (let col = 4; col <= 8; col++) {
      board[row * size + col] = 'black'
    }
    expect(checkWinAt(board, size, row * size + 6, 'black')).toBe(true)
  })

  it('prefers immediate winning move', () => {
    const size = 15
    const board = createEmptyBoard(size)
    const row = 8
    for (let col = 5; col <= 8; col++) {
      board[row * size + col] = 'white'
    }
    const aiMove = chooseAiMove(board, size, 'white', 'black')
    expect([row * size + 4, row * size + 9]).toContain(aiMove)
  })

  it('blocks opponent immediate win', () => {
    const size = 15
    const board = createEmptyBoard(size)
    const row = 7
    for (let col = 3; col <= 6; col++) {
      board[row * size + col] = 'black'
    }
    const aiMove = chooseAiMove(board, size, 'white', 'black')
    expect([row * size + 2, row * size + 7]).toContain(aiMove)
  })

  it('selects deterministic opening on empty board', () => {
    const size = 15
    const board = createEmptyBoard(size)
    const moveA = chooseAiMove(board, size, 'white', 'black')
    const moveB = chooseAiMove(board, size, 'white', 'black')
    expect(moveA).toBe(112)
    expect(moveB).toBe(112)
  })

  it('selects center cluster deterministically on even board sizes', () => {
    const size = 10
    const board = createEmptyBoard(size)
    expect(chooseAiMove(board, size, 'white', 'black')).toBe(44)
  })

  it('recognizes full board as no empty cell', () => {
    const board: Cell[] = Array.from({ length: 100 }, (_, index) => (index % 2 ? 'black' : 'white'))
    expect(hasEmptyCell(board)).toBe(false)
  })
})
