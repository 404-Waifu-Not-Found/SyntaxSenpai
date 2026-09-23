<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { WaifuCommunicationStyle, WaifuPersonalityTraits } from '@syntax-senpai/waifu-core'
import { useI18n } from '../composables/use-i18n'

type CellValue = 0 | 1 | 2
type Player = 1 | 2
type CommentaryKind = 'ready' | 'reset' | 'playerMove' | 'aiMove' | 'playerWin' | 'aiWin' | 'draw'
type BubbleSpeaker = 'waifu' | 'user' | 'system'

interface Coordinate {
  row: number
  col: number
}

interface MoveEntry extends Coordinate {
  turn: number
  player: Player
}

interface EvaluatedMove extends Coordinate {
  score: number
  attack: number
  defense: number
  adjacency: number
}

interface CommentaryBubble {
  id: number
  speaker: BubbleSpeaker
  text: string
}

const props = defineProps<{
  waifuDisplayName?: string | null
  backstory?: string | null
  systemPromptTemplate?: string | null
  catchphrases?: string[] | null
  tags?: string[] | null
  personality?: Partial<WaifuPersonalityTraits> | null
  communicationStyle?: Partial<WaifuCommunicationStyle> | null
  dialogueGenerator?: (gameState: string, recentReplies: string[]) => Promise<string>
}>()

const emit = defineEmits<{
  commentary: [message: string]
  close: []
}>()
const { t } = useI18n()

const BOARD_SIZE = 15
const CENTER_INDEX = Math.floor(BOARD_SIZE / 2)
const FILE_LABELS = Array.from({ length: BOARD_SIZE }, (_, index) => String.fromCharCode(65 + index))
const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

function createBoard(): CellValue[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0 as CellValue))
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
}

function formatCoordinate(row: number, col: number): string {
  return `${FILE_LABELS[col]}${row + 1}`
}

const board = ref<CellValue[][]>(createBoard())
const moveHistory = ref<MoveEntry[]>([])
const winner = ref<CellValue>(0)
const isDraw = ref(false)
const winningLine = ref<Coordinate[]>([])
const aiThinking = ref(false)
const generatingCommentary = ref(false)
const commentaryBubbles = ref<CommentaryBubble[]>([])
const commentaryScrollRef = ref<HTMLDivElement | null>(null)
let nextBubbleId = 0
let aiMoveTimer: ReturnType<typeof setTimeout> | null = null
let commentaryGeneration = 0
let commentaryQueue: Promise<void> = Promise.resolve()

const waifuName = computed(() => props.waifuDisplayName?.trim() || 'Waifu')

const gameOver = computed(() => winner.value !== 0 || isDraw.value)
const winningCellKeys = computed(() => new Set(winningLine.value.map((cell) => `${cell.row}:${cell.col}`)))
const currentTurnLabel = computed(() => {
  if (winner.value === 1) return t('gomoku.blackWins')
  if (winner.value === 2) return t('gomoku.whiteWins')
  if (isDraw.value) return t('gomoku.draw')
  if (aiThinking.value) return t('gomoku.thinking', { name: waifuName.value })
  if (generatingCommentary.value) return t('gomoku.organizing', { name: waifuName.value })
  return t('gomoku.yourTurn')
})

function resetBoardState() {
  board.value = createBoard()
  moveHistory.value = []
  winner.value = 0
  isDraw.value = false
  winningLine.value = []
  aiThinking.value = false
  generatingCommentary.value = false
  commentaryBubbles.value = []
  commentaryGeneration += 1
  commentaryQueue = Promise.resolve()
}

interface PatternSummary {
  stones: number
  longestLine: number
  openThrees: number
  openFours: number
  winningThreats: number
}

