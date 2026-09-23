import { Chess, type Move as ChessMove } from 'chess.js'
import type { StockfishAnalysis, StockfishAnalysisProvider, StockfishMoveProvider, StockfishScore } from './stockfish-uci.js'

export { createStockfishAnalysisProvider, createStockfishMoveProvider } from './stockfish-uci.js'
export type {
  StockfishAnalysis,
  StockfishAnalysisOptions,
  StockfishAnalysisProvider,
  StockfishMoveProvider,
  StockfishPrincipalVariation,
  StockfishScore,
  StockfishUciTransport,
} from './stockfish-uci.js'

export type GameKind = 'tictactoe' | 'connect4' | 'chess'
export type GameSide = 'human' | 'agent'
export type GameDifficulty = 'casual' | 'balanced' | 'strong'
export type GameStatus = 'playing' | 'won' | 'draw'

export interface GameOptions {
  difficulty?: GameDifficulty
  humanSide?: string
  humanStarts?: boolean
  chessMoveProvider?: StockfishMoveProvider
  chessAnalysisProvider?: StockfishAnalysisProvider
}

export interface ChessEvaluation {
  type: StockfishScore['type']
  /** Centipawns or mate distance, always from White's point of view. */
  value: number
  perspective: 'white'
}

export interface ChessAnalysisSnapshot {
  depth: number
  evaluation: ChessEvaluation
  lines: Array<{ rank: number; evaluation: ChessEvaluation; moves: string[] }>
  playedRank: number
  forcedMateWithinThree: boolean
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
  chessAnalysis?: ChessAnalysisSnapshot
  board: unknown
}

