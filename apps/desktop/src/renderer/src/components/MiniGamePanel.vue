<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhCpu, PhGameController, PhUser, PhX } from '@phosphor-icons/vue'
import type { GameSnapshot } from '@syntax-senpai/game-engine'

const props = withDefaults(defineProps<{
  snapshot: GameSnapshot | null
  busy?: boolean
}>(), {
  busy: false,
})

const emit = defineEmits<{
  move: [move: string]
  close: []
}>()

type ConnectBoard = Array<Array<'empty' | 'human' | 'agent'>>
type ChessPiece = { type: string; color: 'w' | 'b' } | null
type ChessBoard = { cells: ChessPiece[][]; check: boolean; fen: string }

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
    }
  })
})

const chessPieceLabel = (piece: ChessPiece) => piece ? piece.type.toUpperCase() : ''

function canMove() {
  return !!props.snapshot && props.snapshot.status === 'playing' && props.snapshot.turn === 'human' && !props.busy
}

function emitMove(move: string) {
  if (canMove()) emit('move', move)
}

function chooseChessSquare(square: string) {
  if (!canMove()) return
  if (!selectedSquare.value) {
    selectedSquare.value = square
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
      class="fixed bottom-5 right-5 z-[70] w-[min(92vw,28rem)] overflow-hidden rounded-2xl border border-cyan-400/20 bg-slate-950/95 text-white shadow-2xl shadow-cyan-950/30 backdrop-blur-xl"
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

      <div class="space-y-3 p-4">
        <div class="flex items-center justify-between text-xs">
          <span class="flex items-center gap-1.5 text-slate-300">
            <PhUser v-if="snapshot.turn === 'human'" :size="15" aria-hidden="true" />
            <PhCpu v-else :size="15" aria-hidden="true" />
            {{ turnLabel }}
          </span>
          <span class="text-slate-500">Move {{ snapshot.moveCount }}</span>
        </div>

        <div v-if="snapshot.kind === 'tictactoe'" class="mx-auto grid w-56 grid-cols-3 gap-2">
          <button
            v-for="(cell, index) in ticTacToeCells"
            :key="index"
            type="button"
            class="aspect-square rounded-xl border border-white/10 bg-white/[0.04] text-3xl font-semibold transition hover:border-cyan-300/60 hover:bg-cyan-300/10 disabled:cursor-default disabled:hover:border-white/10 disabled:hover:bg-white/[0.04]"
            :class="cell === 'human' ? 'text-cyan-300' : cell === 'agent' ? 'text-fuchsia-300' : 'text-transparent'"
            :disabled="cell !== 'empty' || !canMove()"
            :aria-label="`Tic-Tac-Toe square ${index + 1}${cell !== 'empty' ? `, ${cell}` : ''}`"
            @click="emitMove(String(index))"
          >
            {{ cell === 'human' ? 'X' : cell === 'agent' ? 'O' : '·' }}
          </button>
        </div>

        <div v-else-if="snapshot.kind === 'connect4'" class="mx-auto max-w-[19rem]">
          <div class="mb-2 grid grid-cols-7 gap-1">
            <button
              v-for="column in 7"
              :key="column"
              type="button"
              class="rounded-md py-1 text-xs text-slate-400 transition hover:bg-cyan-300/10 hover:text-cyan-200 disabled:cursor-default disabled:opacity-40"
              :disabled="!connectBoard[0]?.[column - 1] || connectBoard[0][column - 1] !== 'empty' || !canMove()"
              :aria-label="`Drop in column ${column}`"
              @click="emitMove(String(column - 1))"
            >
              {{ column }}
            </button>
          </div>
          <div class="grid grid-cols-7 gap-1 rounded-xl border border-cyan-300/20 bg-blue-950/70 p-2">
            <template v-for="(row, rowIndex) in connectBoard" :key="rowIndex">
              <span
                v-for="(cell, columnIndex) in row"
                :key="`${rowIndex}-${columnIndex}`"
                class="aspect-square rounded-full border border-white/10 shadow-inner"
                :class="cell === 'human' ? 'bg-red-400 shadow-red-300/30' : cell === 'agent' ? 'bg-yellow-300 shadow-yellow-200/30' : 'bg-slate-900/80'"
                :aria-label="`Row ${rowIndex + 1}, column ${columnIndex + 1}`"
              />
            </template>
          </div>
        </div>

        <div v-else class="mx-auto w-full max-w-[22rem] overflow-hidden rounded-xl border border-white/10">
          <div class="grid grid-cols-8">
            <button
              v-for="cell in chessCells"
              :key="cell.square"
              type="button"
              class="relative flex aspect-square items-center justify-center text-lg font-bold transition-colors sm:text-xl"
              :class="[
                cell.dark ? 'bg-emerald-950/80' : 'bg-emerald-100/90 text-slate-900',
                selectedSquare === cell.square ? 'ring-2 ring-inset ring-cyan-300' : '',
                canMove() ? 'hover:bg-cyan-300/40' : 'cursor-default',
              ]"
              :disabled="!canMove()"
              :aria-label="`${cell.square}${cell.piece ? `, ${cell.piece.color === 'w' ? 'white' : 'black'} ${cell.piece.type}` : ', empty'}`"
              @click="chooseChessSquare(cell.square)"
            >
              <span :class="cell.piece?.color === 'w' ? 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]' : 'text-slate-950'">
                {{ chessPieceLabel(cell.piece) }}
              </span>
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400">
          <span v-if="snapshot.status === 'playing'">
            {{ snapshot.kind === 'chess' ? `You play ${snapshot.humanSide === 'w' ? 'White' : 'Black'}` : 'You are the cyan side' }}
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