function summarizePatterns(player: Player): PatternSummary {
  let stones = 0
  let longestLine = 0
  let openThrees = 0
  let openFours = 0
  let winningThreats = 0

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board.value[row][col] !== player) continue
      stones += 1
      for (const [dr, dc] of DIRECTIONS) {
        const previousRow = row - dr
        const previousCol = col - dc
        if (inBounds(previousRow, previousCol) && board.value[previousRow][previousCol] === player) continue

        let length = 0
        let probeRow = row
        let probeCol = col
        while (inBounds(probeRow, probeCol) && board.value[probeRow][probeCol] === player) {
          length += 1
          probeRow += dr
          probeCol += dc
        }
        longestLine = Math.max(longestLine, length)
        const openEnds =
          Number(inBounds(previousRow, previousCol) && board.value[previousRow][previousCol] === 0) +
          Number(inBounds(probeRow, probeCol) && board.value[probeRow][probeCol] === 0)
        if (length === 3 && openEnds === 2) openThrees += 1
        if (length === 4 && openEnds === 2) openFours += 1
        if (length === 4 && openEnds >= 1) winningThreats += 1
      }
    }
  }
  return { stones, longestLine, openThrees, openFours, winningThreats }
}

function buildGameState(kind: CommentaryKind, move?: MoveEntry): string {
  const player = summarizePatterns(1)
  const agent = summarizePatterns(2)
  const turnOwner = gameOver.value ? 'game over' : aiThinking.value ? waifuName.value : 'user'
  const result = winner.value === 1
    ? 'user won'
    : winner.value === 2
      ? `${waifuName.value} won`
      : isDraw.value
        ? 'draw'
        : 'game continues'
  return [
    `Event: ${kind}`,
    `Completed moves: ${moveHistory.value.length}`,
    `Last move: ${move?.player === 1 ? 'user placed Black' : move?.player === 2 ? `${waifuName.value} placed White` : 'new game'}`,
    `Turn owner: ${turnOwner}`,
    `User (Black): ${player.stones} stones; longest connected line ${player.longestLine}; open threes ${player.openThrees}; open fours ${player.openFours}; immediate line threats ${player.winningThreats}`,
    `${waifuName.value} (White): ${agent.stones} stones; longest connected line ${agent.longestLine}; open threes ${agent.openThrees}; open fours ${agent.openFours}; immediate line threats ${agent.winningThreats}`,
    `Result: ${result}`,
    'Information boundary: no stone coordinates or move locations are recorded or supplied. Do not invent or mention any.',
  ].join('\n')
}

async function publishCommentary(kind: CommentaryKind, move?: MoveEntry): Promise<void> {
  const generation = commentaryGeneration
  const stateSnapshot = buildGameState(kind, move)
  commentaryQueue = commentaryQueue.then(async () => {
    if (generation !== commentaryGeneration) return
    generatingCommentary.value = true
    try {
      if (!props.dialogueGenerator) throw new Error('Game dialogue generator is not connected.')
      const recentReplies = commentaryBubbles.value
        .filter((bubble) => bubble.speaker === 'waifu')
        .slice(-6)
        .map((bubble) => bubble.text)
      const message = await props.dialogueGenerator(stateSnapshot, recentReplies)
      if (generation !== commentaryGeneration) return
      commentaryBubbles.value.push({ id: nextBubbleId++, speaker: 'waifu', text: message })
      if (commentaryBubbles.value.length > 12) commentaryBubbles.value.shift()
      emit('commentary', message)
    } catch (error) {
      if (generation !== commentaryGeneration) return
      const message = error instanceof Error ? error.message : String(error)
      commentaryBubbles.value.push({
        id: nextBubbleId++,
        speaker: 'system',
        text: t('games.dialogueError', { message }),
      })
    } finally {
      if (generation === commentaryGeneration) generatingCommentary.value = false
    }
  })
  await commentaryQueue
}

function clearAiTimer() {
  if (aiMoveTimer) {
    clearTimeout(aiMoveTimer)
    aiMoveTimer = null
  }
}

function resetGame() {
  clearAiTimer()
  resetBoardState()
  void publishCommentary('reset')
}

