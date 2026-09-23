<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhCpu, PhGameController, PhUser, PhX } from '@phosphor-icons/vue'
import type { GameSnapshot } from '@syntax-senpai/game-engine'
import bishopPiece from '../assets/chess-pieces/bishop.svg'
import kingPiece from '../assets/chess-pieces/king.svg'
import knightPiece from '../assets/chess-pieces/knight.svg'
import pawnPiece from '../assets/chess-pieces/pawn.svg'
import queenPiece from '../assets/chess-pieces/queen.svg'
import rookPiece from '../assets/chess-pieces/rook.svg'

const props = withDefaults(defineProps<{
  snapshot: GameSnapshot | null
  busy?: boolean
}>(), { busy: false })

const emit = defineEmits<{
  move: [move: string]
  close: []
}>()

type ConnectBoard = Array<Array<'empty' | 'human' | 'agent'>>
type ChessPiece = { type: string; color: 'w' | 'b' } | null
type ChessSquareMove = { from: string; to: string }
type ChessBoard = {
  cells: ChessPiece[][]
  check: boolean
  fen: string
  legalMoves?: ChessSquareMove[]
  lastMove?: ChessSquareMove | null
}

const selectedSquare = ref<string | null>(null)

const title = computed(() => {
  if (props.snapshot?.kind === 'tictactoe') return 'Tic-Tac-Toe'
  if (props.snapshot?.kind === 'connect4') return 'Connect Four'
  if (props.snapshot?.kind === 'chess') return 'Chess'
  return 'Minigame'
})

const turnLabel = computed(() => {
  if (!props.snapshot || props.snapshot.status !== 'playing') return 'Game over'
  return props.snapshot.turn === 'human' ? 'Your turn' : 'Agent is thinking'
})

const ticTacToeCells = computed(() => (props.snapshot?.board as string[] | undefined) ?? [])
const connectBoard = computed(() => (props.snapshot?.board as ConnectBoard | undefined) ?? [])
const chessAnalysis = computed(() => props.snapshot?.kind === 'chess' ? props.snapshot.chessAnalysis : undefined)
const whiteAdvantagePercent = computed(() => {
  const score = chessAnalysis.value?.evaluation
  if (!score) return 50
  if (score.type === 'mate') return score.value > 0 ? 99 : score.value < 0 ? 1 : 50
  return Math.max(2, Math.min(98, 100 / (1 + Math.exp(-score.value / 250))))
})
const chessEvaluationLabel = computed(() => {
  const score = chessAnalysis.value?.evaluation
  if (!score) return 'Stockfish evaluation pending'
  if (score.type === 'mate') {
    if (score.value === 0) return 'Checkmate'
    return `${score.value > 0 ? 'White' : 'Black'} mates in ${Math.abs(score.value)}`
  }
  const pawns = Math.abs(score.value / 100).toFixed(2)
  return score.value === 0 ? 'Equal position' : `${score.value > 0 ? 'White' : 'Black'} +${pawns}`
})

const chessCells = computed(() => {
  const board = props.snapshot?.board as ChessBoard | undefined
  if (!board?.cells) return []
  const rotate = props.snapshot?.humanSide === 'b'
  return Array.from({ length: 64 }, (_, index) => {
    const displayRow = Math.floor(index / 8)
    const displayColumn = index % 8
    const sourceRow = rotate ? 7 - displayRow : displayRow
    const sourceColumn = rotate ? 7 - displayColumn : displayColumn
    const file = String.fromCharCode(97 + sourceColumn)
    const rank = String(8 - sourceRow)
    return {
      square: `${file}${rank}`,
      piece: board.cells[sourceRow]?.[sourceColumn] ?? null,
      dark: (displayRow + displayColumn) % 2 === 1,
      displayRow,
      displayColumn,
      file,
      rank,
      last: board.lastMove?.from === `${file}${rank}` || board.lastMove?.to === `${file}${rank}`,
    }
  })
})

const chessPieceAssets: Record<string, string> = {
  b: bishopPiece,
  k: kingPiece,
  n: knightPiece,
  p: pawnPiece,
  q: queenPiece,
  r: rookPiece,
}

function chessPieceStyle(piece: ChessPiece) {
  return piece ? { '--chess-piece-mask': `url("${chessPieceAssets[piece.type]}")` } : undefined
}

const chessLegalTargets = computed(() => {
  const board = props.snapshot?.board as ChessBoard | undefined
  const selected = selectedSquare.value
  if (!selected) return new Set<string>()
  return new Set((board?.legalMoves ?? [])
    .filter((move) => move.from === selected)
    .map((move) => move.to))
})

