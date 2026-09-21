import { Chess, type Move as ChessMove, type PieceSymbol } from 'chess.js'

export type GameKind = 'tictactoe' | 'connect4' | 'chess'
export type GameSide = 'human' | 'agent'
export type GameDifficulty = 'casual' | 'balanced' | 'strong'
export type GameStatus = 'playing' | 'won' | 'draw'

export interface GameOptions {
  difficulty?: GameDifficulty
  humanSide?: string
  humanStarts?: boolean
}

export interface GameSnapshot {
  kind: GameKind
  engine: string
  difficulty: GameDifficulty
  humanSide: string
  turn: GameSide | null
  status: GameStatus
  winner: GameSide | null
  moveCount: number
  moves: string[]
  legalMoves: string[]
  lastMove: string | null
  board: unknown
}

export interface GameController {
  readonly kind: GameKind
  snapshot(): GameSnapshot
  legalMoves(): string[]
  applyMove(move: string, actor: GameSide): GameSnapshot
  bestMove(): string | null
}

export class IllegalGameMoveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalGameMoveError'
  }
}

function difficultyOf(options?: GameOptions): GameDifficulty {
  return options?.difficulty === 'casual' || options?.difficulty === 'strong'
    ? options.difficulty
    : 'balanced'
}

function sideForTurn(turn: boolean): GameSide {
  return turn ? 'human' : 'agent'
}

function randomItem<T>(items: T[]): T | null {
  return items.length > 0 ? items[Math.floor(Math.random() * items.length)] : null
}

class TicTacToeController implements GameController {
  readonly kind = 'tictactoe' as const
  private readonly difficulty: GameDifficulty
  private readonly cells: Array<'empty' | 'human' | 'agent'> = Array(9).fill('empty')
  private turn: GameSide | null
  private status: GameStatus = 'playing'
  private winner: GameSide | null = null
  private moves: string[] = []
  private lastMove: string | null = null

  constructor(options?: GameOptions) {
    this.difficulty = difficultyOf(options)
    this.turn = options?.humanStarts === false ? 'agent' : 'human'
  }

  snapshot(): GameSnapshot {
    return {
      kind: this.kind,
      engine: 'Perfect minimax',
      difficulty: this.difficulty,
      humanSide: 'X',
      turn: this.turn,
      status: this.status,
      winner: this.winner,
      moveCount: this.moves.length,
      moves: [...this.moves],
      legalMoves: this.legalMoves(),
      lastMove: this.lastMove,
      board: [...this.cells],
    }
  }

  legalMoves(): string[] {
    return this.status === 'playing'
      ? this.cells.flatMap((cell, index) => (cell === 'empty' ? [String(index)] : []))
      : []
  }

  applyMove(move: string, actor: GameSide): GameSnapshot {
    if (this.status !== 'playing') throw new IllegalGameMoveError('The game is already over.')
    if (this.turn !== actor) throw new IllegalGameMoveError(`It is ${this.turn}'s turn.`)
    const index = Number(move)
    if (!Number.isInteger(index) || index < 0 || index > 8 || this.cells[index] !== 'empty') {
      throw new IllegalGameMoveError('Tic-Tac-Toe moves must target an empty square from 0 to 8.')
    }
    this.cells[index] = actor
    this.moves.push(String(index))
    this.lastMove = String(index)
    const winner = this.findWinner(this.cells)
    if (winner) {
      this.status = 'won'
      this.winner = winner === 'human' ? 'human' : 'agent'
      this.turn = null
    } else if (this.cells.every((cell) => cell !== 'empty')) {
      this.status = 'draw'
      this.turn = null
    } else {
      this.turn = actor === 'human' ? 'agent' : 'human'
    }
    return this.snapshot()
  }

  bestMove(): string | null {
    const legal = this.legalMoves()
    if (legal.length === 0 || this.turn !== 'agent') return null
    if (this.difficulty === 'casual') return randomItem(legal)

    let bestScore = -Infinity
    let best: string | null = null
    for (const move of legal) {
      const next = [...this.cells]
      next[Number(move)] = 'agent'
      const score = this.minimax(next, false)
      if (score > bestScore) {
        bestScore = score
        best = move
      }
    }
    return best
  }