export interface GameController {
  readonly kind: GameKind
  snapshot(): GameSnapshot
  legalMoves(): string[]
  applyMove(move: string, actor: GameSide): GameSnapshot
  bestMove(): string | null | Promise<string | null>
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
const CONNECT_WINDOWS: readonly (readonly number[])[] = (() => {
  const windows: number[][] = []
  for (let row = 0; row < CONNECT_ROWS; row++) {
    for (let column = 0; column < CONNECT_COLUMNS; column++) {
      if (column <= CONNECT_COLUMNS - 4) windows.push([0, 1, 2, 3].map((offset) => row * CONNECT_COLUMNS + column + offset))
      if (row <= CONNECT_ROWS - 4) windows.push([0, 1, 2, 3].map((offset) => (row + offset) * CONNECT_COLUMNS + column))
      if (row <= CONNECT_ROWS - 4 && column <= CONNECT_COLUMNS - 4) windows.push([0, 1, 2, 3].map((offset) => (row + offset) * CONNECT_COLUMNS + column + offset))
      if (row >= 3 && column <= CONNECT_COLUMNS - 4) windows.push([0, 1, 2, 3].map((offset) => (row - offset) * CONNECT_COLUMNS + column + offset))
    }
  }
  return windows
})()

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
    for (const window of CONNECT_WINDOWS) score += this.scoreWindow(window)
    return score
  }

  private scoreWindow(window: readonly number[]): number {
    let agent = 0
    let human = 0
    let empty = 0
    for (const index of window) {
      const cell = this.cells[index]
      if (cell === 'agent') agent++
      else if (cell === 'human') human++
      else empty++
    }
    if (agent === 4) return 100000
    if (human === 4) return -100000
    if (agent === 3 && empty === 1) return 50
    if (agent === 2 && empty === 2) return 8
    if (human === 3 && empty === 1) return -60
    if (human === 2 && empty === 2) return -10
    return 0
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
type ChessSquareMove = { from: string; to: string }

class ChessController implements GameController {
  readonly kind = 'chess' as const
  private readonly difficulty: GameDifficulty
  private readonly humanSide: ChessSide
  private readonly game: Chess
  private moves: string[] = []
  private lastMove: string | null = null
  private lastMoveSquares: ChessSquareMove | null = null
  private readonly chessMoveProvider?: StockfishMoveProvider
  private readonly chessAnalysisProvider?: StockfishAnalysisProvider
  private chessAnalysis: ChessAnalysisSnapshot | undefined

  constructor(options?: GameOptions) {
    this.difficulty = difficultyOf(options)
    this.humanSide = options?.humanSide === 'b' ? 'b' : 'w'
    this.chessMoveProvider = options?.chessMoveProvider
    this.chessAnalysisProvider = options?.chessAnalysisProvider
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
      engine: 'Stockfish 19 Lite · MultiPV third choice',
      difficulty: this.difficulty,
      humanSide: this.humanSide,
      turn: gameOver ? null : this.game.turn() === this.humanSide ? 'human' : 'agent',
      status: winner ? 'won' : gameOver ? 'draw' : 'playing',
      winner,
      moveCount: this.moves.length,
      moves: [...this.moves],
      legalMoves: this.legalMoves(),
      lastMove: this.lastMove,
      ...(this.chessAnalysis ? { chessAnalysis: structuredClone(this.chessAnalysis) } : {}),
      board: {
        fen: this.game.fen(),
        check: this.game.inCheck(),
        cells: this.game.board().map((row) => row.map((piece) => piece ? { type: piece.type, color: piece.color } : null)),
        legalMoves: this.game.moves({ verbose: true }).map((move) => ({ from: move.from, to: move.to })),
        lastMove: this.lastMoveSquares,
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
    this.lastMoveSquares = { from: applied.from, to: applied.to }
    return this.snapshot()
  }

  async bestMove(): Promise<string | null> {
    if (this.game.isGameOver() || (this.game.turn() === this.humanSide ? 'human' : 'agent') !== 'agent') return null
    if (!this.chessMoveProvider && !this.chessAnalysisProvider) throw new Error('Stockfish is not configured for this runtime.')
    const legalMoves = this.game.moves({ verbose: true })
    const moveTimeMs = this.difficulty === 'casual' ? 100 : this.difficulty === 'strong' ? 360 : 180
    const fen = this.game.fen()
    const rootSide = this.game.turn()
    const analysis = this.chessAnalysisProvider
      ? await this.chessAnalysisProvider(fen, { multiPv: 3, moveTimeMs, stopOnMateIn: 3 })
      : null
    const rankedUciMoves = analysis
      ? analysis.lines.map((line) => line.moves[0]).filter((move): move is string => !!move)
      : await this.chessMoveProvider!(fen, { multiPv: 3, moveTimeMs, stopOnMateIn: 3 })
    const rankedLegalMoves = rankedUciMoves.flatMap((uciMove) => {
      const match = String(uciMove).match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/)
      if (!match) return []
      const legalMove = legalMoves.find((move) =>
        move.from === match[1] && move.to === match[2] && (move.promotion || undefined) === (match[3] || undefined),
      )
      return legalMove ? [legalMove] : []
    })
    if (!rankedLegalMoves.length) throw new Error('Stockfish did not return a legal move for this position.')
    const rankOne = analysis?.lines.find((line) => line.rank === 1)
    const urgentMate = rankOne?.score.type === 'mate' && Math.abs(rankOne.score.value) <= 3
    if (analysis && urgentMate) {
      const forcedMove = rankOne.moves[0]
      const match = forcedMove?.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/)
      const matingMove = match && legalMoves.find((move) =>
        move.from === match[1] && move.to === match[2] && (move.promotion || undefined) === (match[3] || undefined),
      )
      if (matingMove) {
        this.chessAnalysis = createChessAnalysisSnapshot(analysis, fen, rootSide, forcedMove)
        return matingMove.san
      }
    }
    if (!analysis && legalMoves.length >= 3 && rankedLegalMoves.length < 3) {
      throw new Error('Stockfish did not return three distinct ranked moves for this position.')
    }
    const thirdLineIndex = analysis?.lines.findIndex((line) => line.rank === 3) ?? -1
    const selectedIndex = analysis ? Math.max(0, thirdLineIndex) : Math.min(2, rankedLegalMoves.length - 1)
    const selectedMove = rankedLegalMoves[selectedIndex] ?? rankedLegalMoves[0]
    if (analysis && selectedMove) {
      this.chessAnalysis = createChessAnalysisSnapshot(analysis, fen, rootSide, analysis.lines[selectedIndex]?.moves[0])
    }
    return selectedMove?.san ?? null
  }
}

function scoreForWhite(score: StockfishScore, rootSide: ChessSide): ChessEvaluation {
  return { type: score.type, value: rootSide === 'w' ? score.value : -score.value, perspective: 'white' }
}

function variationToSan(fen: string, uciMoves: string[]): string[] {
  const position = new Chess(fen)
  const moves: string[] = []
  for (const uci of uciMoves) {
    const match = uci.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/)
    if (!match) break
    try {
      moves.push(position.move({ from: match[1], to: match[2], promotion: match[3] }).san)
    } catch {
      break
    }
  }
  return moves
}

function createChessAnalysisSnapshot(
  analysis: StockfishAnalysis,
  fen: string,
  rootSide: ChessSide,
  selectedUci: string | undefined,
): ChessAnalysisSnapshot {
  const lines = analysis.lines.map((line) => ({
    rank: line.rank,
    evaluation: scoreForWhite(line.score, rootSide),
    moves: variationToSan(fen, line.moves),
  }))
  const bestLine = analysis.lines.find((line) => line.rank === 1) ?? analysis.lines[0]
  return {
    depth: analysis.depth,
    evaluation: bestLine ? scoreForWhite(bestLine.score, rootSide) : { type: 'cp', value: 0, perspective: 'white' },
    lines,
    playedRank: analysis.lines.find((line) => line.moves[0] === selectedUci)?.rank ?? 1,
    forcedMateWithinThree: !!bestLine && bestLine.score.type === 'mate' && bestLine.score.value > 0 && bestLine.score.value <= 3,
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
