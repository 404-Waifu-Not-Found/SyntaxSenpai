<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useChatStore } from '../../stores/chat'
import { checkWinAt, chooseAiMove, createEmptyBoard, hasEmptyCell, type Cell, type Stone } from './gomoku-engine'

type SpeakerEvent = 'start' | 'user_move' | 'ai_move' | 'user_win' | 'ai_win' | 'draw'

const props = defineProps<{
  data: {
    title?: string
    board_size?: number
    user_stone?: Stone
    ai_stone?: Stone
    ai_name?: string
    opening_line?: string
  }
}>()

const chatStore = useChatStore()
const activeWaifu = computed(() => chatStore.selectedWaifu || chatStore.allWaifus[0])

const boardSize = computed(() => {
  const raw = Number(props.data.board_size)
  if (!Number.isFinite(raw)) return 15
  return Math.max(10, Math.min(19, Math.floor(raw)))
})

function normalizeStone(value: unknown): Stone | null {
  return value === 'black' || value === 'white' ? value : null
}

const userStone = computed<Stone>(() => {
  const explicitUser = normalizeStone(props.data.user_stone)
  const explicitAi = normalizeStone(props.data.ai_stone)
  if (explicitUser && explicitAi && explicitUser !== explicitAi) return explicitUser
  if (explicitUser) return explicitUser
  if (explicitAi) return explicitAi === 'black' ? 'white' : 'black'
  return 'black'
})

const aiStone = computed<Stone>(() => {
  const explicitAi = normalizeStone(props.data.ai_stone)
  if (explicitAi && explicitAi !== userStone.value) return explicitAi
  return userStone.value === 'black' ? 'white' : 'black'
})
const board = ref<Cell[]>([])
const currentTurn = ref<'user' | 'ai'>('user')
const gameOver = ref(false)
const winner = ref<'user' | 'ai' | 'draw' | null>(null)
const aiThinking = ref(false)
const dialogue = ref<string[]>([])
let aiMoveTimer: ReturnType<typeof setTimeout> | null = null

const aiName = computed(() => String(props.data.ai_name || activeWaifu.value?.displayName || 'AI').trim() || 'AI')
const title = computed(() => props.data.title || '五子棋 · Gomoku')
const boardStyle = computed(() => ({ gridTemplateColumns: `repeat(${boardSize.value}, minmax(0, 1fr))` }))
const aiStarts = computed(() => userStone.value === 'white')

const statusText = computed(() => {
  if (winner.value === 'user') return '你赢啦！'
  if (winner.value === 'ai') return `${aiName.value} 获胜`
  if (winner.value === 'draw') return '平局'
  if (aiThinking.value) return `${aiName.value} 思考中…`
  return currentTurn.value === 'user' ? '轮到你落子' : `轮到 ${aiName.value}`
})

function coordLabel(index: number): string {
  const size = boardSize.value
  const row = Math.floor(index / size)
  const col = index % size
  const letter = String.fromCharCode(65 + Math.min(col, 25))
  return `${letter}${row + 1}`
}

function rowIndex(index: number): number {
  return Math.floor(index / boardSize.value) + 1
}

function colIndex(index: number): number {
  return (index % boardSize.value) + 1
}

function clearAiTimer(): void {
  if (aiMoveTimer == null) return
  clearTimeout(aiMoveTimer)
  aiMoveTimer = null
}

function scheduleAiTurn(delayMs: number): void {
  clearAiTimer()
  aiThinking.value = true
  aiMoveTimer = setTimeout(() => {
    aiMoveTimer = null
    runAiTurn()
  }, delayMs)
}

function personaLine(event: SpeakerEvent, coord?: string): string {
  const waifu = activeWaifu.value
  const traits = waifu?.personalityTraits
  const style = waifu?.communicationStyle
  const emoji = style?.signatureEmojis?.[0] ? ` ${style.signatureEmojis[0]}` : ''
  const enthusiastic = (traits?.enthusiasm ?? 50) >= 75
  const formal = (traits?.formality ?? 50) >= 70
  const teasing = (traits?.teasing ?? 50) >= 75
  const warm = (traits?.warmth ?? 50) >= 75

  if (event === 'start') {
    return String(props.data.opening_line || `${style?.greetingPrefix || '开始吧'} ${style?.affirmationPhrase || ''} 我们来一局五子棋。${emoji}`).trim()
  }
  if (event === 'user_move') {
    if (teasing) return `哼，这步在 ${coord}？还、还不错啦。${emoji}`
    if (formal) return `已记录你在 ${coord} 的落子。该我了。${emoji}`
    return `${warm ? '这步很稳~' : '收到'} 你下在 ${coord}。${emoji}`
  }
  if (event === 'ai_move') {
    if (enthusiastic) return `轮到我啦！我下在 ${coord}~${emoji}`
    if (formal) return `我的落点是 ${coord}。请继续。${emoji}`
    return `我下在 ${coord}。${emoji}`
  }
  if (event === 'user_win') {
    if (warm) return `你赢啦，厉害！再来一局吗？${emoji}`
    if (teasing) return `这次算你赢了！下局我可不会放水。${emoji}`
    return `你获胜了。表现不错。${emoji}`
  }
  if (event === 'ai_win') {
    if (teasing) return `哼哼，我赢了~ 这、这不是在炫耀啦。${emoji}`
    if (enthusiastic) return `耶！这局我拿下了~${emoji}`
    return `这局是我赢了。继续吗？${emoji}`
  }
  return `平局。布局很接近。${emoji}`
}

function addLine(line: string): void {
  if (!line.trim()) return
  dialogue.value = [...dialogue.value.slice(-4), line]
}