  private minimax(cells: Array<'empty' | 'human' | 'agent'>, maximizing: boolean): number {
    const winner = this.findWinner(cells)
    if (winner === 'agent') return 10
    if (winner === 'human') return -10
    if (cells.every((cell) => cell !== 'empty')) return 0
    const scores = cells.flatMap((cell, index) => {
      if (cell !== 'empty') return []
      const next = [...cells]
      next[index] = maximizing ? 'agent' : 'human'
      return [this.minimax(next, !maximizing)]
    })
    return maximizing ? Math.max(...scores) : Math.min(...scores)
  }

  private findWinner(cells: Array<'empty' | 'human' | 'agent'>): 'human' | 'agent' | null {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ]
    for (const [a, b, c] of lines) {
      if (cells[a] !== 'empty' && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a]
    }
    return null
  }
}

type ConnectCell = 'empty' | 'human' | 'agent'
const CONNECT_ROWS = 6
const CONNECT_COLUMNS = 7

class ConnectFourController implements GameController {
  readonly kind = 'connect4' as const
  private readonly difficulty: GameDifficulty
  private readonly cells: ConnectCell[] = Array(CONNECT_ROWS * CONNECT_COLUMNS).fill('empty')
  private turn: GameSide | null
  private status: GameStatus = 'playing'
  private winner: GameSide | null = null
  private moves: string[] = []
  private lastMove: string | null = null

  constructor(options?: GameOptions) {
    this.difficulty = difficultyOf(options)
    this.turn = options?.humanStarts === false ? 'agent' : 'human'
  }

  snapshot(): GameSnapshot {
    return {
      kind: this.kind,
      engine: `Alpha-beta Connect Four (${this.difficulty})`,
      difficulty: this.difficulty,
      humanSide: 'Red',
      turn: this.turn,
      status: this.status,
      winner: this.winner,
      moveCount: this.moves.length,
      moves: [...this.moves],
      legalMoves: this.legalMoves(),
      lastMove: this.lastMove,
      board: Array.from({ length: CONNECT_ROWS }, (_, row) => this.cells.slice(row * CONNECT_COLUMNS, (row + 1) * CONNECT_COLUMNS)),
    }
  }

  legalMoves(): string[] {
    return this.status === 'playing'
      ? Array.from({ length: CONNECT_COLUMNS }, (_, column) => this.cells[column] === 'empty' ? String(column) : null).filter((column): column is string => column !== null)
      : []
  }

  applyMove(move: string, actor: GameSide): GameSnapshot {
    if (this.status !== 'playing') throw new IllegalGameMoveError('The game is already over.')
    if (this.turn !== actor) throw new IllegalGameMoveError(`It is ${this.turn}'s turn.`)
    const column = Number(move)
    if (!Number.isInteger(column) || column < 0 || column >= CONNECT_COLUMNS || this.cells[column] !== 'empty') {
      throw new IllegalGameMoveError('Connect Four moves must target an open column from 0 to 6.')
    }
    const row = this.drop(column, actor)
    this.moves.push(String(column))
    this.lastMove = String(column)
    if (this.hasFour(row, column, actor)) {
      this.status = 'won'
      this.winner = actor
      this.turn = null
    } else if (this.cells.every((cell) => cell !== 'empty')) {
      this.status = 'draw'
      this.turn = null
    } else {
      this.turn = actor === 'human' ? 'agent' : 'human'
    }
    return this.snapshot()
  }

  bestMove(): string | null {
    const legal = this.legalMoves()
    if (legal.length === 0 || this.turn !== 'agent') return null
    if (this.difficulty === 'casual') return randomItem(legal)
    const depth = this.difficulty === 'strong' ? 7 : 5
    let bestScore = -Infinity
    let best: string | null = null
    for (const column of this.orderColumns(legal.map(Number))) {
      const row = this.drop(column, 'agent')
      const score = this.search(depth - 1, false, -Infinity, Infinity)
      this.cells[row * CONNECT_COLUMNS + column] = 'empty'
      if (score > bestScore) {
        bestScore = score
        best = String(column)
      }
    }
    return best
  }

  private drop(column: number, side: ConnectCell): number {
    for (let row = CONNECT_ROWS - 1; row >= 0; row--) {
      const index = row * CONNECT_COLUMNS + column
      if (this.cells[index] === 'empty') {
        this.cells[index] = side
        return row
      }
    }
    throw new IllegalGameMoveError('That Connect Four column is full.')
  }