function connectColumnOpen(column: number) {
  return connectBoard.value[0]?.[column] === 'empty'
}

function emitConnectMove(column: number) {
  if (connectColumnOpen(column)) emitMove(String(column))
}

function canMove() {
  return !!props.snapshot && props.snapshot.status === 'playing' && props.snapshot.turn === 'human' && !props.busy
}

function emitMove(move: string) {
  if (canMove()) emit('move', move)
}

function chooseChessSquare(square: string) {
  if (!canMove()) return
  const cell = chessCells.value.find((candidate) => candidate.square === square)
  const humanSide = props.snapshot?.humanSide

  if (!selectedSquare.value) {
    if (cell?.piece?.color === humanSide) selectedSquare.value = square
    return
  }

  if (cell?.piece?.color === humanSide) {
    selectedSquare.value = selectedSquare.value === square ? null : square
    return
  }

  if (!chessLegalTargets.value.has(square)) {
    selectedSquare.value = null
    return
  }

  if (selectedSquare.value === square) {
    selectedSquare.value = null
    return
  }
  const move = `${selectedSquare.value}${square}`
  selectedSquare.value = null
  emitMove(move)
}

watch(() => props.snapshot?.lastMove, () => {
  selectedSquare.value = null
})
</script>

<template>
  <section v-if="snapshot" class="mini-game-panel" aria-label="Minigame panel">
    <header class="mini-game-header">
      <div class="flex min-w-0 items-center gap-2">
        <PhGameController :size="20" weight="duotone" class="mini-game-icon shrink-0" aria-hidden="true" />
        <div class="min-w-0">
          <h2 class="truncate text-sm font-semibold">{{ title }}</h2>
          <p class="mini-game-muted truncate text-[11px]">{{ snapshot.engine }}</p>
          <details v-if="snapshot.kind === 'chess'" class="stockfish-license">
            <summary>Stockfish license</summary>
            <div class="stockfish-license-copy">
              Stockfish.js 19.0.0 by Chess.com, LLC / Nathan Rugg, GPL-3.0. It is provided without warranty and may be redistributed under GPL-3.0.
              <a href="./stockfish/Copying.txt">Read the full license</a>
            </div>
          </details>
        </div>
      </div>
      <button type="button" class="mini-game-close" aria-label="Close minigame" title="Close minigame" @click="emit('close')">
        <PhX :size="18" aria-hidden="true" />
      </button>
    </header>

    <div class="mini-game-content">
      <div class="mini-game-meta" role="status" aria-live="polite">
        <span class="flex items-center gap-1.5">
          <PhUser v-if="snapshot.turn === 'human'" :size="15" aria-hidden="true" />
          <PhCpu v-else :size="15" aria-hidden="true" />
          {{ turnLabel }}
        </span>
        <span>Move {{ snapshot.moveCount }}</span>
      </div>

      <div v-if="snapshot.kind === 'tictactoe'" class="mini-game-tictactoe">
        <button
          v-for="(cell, index) in ticTacToeCells"
          :key="index"
          type="button"
          class="mini-game-tic-cell"
          :class="cell === 'human' ? 'mini-game-human' : cell === 'agent' ? 'mini-game-agent' : ''"
          :disabled="cell !== 'empty' || !canMove()"
          :aria-label="`Tic-Tac-Toe square ${index + 1}${cell !== 'empty' ? `, ${cell}` : ''}`"
          @click="emitMove(String(index))"
        >
          {{ cell === 'human' ? 'X' : cell === 'agent' ? 'O' : '·' }}
        </button>
      </div>

      <div v-else-if="snapshot.kind === 'connect4'" class="mini-game-board-wrap">
        <div class="mini-game-columns">
          <button
            v-for="column in 7"
            :key="column"
            type="button"
            class="mini-game-column"
            :disabled="!connectBoard[0]?.[column - 1] || connectBoard[0][column - 1] !== 'empty' || !canMove()"
            :aria-label="`Drop in column ${column}`"
            @click="emitConnectMove(column - 1)"
          >{{ column }}</button>
        </div>
        <div class="mini-game-connect-board">
          <template v-for="(row, rowIndex) in connectBoard" :key="rowIndex">
            <span
              v-for="(cell, columnIndex) in row"
              :key="`${rowIndex}-${columnIndex}`"
              class="mini-game-disc"
              :class="cell === 'human' ? 'mini-game-disc-human' : cell === 'agent' ? 'mini-game-disc-agent' : ''"
              :aria-label="`Row ${rowIndex + 1}, column ${columnIndex + 1}, ${cell}`"
            />
          </template>
        </div>
      </div>

      <div v-else class="mini-game-chess">
        <div class="mini-game-chess-position">
          <div class="mini-game-eval-rail" role="img" :aria-label="`Stockfish evaluation: ${chessEvaluationLabel}`">
            <div class="mini-game-eval-black" :style="{ height: `${100 - whiteAdvantagePercent}%` }" />
            <div class="mini-game-eval-white" :style="{ height: `${whiteAdvantagePercent}%` }" />
          </div>
          <div class="grid min-w-0 flex-1 grid-cols-8">
            <button
              v-for="cell in chessCells"
              :key="cell.square"
              type="button"
              class="mini-game-chess-cell"
              :class="[cell.dark ? 'mini-game-chess-dark' : 'mini-game-chess-light', selectedSquare === cell.square ? 'mini-game-chess-selected' : '', chessLegalTargets.has(cell.square) ? 'mini-game-chess-target' : '', cell.last ? 'mini-game-chess-last' : '']"
              :disabled="!canMove()"
              :aria-label="`${cell.square}${cell.piece ? `, ${cell.piece.color === 'w' ? 'white' : 'black'} ${cell.piece.type}` : ', empty'}`"
              :aria-pressed="selectedSquare === cell.square"
              @click="chooseChessSquare(cell.square)"
            >
              <span
                v-if="cell.piece"
                class="mini-game-piece"
                :class="cell.piece.color === 'w' ? 'mini-game-piece-white' : 'mini-game-piece-black'"
                :style="chessPieceStyle(cell.piece)"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
        <div class="mini-game-chess-evaluation" role="status" aria-live="polite">
          <span>{{ chessEvaluationLabel }}</span>
          <span v-if="chessAnalysis">Depth {{ chessAnalysis.depth }} · AI played MultiPV #{{ chessAnalysis.playedRank }}</span>
          <span v-if="chessAnalysis?.forcedMateWithinThree" class="mini-game-mate-found">Forced mate found — played immediately</span>
        </div>
      </div>

      <div class="mini-game-footer" role="status" aria-live="polite">
        <span v-if="snapshot.status === 'playing'">
          {{ snapshot.kind === 'chess' ? `You play ${snapshot.humanSide === 'w' ? 'White' : 'Black'}` : 'You are the primary-color side' }}
        </span>
        <span v-else-if="snapshot.status === 'draw'">Draw</span>
        <span v-else>{{ snapshot.winner === 'human' ? 'You win' : 'Agent wins' }}</span>
        <span v-if="busy" class="mini-game-icon">Updating chat…</span>
        <span v-else-if="snapshot.lastMove" class="font-mono">{{ snapshot.lastMove }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mini-game-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: var(--fg);
  background: var(--surface);
}