function hasNeighbor(row: number, col: number, radius = 2): boolean {
  for (let dr = -radius; dr <= radius; dr += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) {
      if (dr === 0 && dc === 0) continue
      const nextRow = row + dr
      const nextCol = col + dc
      if (inBounds(nextRow, nextCol) && board.value[nextRow][nextCol] !== 0) return true
    }
  }
  return false
}

function countAdjacent(row: number, col: number, radius = 2): number {
  let total = 0
  for (let dr = -radius; dr <= radius; dr += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) {
      if (dr === 0 && dc === 0) continue
      const nextRow = row + dr
      const nextCol = col + dc
      if (inBounds(nextRow, nextCol) && board.value[nextRow][nextCol] !== 0) total += 1
    }
  }
  return total
}

function patternScore(stones: number, openEnds: number): number {
  if (stones >= 5) return 1_000_000
  if (stones === 4 && openEnds === 2) return 180_000
  if (stones === 4 && openEnds === 1) return 45_000
  if (stones === 3 && openEnds === 2) return 12_000
  if (stones === 3 && openEnds === 1) return 2_500
  if (stones === 2 && openEnds === 2) return 750
  if (stones === 2 && openEnds === 1) return 120
  if (stones === 1 && openEnds === 2) return 36
  if (stones === 1 && openEnds === 1) return 8
  return 1
}

function evaluateMove(row: number, col: number, player: Player): number {
  let total = 0

  for (const [dr, dc] of DIRECTIONS) {
    let forwardCount = 0
    let backwardCount = 0
    let probeRow = row + dr
    let probeCol = col + dc

    while (inBounds(probeRow, probeCol) && board.value[probeRow][probeCol] === player) {
      forwardCount += 1
      probeRow += dr
      probeCol += dc
    }
    const forwardOpen = inBounds(probeRow, probeCol) && board.value[probeRow][probeCol] === 0

    probeRow = row - dr
    probeCol = col - dc
    while (inBounds(probeRow, probeCol) && board.value[probeRow][probeCol] === player) {
      backwardCount += 1
      probeRow -= dr
      probeCol -= dc
    }
    const backwardOpen = inBounds(probeRow, probeCol) && board.value[probeRow][probeCol] === 0

    total += patternScore(forwardCount + backwardCount + 1, Number(forwardOpen) + Number(backwardOpen))
  }

  return total
}

function centerBias(row: number, col: number): number {
  return (BOARD_SIZE * 2) - (Math.abs(row - CENTER_INDEX) + Math.abs(col - CENTER_INDEX))
}

function chooseAiMove(): Coordinate {
  if (moveHistory.value.length === 1 && board.value[CENTER_INDEX][CENTER_INDEX] === 0) {
    return { row: CENTER_INDEX, col: CENTER_INDEX }
  }

  let bestMove: EvaluatedMove | null = null

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board.value[row][col] !== 0) continue
      if (moveHistory.value.length > 0 && !hasNeighbor(row, col)) continue

      const attack = evaluateMove(row, col, 2)
      const defense = evaluateMove(row, col, 1)
      const adjacency = countAdjacent(row, col)
      let score = attack * 1.15 + defense * 1.05 + adjacency * 18 + centerBias(row, col)

      if (attack >= 1_000_000) score += 10_000_000
      if (defense >= 1_000_000) score += 9_000_000

      const candidate: EvaluatedMove = { row, col, score, attack, defense, adjacency }
      if (!bestMove || isBetterMove(candidate, bestMove)) bestMove = candidate
    }
  }

  if (bestMove) return { row: bestMove.row, col: bestMove.col }

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board.value[row][col] === 0) return { row, col }
    }
  }

  return { row: CENTER_INDEX, col: CENTER_INDEX }
}