  private search(depth: number, maximizing: boolean, alpha: number, beta: number): number {
    if (depth <= 0) return this.evaluate()
    const legal = this.legalMoves().map(Number)
    if (legal.length === 0) return 0
    if (maximizing) {
      let value = -Infinity
      for (const column of this.orderColumns(legal)) {
        const row = this.drop(column, 'agent')
        value = Math.max(value, this.search(depth - 1, false, alpha, beta))
        this.cells[row * CONNECT_COLUMNS + column] = 'empty'
        alpha = Math.max(alpha, value)
        if (alpha >= beta) break
      }
      return value
    }
    let value = Infinity
    for (const column of this.orderColumns(legal)) {
      const row = this.drop(column, 'human')
      value = Math.min(value, this.search(depth - 1, true, alpha, beta))
      this.cells[row * CONNECT_COLUMNS + column] = 'empty'
      beta = Math.min(beta, value)
      if (alpha >= beta) break
    }
    return value
  }

  private evaluate(): number {
    let score = 0
    for (let row = 0; row < CONNECT_ROWS; row++) {
      for (let column = 0; column < CONNECT_COLUMNS; column++) {
        const cell = this.cells[row * CONNECT_COLUMNS + column]
        if (cell === 'agent') score += column === 3 ? 5 : 1
        if (cell === 'human') score -= column === 3 ? 5 : 1
      }
    }
    for (const window of this.windows()) score += this.scoreWindow(window)
    return score
  }

  private scoreWindow(window: ConnectCell[]): number {
    const agent = window.filter((cell) => cell === 'agent').length
    const human = window.filter((cell) => cell === 'human').length
    const empty = window.filter((cell) => cell === 'empty').length
    if (agent === 4) return 100000
    if (human === 4) return -100000
    if (agent === 3 && empty === 1) return 50
    if (agent === 2 && empty === 2) return 8
    if (human === 3 && empty === 1) return -60
    if (human === 2 && empty === 2) return -10
    return 0
  }

  private windows(): ConnectCell[][] {
    const result: ConnectCell[][] = []
    for (let row = 0; row < CONNECT_ROWS; row++) {
      for (let column = 0; column < CONNECT_COLUMNS; column++) {
        if (column <= CONNECT_COLUMNS - 4) result.push([0, 1, 2, 3].map((offset) => this.cells[row * CONNECT_COLUMNS + column + offset]))
        if (row <= CONNECT_ROWS - 4) result.push([0, 1, 2, 3].map((offset) => this.cells[(row + offset) * CONNECT_COLUMNS + column]))
        if (row <= CONNECT_ROWS - 4 && column <= CONNECT_COLUMNS - 4) result.push([0, 1, 2, 3].map((offset) => this.cells[(row + offset) * CONNECT_COLUMNS + column + offset]))
        if (row >= 3 && column <= CONNECT_COLUMNS - 4) result.push([0, 1, 2, 3].map((offset) => this.cells[(row - offset) * CONNECT_COLUMNS + column + offset]))
      }
    }
    return result
  }

  private hasFour(row: number, column: number, side: ConnectCell): boolean {
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]]
    return directions.some(([dr, dc]) => 1 + this.count(row, column, dr, dc, side) + this.count(row, column, -dr, -dc, side) >= 4)
  }

  private count(row: number, column: number, dr: number, dc: number, side: ConnectCell): number {
    let total = 0
    let nextRow = row + dr
    let nextColumn = column + dc
    while (nextRow >= 0 && nextRow < CONNECT_ROWS && nextColumn >= 0 && nextColumn < CONNECT_COLUMNS && this.cells[nextRow * CONNECT_COLUMNS + nextColumn] === side) {
      total++
      nextRow += dr
      nextColumn += dc
    }
    return total
  }

  private orderColumns(columns: number[]): number[] {
    return [...columns].sort((a, b) => Math.abs(3 - a) - Math.abs(3 - b))
  }
}

type ChessSide = 'w' | 'b'
type ChessCell = { type: PieceSymbol; color: ChessSide } | null

class ChessController implements GameController {
  readonly kind = 'chess' as const
  private readonly difficulty: GameDifficulty
  private readonly humanSide: ChessSide
  private readonly game: Chess
  private moves: string[] = []
  private lastMove: string | null = null