function resetBoard(startWithAi = false): void {
  clearAiTimer()
  board.value = createEmptyBoard(boardSize.value)
  currentTurn.value = startWithAi ? 'ai' : 'user'
  aiThinking.value = false
  gameOver.value = false
  winner.value = null
  dialogue.value = []
  addLine(personaLine('start'))
  if (startWithAi) {
    scheduleAiTurn(280)
  }
}

function finishAs(result: 'user' | 'ai' | 'draw'): void {
  gameOver.value = true
  winner.value = result
  aiThinking.value = false
  if (result === 'user') addLine(personaLine('user_win'))
  else if (result === 'ai') addLine(personaLine('ai_win'))
  else addLine(personaLine('draw'))
}

function runAiTurn(): void {
  if (gameOver.value || currentTurn.value !== 'ai') return
  const idx = chooseAiMove(board.value, boardSize.value, aiStone.value, userStone.value)
  if (idx < 0) {
    finishAs('draw')
    return
  }
  const nextBoard = [...board.value]
  nextBoard[idx] = aiStone.value
  board.value = nextBoard
  addLine(personaLine('ai_move', coordLabel(idx)))
  if (checkWinAt(nextBoard, boardSize.value, idx, aiStone.value)) {
    finishAs('ai')
    return
  }
  if (!hasEmptyCell(nextBoard)) {
    finishAs('draw')
    return
  }
  currentTurn.value = 'user'
  aiThinking.value = false
}

function placeStone(index: number): void {
  if (gameOver.value || aiThinking.value || currentTurn.value !== 'user') return
  if (board.value[index] != null) return
  const nextBoard = [...board.value]
  nextBoard[index] = userStone.value
  board.value = nextBoard
  addLine(personaLine('user_move', coordLabel(index)))
  if (checkWinAt(nextBoard, boardSize.value, index, userStone.value)) {
    finishAs('user')
    return
  }
  if (!hasEmptyCell(nextBoard)) {
    finishAs('draw')
    return
  }
  currentTurn.value = 'ai'
  scheduleAiTurn(260)
}

function cellAriaLabel(index: number, cell: Cell): string {
  const coord = coordLabel(index)
  if (cell === 'black') return `${coord}，黑子`
  if (cell === 'white') return `${coord}，白子`
  return `${coord}，空位`
}

onMounted(() => {
  resetBoard(aiStarts.value)
})

onBeforeUnmount(() => {
  clearAiTimer()
})
</script>

<template>
  <div class="gomoku-card">
    <div class="gomoku-header">
      <div class="gomoku-title">{{ title }}</div>
      <button class="gomoku-restart" @click="resetBoard(aiStarts)">重新开局</button>
    </div>
    <div class="gomoku-status" aria-live="polite" aria-atomic="true">{{ statusText }}</div>

    <div
      class="gomoku-board"
      :style="boardStyle"
      role="grid"
      aria-label="五子棋棋盘"
      :aria-rowcount="boardSize"
      :aria-colcount="boardSize"
    >
      <button
        v-for="(cell, index) in board"
        :key="index"
        class="gomoku-cell"
        :class="{ filled: !!cell }"
        role="gridcell"
        :aria-rowindex="rowIndex(index)"
        :aria-colindex="colIndex(index)"
        :disabled="!!cell || gameOver || aiThinking"
        :aria-label="cellAriaLabel(index, cell)"
        :title="cellAriaLabel(index, cell)"
        @click="placeStone(index)"
      >
        <span v-if="cell" class="gomoku-stone" :class="cell" />
      </button>
    </div>

    <div class="gomoku-meta">
      <span>你：{{ userStone === 'black' ? '黑子' : '白子' }}</span>
      <span>{{ aiName }}：{{ aiStone === 'black' ? '黑子' : '白子' }}</span>
    </div>

    <div class="gomoku-dialogue">
      <div v-for="(line, index) in dialogue" :key="index" class="gomoku-line">
        {{ line }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.gomoku-card {
  margin: 0.25rem 0;
  padding: 0.85rem;
  border-radius: 0.85rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.gomoku-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}
.gomoku-title { font-weight: 700; color: #f1f5f9; font-size: 0.95rem; }
.gomoku-restart {
  border: 1px solid rgba(147, 197, 253, 0.45);
  background: rgba(30, 41, 59, 0.65);
  color: #dbeafe;
  border-radius: 0.45rem;
  padding: 0.2rem 0.45rem;
  font-size: 0.72rem;
  cursor: pointer;
}
.gomoku-restart:hover { background: rgba(30, 41, 59, 0.9); }
.gomoku-status { margin: 0.55rem 0; font-size: 0.78rem; color: rgba(241, 245, 249, 0.82); }
.gomoku-board {
  display: grid;
  gap: 2px;
  background: rgba(30, 41, 59, 0.9);
  border-radius: 0.55rem;
  padding: 0.35rem;
}
.gomoku-cell {
  aspect-ratio: 1 / 1;
  border: 0;
  border-radius: 0.2rem;
  background: rgba(251, 191, 36, 0.85);
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gomoku-cell:hover:enabled { background: rgba(252, 211, 77, 0.95); }
.gomoku-cell:disabled { cursor: default; }
.gomoku-stone {
  width: 74%;
  height: 74%;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}
.gomoku-stone.black { background: radial-gradient(circle at 35% 30%, #334155, #020617 70%); }
.gomoku-stone.white { background: radial-gradient(circle at 35% 30%, #ffffff, #dbeafe 72%); }
.gomoku-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 0.55rem;
  font-size: 0.72rem;
  color: rgba(226, 232, 240, 0.78);
}
.gomoku-dialogue {
  margin-top: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.gomoku-line {
  border-radius: 0.45rem;
  background: rgba(30, 41, 59, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e2e8f0;
  font-size: 0.75rem;
  line-height: 1.45;
  padding: 0.35rem 0.5rem;
}
</style>