function isBetterMove(candidate: EvaluatedMove, current: EvaluatedMove): boolean {
  if (candidate.score !== current.score) return candidate.score > current.score
  if (candidate.attack !== current.attack) return candidate.attack > current.attack
  if (candidate.defense !== current.defense) return candidate.defense > current.defense
  if (candidate.adjacency !== current.adjacency) return candidate.adjacency > current.adjacency

  const candidateDistance = Math.abs(candidate.row - CENTER_INDEX) + Math.abs(candidate.col - CENTER_INDEX)
  const currentDistance = Math.abs(current.row - CENTER_INDEX) + Math.abs(current.col - CENTER_INDEX)
  if (candidateDistance !== currentDistance) return candidateDistance < currentDistance
  if (candidate.row !== current.row) return candidate.row < current.row
  return candidate.col < current.col
}

function findWinningLine(row: number, col: number, player: Player): Coordinate[] | null {
  for (const [dr, dc] of DIRECTIONS) {
    const line: Coordinate[] = [{ row, col }]

    let probeRow = row + dr
    let probeCol = col + dc
    while (inBounds(probeRow, probeCol) && board.value[probeRow][probeCol] === player) {
      line.push({ row: probeRow, col: probeCol })
      probeRow += dr
      probeCol += dc
    }

    probeRow = row - dr
    probeCol = col - dc
    while (inBounds(probeRow, probeCol) && board.value[probeRow][probeCol] === player) {
      line.unshift({ row: probeRow, col: probeCol })
      probeRow -= dr
      probeCol -= dc
    }

    if (line.length >= 5) return line
  }

  return null
}

function finalizeMove(player: Player, row: number, col: number): boolean {
  const line = findWinningLine(row, col, player)
  if (line) {
    winner.value = player
    winningLine.value = line
    void publishCommentary(player === 1 ? 'playerWin' : 'aiWin', moveHistory.value[moveHistory.value.length - 1])
    return true
  }

  if (moveHistory.value.length >= BOARD_SIZE * BOARD_SIZE) {
    isDraw.value = true
    void publishCommentary('draw')
    return true
  }

  return false
}

function commitMove(row: number, col: number, player: Player): MoveEntry {
  board.value[row][col] = player
  const move: MoveEntry = {
    row,
    col,
    player,
    turn: moveHistory.value.length + 1,
  }
  moveHistory.value.push(move)
  return move
}

function runAiTurn() {
  aiThinking.value = false
  aiMoveTimer = null
  if (gameOver.value) return

  const choice = chooseAiMove()
  const move = commitMove(choice.row, choice.col, 2)
  if (!finalizeMove(2, choice.row, choice.col)) void publishCommentary('aiMove', move)
}

function playHumanMove(row: number, col: number) {
  if (aiThinking.value || generatingCommentary.value || gameOver.value || board.value[row][col] !== 0) return

  commitMove(row, col, 1)
  if (finalizeMove(1, row, col)) return

  aiThinking.value = true
  clearAiTimer()
  aiMoveTimer = setTimeout(() => runAiTurn(), 850)
}

function cellStoneClass(value: CellValue): string {
  if (value === 1) return 'gomoku-stone-black'
  if (value === 2) return 'gomoku-stone-white'
  return ''
}

function isLastMove(row: number, col: number): boolean {
  const lastMove = moveHistory.value[moveHistory.value.length - 1]
  return !!lastMove && lastMove.row === row && lastMove.col === col
}

function isWinningCell(row: number, col: number): boolean {
  return winningCellKeys.value.has(`${row}:${col}`)
}

onMounted(() => {
  resetBoardState()
  void publishCommentary('ready')
})

onBeforeUnmount(() => {
  clearAiTimer()
  commentaryGeneration += 1
})

watch(
  () => [commentaryBubbles.value.length, generatingCommentary.value] as const,
  async () => {
    await nextTick()
    commentaryScrollRef.value?.scrollTo({
      top: commentaryScrollRef.value.scrollHeight,
      behavior: 'smooth',
    })
  },
)
</script>