  constructor(options?: GameOptions) {
    this.difficulty = difficultyOf(options)
    this.humanSide = options?.humanSide === 'b' ? 'b' : 'w'
    this.game = new Chess()
    if (options?.humanStarts === false) this.game.setTurn(this.humanSide === 'w' ? 'b' : 'w')
  }

  snapshot(): GameSnapshot {
    const gameOver = this.game.isGameOver()
    const checkmate = this.game.isCheckmate()
    const winner = gameOver && checkmate
      ? (this.game.turn() === this.humanSide ? 'agent' : 'human')
      : null
    return {
      kind: this.kind,
      engine: `Chess alpha-beta (${this.difficulty})`,
      difficulty: this.difficulty,
      humanSide: this.humanSide,
      turn: gameOver ? null : this.game.turn() === this.humanSide ? 'human' : 'agent',
      status: winner ? 'won' : gameOver ? 'draw' : 'playing',
      winner,
      moveCount: this.moves.length,
      moves: [...this.moves],
      legalMoves: this.legalMoves(),
      lastMove: this.lastMove,
      board: {
        fen: this.game.fen(),
        check: this.game.inCheck(),
        cells: this.game.board().map((row) => row.map((piece) => piece ? { type: piece.type, color: piece.color } : null)),
      },
    }
  }

  legalMoves(): string[] {
    return this.game.isGameOver() ? [] : this.game.moves()
  }

  applyMove(move: string, actor: GameSide): GameSnapshot {
    const currentTurn = this.game.turn() === this.humanSide ? 'human' : 'agent'
    if (this.game.isGameOver()) throw new IllegalGameMoveError('The game is already over.')
    if (currentTurn !== actor) throw new IllegalGameMoveError(`It is ${currentTurn}'s turn.`)
    const trimmed = String(move || '').trim()
    if (!trimmed) throw new IllegalGameMoveError('Chess moves must be SAN such as Nf3 or long algebraic such as e2e4.')
    let applied: ChessMove
    try {
      applied = this.game.move(trimmed, { strict: false })
    } catch {
      throw new IllegalGameMoveError(`Illegal chess move: ${trimmed}`)
    }
    this.moves.push(applied.san)
    this.lastMove = applied.san
    return this.snapshot()
  }

  bestMove(): string | null {
    if (this.game.isGameOver() || (this.game.turn() === this.humanSide ? 'human' : 'agent') !== 'agent') return null
    if (this.difficulty === 'casual') return randomItem(this.game.moves())
    const depth = this.difficulty === 'strong' ? 3 : 2
    const moves = this.game.moves({ verbose: true })
    let best: ChessMove | null = null
    let bestScore = -Infinity
    for (const move of moves) {
      const child = new Chess(this.game.fen())
      child.move({ from: move.from, to: move.to, promotion: move.promotion })
      const score = this.search(child, depth - 1, false)
      if (score > bestScore) {
        bestScore = score
        best = move
      }
    }
    return best?.san ?? null
  }

  private search(position: Chess, depth: number, maximizing: boolean): number {
    if (position.isCheckmate()) return position.turn() === this.humanSide ? 100000 : -100000
    if (position.isGameOver() || depth <= 0) return this.evaluate(position)
    const moves = position.moves({ verbose: true })
    let result = maximizing ? -Infinity : Infinity
    for (const move of moves) {
      const child = new Chess(position.fen())
      child.move({ from: move.from, to: move.to, promotion: move.promotion })
      const score = this.search(child, depth - 1, !maximizing)
      result = maximizing ? Math.max(result, score) : Math.min(result, score)
    }
    return result
  }

  private evaluate(position: Chess): number {
    const values: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }
    let score = 0
    for (const row of position.board()) {
      for (const piece of row) {
        if (!piece) continue
        const value = values[piece.type]
        score += piece.color === this.humanSide ? -value : value
      }
    }
    return score
  }
}

export function createGameController(kind: GameKind, options?: GameOptions): GameController {
  if (kind === 'tictactoe') return new TicTacToeController(options)
  if (kind === 'connect4') return new ConnectFourController(options)
  return new ChessController(options)
}

export function gameMoveLabel(kind: GameKind, move: string): string {
  if (kind === 'tictactoe') return `square ${Number(move) + 1}`
  if (kind === 'connect4') return `column ${Number(move) + 1}`
  return move
}