.mini-game-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--primary) 22%, transparent);
}

.mini-game-icon,
.mini-game-human { color: var(--primary); }
.mini-game-agent { color: var(--accent); }
.mini-game-muted,
.mini-game-meta,
.mini-game-footer { color: color-mix(in srgb, var(--fg) 65%, transparent); }

.stockfish-license { margin-top: 0.15rem; font-size: 0.62rem; }
.stockfish-license summary { cursor: pointer; color: color-mix(in srgb, var(--fg) 54%, transparent); }
.stockfish-license-copy { max-width: 24rem; margin-top: 0.35rem; color: color-mix(in srgb, var(--fg) 74%, transparent); line-height: 1.45; }
.stockfish-license-copy a { margin-left: 0.25rem; color: var(--primary); text-decoration: underline; }

.mini-game-close,
.mini-game-column {
  border-radius: calc(0.5rem * var(--radius-scale, 1));
  color: inherit;
  transition: background-color 160ms ease, color 160ms ease;
}

.mini-game-close { padding: 0.35rem; }
.mini-game-close:hover,
.mini-game-column:hover:not(:disabled) {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--fg);
}

.mini-game-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-height: 0;
  overflow: auto;
  padding: calc(1rem * var(--ui-density-scale, 1));
}

.mini-game-meta,
.mini-game-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.mini-game-tictactoe {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  width: 100%;
  max-width: 24rem;
  margin-inline: auto;
}