<template>
  <Teleport to="body">
    <section class="gomoku-panel fixed inset-0 z-[70] flex min-h-0 flex-col bg-[#090b12]/95 text-white backdrop-blur-2xl">
    <div class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-white/10 bg-black/20 px-5 py-4 sm:px-8">
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-lg font-semibold text-white">
          <span aria-hidden="true">⚫⚪</span>
          <span>{{ t('games.gomoku') }}</span>
          <span class="rounded-full bg-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-neutral-300">15 × 15</span>
        </div>
        <p class="mt-1 text-xs text-neutral-400 sm:text-sm">
          {{ t('gomoku.subtitle', { name: waifuName }) }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <div class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-neutral-200">
          {{ currentTurnLabel }}
        </div>
        <button
          type="button"
          class="btn-ghost px-3 py-1.5 text-xs"
          @click="resetGame"
        >
          {{ t('games.reset') }}
        </button>
        <button
          type="button"
          class="btn-ghost px-3 py-1.5 text-xs"
          :aria-label="t('games.close')"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 gap-5 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:p-8">
      <div class="flex min-h-0 min-w-0 flex-col">
        <div class="gomoku-board-stage flex min-h-[min(62vh,48rem)] flex-1 items-center justify-center overflow-auto rounded-3xl border border-white/10 p-3 sm:p-6">

          <div class="overflow-auto rounded-2xl border border-black/10 bg-gradient-to-br from-amber-200/95 via-amber-100/90 to-orange-200/85 p-3 shadow-2xl sm:p-5">
            <div class="gomoku-grid min-w-max">
            <div class="gomoku-axis-corner" />
            <div v-for="file in FILE_LABELS" :key="`col-${file}`" class="gomoku-axis-label">
              {{ file }}
            </div>

            <template v-for="rowIndex in BOARD_SIZE" :key="`row-${rowIndex}`">
              <div class="gomoku-axis-label">
                {{ rowIndex }}
              </div>
              <button
                v-for="colIndex in BOARD_SIZE"
                :key="`${rowIndex - 1}:${colIndex - 1}`"
                type="button"
                class="gomoku-cell"
                :class="{
                  'gomoku-cell-playable': !gameOver && !aiThinking && !generatingCommentary && board[rowIndex - 1][colIndex - 1] === 0,
                  'gomoku-cell-winning': isWinningCell(rowIndex - 1, colIndex - 1),
                  'gomoku-cell-last': isLastMove(rowIndex - 1, colIndex - 1),
                }"
                :disabled="gameOver || aiThinking || generatingCommentary || board[rowIndex - 1][colIndex - 1] !== 0"
                :aria-label="`${t('gomoku.yourTurn')}: ${formatCoordinate(rowIndex - 1, colIndex - 1)}`"
                @click="playHumanMove(rowIndex - 1, colIndex - 1)"
              >
                <span
                  v-if="board[rowIndex - 1][colIndex - 1] !== 0"
                  class="gomoku-stone"
                  :class="cellStoneClass(board[rowIndex - 1][colIndex - 1])"
                />
              </button>
            </template>
            </div>
          </div>
        </div>
      </div>

      <aside class="flex min-h-0 flex-col gap-4">
        <div class="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">{{ t('gomoku.liveChat') }}</div>
            <span class="text-[11px] text-neutral-500">{{ t('gomoku.personalityOutput') }}</span>
          </div>
          <div ref="commentaryScrollRef" class="min-h-40 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
            <div
              v-for="bubble in commentaryBubbles"
              :key="bubble.id"
              :class="['flex', bubble.speaker === 'user' ? 'justify-end' : 'justify-start']"
            >
              <div
                :class="[
                  'max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-lg',
                  bubble.speaker === 'user'
                    ? 'rounded-br-md bg-primary-500/25 text-primary-50'
                    : bubble.speaker === 'system'
                      ? 'rounded-bl-md bg-white/8 text-neutral-300'
                      : 'rounded-bl-md bg-violet-500/20 text-violet-50',
                ]"
              >
                <div v-if="bubble.speaker !== 'user'" class="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  {{ bubble.speaker === 'system' ? t('gomoku.game') : waifuName }}
                </div>
                {{ bubble.text }}
              </div>
            </div>
            <div v-if="generatingCommentary" class="flex justify-start">
              <div class="rounded-2xl rounded-bl-md bg-violet-500/15 px-3 py-2 text-sm text-violet-100">
                <span class="inline-flex items-center gap-1.5">
                  <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-300" />
                  {{ t('gomoku.organizing', { name: waifuName }) }}
                </span>
              </div>
            </div>
          </div>
        </div>

      </aside>
    </div>
    </section>
  </Teleport>
