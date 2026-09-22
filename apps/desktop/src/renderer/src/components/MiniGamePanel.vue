<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhCpu, PhGameController, PhUser, PhX } from '@phosphor-icons/vue'
import type { GameSnapshot } from '@syntax-senpai/game-engine'

const props = withDefaults(defineProps<{
  snapshot: GameSnapshot | null
  busy?: boolean
  windowMode?: boolean
}>(), {
  busy: false,
  windowMode: false,
})

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

const chessPieceLabel = (piece: ChessPiece) => piece ? piece.type.toUpperCase() : ''

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
  <Transition name="game-panel">
    <section
      v-if="snapshot"
      class="overflow-hidden text-white"
      :class="windowMode
        ? 'mx-auto min-h-[100dvh] w-full max-w-5xl bg-slate-950'
        : 'fixed bottom-5 right-5 z-[70] w-[min(92vw,28rem)] rounded-2xl border border-cyan-400/20 bg-slate-950/95 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl'"
      aria-label="Minigame panel"
    >
      <header class="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div class="flex min-w-0 items-center gap-2">
          <PhGameController :size="20" weight="duotone" class="shrink-0 text-cyan-300" aria-hidden="true" />
          <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold">{{ title }}</h2>
            <p class="truncate text-[11px] text-slate-400">{{ snapshot.engine }}</p>
          </div>
        </div>
        <button
          type="button"
          class="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close minigame"
          title="Close minigame"
          @click="emit('close')"
        >
          <PhX :size="18" aria-hidden="true" />
        </button>
      </header>

      <div class="space-y-5 p-4 sm:p-6">
        <div class="flex items-center justify-between text-xs">
          <span class="flex items-center gap-1.5 text-slate-300">
            <PhUser v-if="snapshot.turn === 'human'" :size="15" aria-hidden="true" />
            <PhCpu v-else :size="15" aria-hidden="true" />
            {{ turnLabel }}
          </span>
          <span class="text-slate-500">Move {{ snapshot.moveCount }}</span>
        </div>

        <div v-if="snapshot.kind === 'tictactoe'" class="mx-auto grid w-[min(70vw,24rem)] grid-cols-3 gap-3">
          <button
            v-for="(cell, index) in ticTacToeCells"
            :key="index"
            type="button"
            class="aspect-square rounded-2xl border border-white/10 bg-white/[0.04] text-4xl font-semibold transition hover:border-cyan-300/60 hover:bg-cyan-300/10 disabled:cursor-default disabled:hover:border-white/10 disabled:hover:bg-white/[0.04] sm:text-5xl"
            :class="cell === 'human' ? 'text-cyan-300' : cell === 'agent' ? 'text-fuchsia-300' : 'text-transparent'"
            :disabled="cell !== 'empty' || !canMove()"
            :aria-label="`Tic-Tac-Toe square ${index + 1}${cell !== 'empty' ? `, ${cell}` : ''}`"
            @click="emitMove(String(index))"
          >
            {{ cell === 'human' ? 'X' : cell === 'agent' ? 'O' : '·' }}
          </button>
        </div>

        <div v-else-if="snapshot.kind === 'connect4'" class="mx-auto w-full max-w-[34rem]">
          <div class="mb-2 grid grid-cols-7 gap-1" aria-label="Connect Four columns">
            <button
              v-for="column in 7"
              :key="column"
              type="button"
              class="rounded-md py-1 text-xs text-slate-400 transition hover:bg-cyan-300/10 hover:text-cyan-200 disabled:cursor-default disabled:opacity-40"
              :class="connectColumnOpen(column - 1) && canMove() ? 'bg-white/[0.03]' : ''"
              :disabled="!connectColumnOpen(column - 1) || !canMove()"
              :aria-label="`Drop in column ${column}`"
              @click="emitConnectMove(column - 1)"
            >
              <span class="sr-only">Drop in </span>{{ column }}
            </button>
          </div>
          <div class="grid grid-cols-7 gap-2 rounded-2xl border border-cyan-300/20 bg-blue-950/70 p-3 sm:gap-3 sm:p-4" aria-label="Connect Four board">
            <template v-for="(row, rowIndex) in connectBoard" :key="rowIndex">
              <button
                v-for="(cell, columnIndex) in row"
                :key="`${rowIndex}-${columnIndex}`"
                type="button"
                class="group relative aspect-square rounded-full border border-white/10 shadow-inner transition-transform hover:scale-105 disabled:cursor-default disabled:hover:scale-100"
                :class="cell === 'human' ? 'bg-red-400 shadow-red-300/30' : cell === 'agent' ? 'bg-yellow-300 shadow-yellow-200/30' : 'bg-slate-900/80'"
                :disabled="!connectColumnOpen(columnIndex) || !canMove()"
                :aria-label="`Row ${rowIndex + 1}, column ${columnIndex + 1}`"
                @click="emitConnectMove(columnIndex)"
              >
                <span
                  v-if="cell === 'empty' && connectColumnOpen(columnIndex) && canMove()"
                  class="pointer-events-none absolute inset-1 rounded-full border border-dashed border-cyan-200/50 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                />
              </button>
            </template>
          </div>
          <div class="mt-3 flex justify-center gap-5 text-[11px] text-slate-400">
            <span class="flex items-center gap-1.5"><i class="h-2.5 w-2.5 rounded-full bg-red-400" aria-hidden="true" />You</span>
            <span class="flex items-center gap-1.5"><i class="h-2.5 w-2.5 rounded-full bg-yellow-300" aria-hidden="true" />Agent</span>
          </div>
        </div>

        <div v-else class="mx-auto w-full max-w-[34rem] overflow-hidden rounded-2xl border border-white/10">
          <div class="grid grid-cols-8">
            <button
              v-for="cell in chessCells"
              :key="cell.square"
              type="button"
              class="relative flex aspect-square items-center justify-center text-2xl font-bold transition-colors sm:text-3xl"
              :class="[
                cell.dark ? 'bg-emerald-950/80' : 'bg-emerald-100/90 text-slate-900',
                selectedSquare === cell.square ? 'ring-2 ring-inset ring-cyan-300' : '',
                chessLegalTargets.has(cell.square) ? 'after:absolute after:h-3 after:w-3 after:rounded-full after:bg-cyan-300/80' : '',
                cell.last ? 'shadow-[inset_0_0_0_999px_rgba(34,211,238,0.15)]' : '',
                canMove() ? 'hover:bg-cyan-300/40' : 'cursor-default',
              ]"
              :disabled="!canMove()"
              :aria-label="`${cell.square}${cell.piece ? `, ${cell.piece.color === 'w' ? 'white' : 'black'} ${cell.piece.type}` : ', empty'}`"
              @click="chooseChessSquare(cell.square)"
            >
              <span
                v-if="cell.piece"
                class="relative z-[1] flex h-[72%] w-[72%] items-center justify-center rounded-full border-2"
                :class="cell.piece.color === 'w'
                  ? 'border-white/80 bg-slate-100 text-slate-900 shadow-[0_2px_5px_rgba(0,0,0,0.45)]'
                  : 'border-slate-700 bg-slate-900 text-white shadow-[0_2px_5px_rgba(0,0,0,0.65)]'"
              >
                <svg viewBox="0 0 40 40" class="h-full w-full p-1.5" aria-hidden="true">
                  <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35" />
                  <text x="20" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">{{ chessPieceLabel(cell.piece) }}</text>
                </svg>
              </span>
              <span v-if="cell.displayColumn === 0" class="pointer-events-none absolute left-1 top-0.5 text-[9px] font-medium opacity-60">{{ cell.rank }}</span>
              <span v-if="cell.displayRow === 7" class="pointer-events-none absolute bottom-0.5 right-1 text-[9px] font-medium opacity-60">{{ cell.file }}</span>
            </button>
          </div>
          <p class="border-t border-white/10 bg-white/[0.03] px-3 py-2 text-center text-[11px] text-slate-400">
            Select one of your pieces, then select a highlighted destination.
          </p>
        </div>

        <div class="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400">
          <span v-if="snapshot.status === 'playing'">
            {{ snapshot.kind === 'chess' ? `You play ${snapshot.humanSide === 'w' ? 'White' : 'Black'}` : snapshot.kind === 'connect4' ? 'You are Red' : 'You are the cyan side' }}
          </span>
          <span v-else-if="snapshot.status === 'draw'">Draw</span>
          <span v-else>{{ snapshot.winner === 'human' ? 'You win' : 'Agent wins' }}</span>
          <span v-if="busy" class="text-cyan-300">Updating chat…</span>
          <span v-else-if="snapshot.lastMove" class="font-mono text-slate-500">{{ snapshot.lastMove }}</span>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.game-panel-enter-active,
.game-panel-leave-active {
  transition: transform 240ms ease, opacity 180ms ease;
}

.game-panel-enter-from,
.game-panel-leave-to {
  opacity: 0;
  transform: translateY(1.25rem) scale(0.98);
}
</style>