.mini-game-tic-cell {
  aspect-ratio: 1;
  border: 1px solid color-mix(in srgb, var(--primary) 24%, transparent);
  border-radius: calc(1rem * var(--radius-scale, 1));
  background: color-mix(in srgb, var(--surface-2) 92%, var(--primary) 8%);
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 600;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.mini-game-tic-cell:hover:not(:disabled) {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--surface-2) 78%, var(--primary) 22%);
}

.mini-game-tic-cell:disabled { cursor: default; }
.mini-game-tic-cell:not(.mini-game-human):not(.mini-game-agent) { color: color-mix(in srgb, var(--fg) 30%, transparent); }
.mini-game-board-wrap,
.mini-game-chess { width: 100%; max-width: 34rem; margin-inline: auto; }

.mini-game-columns,
.mini-game-connect-board { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.mini-game-columns { gap: 0.25rem; margin-bottom: 0.5rem; }
.mini-game-column { padding: 0.35rem 0; font-size: 0.75rem; }
.mini-game-column:disabled { opacity: 0.45; cursor: default; }
.mini-game-connect-board {
  gap: clamp(0.25rem, 0.6vw, 0.65rem);
  padding: clamp(0.45rem, 1vw, 0.85rem);
  border: 1px solid color-mix(in srgb, var(--primary) 26%, transparent);
  border-radius: calc(1rem * var(--radius-scale, 1));
  background: color-mix(in srgb, var(--surface-2) 84%, var(--primary) 16%);
}

.mini-game-disc {
  aspect-ratio: 1;
  border: 1px solid color-mix(in srgb, var(--fg) 18%, transparent);
  border-radius: 50%;
  background: var(--surface-2);
  box-shadow: inset 0 2px 5px color-mix(in srgb, var(--bg) 48%, transparent);
}
.mini-game-disc-human { background: var(--primary); }
.mini-game-disc-agent { background: var(--accent); }

.mini-game-chess {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--primary) 28%, transparent);
  border-radius: calc(1rem * var(--radius-scale, 1));
}

.mini-game-chess-position { display: flex; align-items: stretch; gap: 0.4rem; }
.mini-game-eval-rail {
  display: flex;
  flex: none;
  width: 0.7rem;
  min-height: 8rem;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--fg) 30%, transparent);
  border-radius: 0.2rem;
  background: #12201c;
}
.mini-game-eval-black { background: #14211e; transition: height 180ms ease; }
.mini-game-eval-white { margin-top: auto; background: #f5f1e6; transition: height 180ms ease; }
.mini-game-chess-evaluation {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.25rem 0.75rem;
  padding: 0.45rem 0.65rem;
  color: color-mix(in srgb, var(--fg) 76%, transparent);
  font-size: 0.7rem;
}
.mini-game-mate-found { color: var(--primary); }

.mini-game-chess-cell {
  position: relative;
  display: flex;
  aspect-ratio: 1;
  align-items: center;
  justify-content: center;
  font-size: clamp(1.1rem, 2.7vw, 2rem);
  font-weight: 700;
  transition: background-color 160ms ease;
}
.mini-game-chess-light { background: color-mix(in srgb, var(--surface) 55%, var(--primary) 45%); }
.mini-game-chess-dark { background: color-mix(in srgb, var(--surface-2) 72%, var(--accent) 28%); }
.mini-game-chess-cell:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 65%, var(--surface) 35%); }
.mini-game-chess-cell:disabled { cursor: default; }
.mini-game-chess-selected { box-shadow: inset 0 0 0 3px var(--primary); }
.mini-game-chess-target::after {
  content: '';
  position: absolute;
  inset: 36%;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 70%, transparent);
  pointer-events: none;
}
.mini-game-chess-last { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 75%, transparent); }
.mini-game-piece {
  display: block;
  width: 72%;
  height: 76%;
  aspect-ratio: 1;
  -webkit-mask: var(--chess-piece-mask) center / contain no-repeat;
  mask: var(--chess-piece-mask) center / contain no-repeat;
}
.mini-game-piece-white {
  background: #f5f1e6;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 1px rgba(0, 0, 0, 0.65));
}
.mini-game-piece-black {
  background: #123128;
  filter: drop-shadow(0 1px 1px rgba(255, 255, 255, 0.9)) drop-shadow(0 0 1px rgba(255, 255, 255, 0.7));
}

.mini-game-footer {
  padding: 0.6rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
  border-radius: calc(0.65rem * var(--radius-scale, 1));
  background: var(--surface-2);
}

.mini-game-panel button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}

:global([data-motion='reduced']) .mini-game-panel button {
  transition: none;
}
</style>