</template>

<style scoped>
.gomoku-panel {
  box-shadow: 0 22px 90px rgba(0, 0, 0, 0.55);
  animation: gomoku-panel-enter 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.gomoku-board-stage {
  background:
    radial-gradient(circle at 50% 35%, rgba(99, 102, 241, 0.16), transparent 52%),
    linear-gradient(145deg, rgba(30, 41, 59, 0.72), rgba(15, 23, 42, 0.92));
  animation: gomoku-board-enter 320ms cubic-bezier(0.16, 1, 0.3, 1) 70ms both;
}

.gomoku-panel aside {
  animation: gomoku-chat-enter 360ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both;
}

.gomoku-grid {
  --gomoku-cell-size: clamp(1.55rem, 3.6vw, 3.4rem);
  display: grid;
  grid-template-columns: repeat(16, var(--gomoku-cell-size));
  gap: 0.22rem;
  align-items: center;
}

.gomoku-axis-corner,
.gomoku-axis-label,
.gomoku-cell {
  width: var(--gomoku-cell-size);
  height: var(--gomoku-cell-size);
}

.gomoku-axis-corner {
  border-radius: 0.55rem;
}

.gomoku-axis-label {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(51, 24, 0, 0.72);
  user-select: none;
}

.gomoku-cell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(95, 52, 11, 0.16);
  border-radius: 0.55rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.08)),
    linear-gradient(135deg, rgba(249, 214, 135, 0.58), rgba(216, 153, 73, 0.58));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    inset 0 -1px 0 rgba(109, 63, 17, 0.15);
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
}

.gomoku-cell::after {
  content: '';
  position: absolute;
  width: 0.2rem;
  height: 0.2rem;
  border-radius: 999px;
  background: rgba(86, 45, 10, 0.18);
}

.gomoku-cell-playable:hover {
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.48);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    0 0 0 1px rgba(255, 255, 255, 0.16);
}

.gomoku-cell:disabled {
  cursor: default;
}

.gomoku-stone {
  position: relative;
  z-index: 1;
  width: 78%;
  height: 78%;
  border-radius: 999px;
  box-shadow:
    inset 0 1px 3px rgba(255, 255, 255, 0.18),
    0 8px 18px rgba(0, 0, 0, 0.25);
}

.gomoku-stone-black {
  background: radial-gradient(circle at 32% 28%, #4b5563 0%, #111827 38%, #020617 100%);
}

.gomoku-stone-white {
  background: radial-gradient(circle at 32% 28%, #ffffff 0%, #f8fafc 45%, #d4d4d8 100%);
  border: 1px solid rgba(15, 23, 42, 0.1);
}

.gomoku-cell-last .gomoku-stone::after {
  content: '';
  position: absolute;
  inset: 32%;
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.92);
  box-shadow: 0 0 0 1px rgba(120, 53, 15, 0.18);
}

.gomoku-cell-winning {
  border-color: rgba(34, 197, 94, 0.65);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    0 0 0 1px rgba(34, 197, 94, 0.25);
}

@keyframes gomoku-panel-enter {
  from {
    opacity: 0;
    backdrop-filter: blur(0);
  }
  to {
    opacity: 1;
    backdrop-filter: blur(24px);
  }
}

@keyframes gomoku-board-enter {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes gomoku-chat-enter {
  from {
    opacity: 0;
    transform: translateX(18px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .gomoku-panel,
  .gomoku-board-stage,
  .gomoku-panel aside {
    animation: none;
  }
}
</style>
