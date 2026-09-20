<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { WaifuCommunicationStyle, WaifuPersonalityTraits } from '@syntax-senpai/waifu-core'

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
  coord: string
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
}>()

const emit = defineEmits<{
  commentary: [message: string]
  close: []
}>()

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

function createCommentaryCounters(): Record<CommentaryKind, number> {
  return {
    ready: 0,
    reset: 0,
    playerMove: 0,
    aiMove: 0,
    playerWin: 0,
    aiWin: 0,
    draw: 0,
  }
}

const board = ref<CellValue[][]>(createBoard())
const moveHistory = ref<MoveEntry[]>([])
const winner = ref<CellValue>(0)
const isDraw = ref(false)
const winningLine = ref<Coordinate[]>([])
const aiThinking = ref(false)
const latestCommentary = ref('')
const commentaryBubbles = ref<CommentaryBubble[]>([])
const commentaryCounters = ref<Record<CommentaryKind, number>>(createCommentaryCounters())
let nextBubbleId = 0
let aiMoveTimer: ReturnType<typeof setTimeout> | null = null

const normalizedPersonality = computed<WaifuPersonalityTraits>(() => ({
  warmth: props.personality?.warmth ?? 65,
  formality: props.personality?.formality ?? 45,
  enthusiasm: props.personality?.enthusiasm ?? 55,
  teasing: props.personality?.teasing ?? 25,
  verbosity: props.personality?.verbosity ?? 40,
  humor: props.personality?.humor ?? 35,
}))

const waifuName = computed(() => props.waifuDisplayName?.trim() || 'Waifu')
const promptCorpus = computed(() => [
  props.systemPromptTemplate,
  props.backstory,
  ...(props.catchphrases ?? []),
  ...(props.tags ?? []),
].filter(Boolean).join('\n'))

function inferSelfReferenceFromPrompt(value: string): string {
  const explicitMatch = value.match(/(?:自称|自我称呼|第一人称|用[“"「']?)(人家|本小姐|咱家|咱|妾身|吾|本王|老娘|俺|在下|小女子|本姑娘|本座|余)(?:[”"」']?|说话|表达|称呼)?/)
  if (explicitMatch?.[1]) return explicitMatch[1]

  const candidates = ['人家', '本小姐', '咱家', '咱', '妾身', '吾', '本王', '老娘', '俺', '在下', '小女子', '本姑娘', '本座', '余']
  return candidates.find((candidate) => value.includes(candidate)) ?? ''
}

const selfReference = computed(() => {
  const inferred = inferSelfReferenceFromPrompt(promptCorpus.value)
  if (inferred) return inferred
  const configured = props.communicationStyle?.usesHonorificSelf?.trim()
  if (configured) return configured
  return props.communicationStyle?.speaksIn3rdPerson ? waifuName.value : '我'
})
const thirdPerson = computed(() => props.communicationStyle?.speaksIn3rdPerson === true)
const styleProfile = computed(() => {
  const corpus = promptCorpus.value
  const emojis = props.communicationStyle?.signatureEmojis ?? []
  return {
    cute: /人家|可爱|撒娇|甜|粉色|妖精|少女|花|浪漫|可可爱爱|♪|~|💕|🌸|💗|💖/.test(corpus) || emojis.some((emoji) => /💕|🌸|💗|💖/.test(emoji)),
    elegant: /优雅|浪漫|诗|花|星|月|梦|温柔|轻盈|华丽/.test(corpus),
    tsundere: /傲娇|嘴硬|别误会|才不是|哼/.test(corpus),
    mysterious: /神秘|梦|月|星|命运|低语|夜/.test(corpus),
    musical: /♪|音符|歌|旋律/.test(corpus),
  }
})
const commentaryEmoji = computed(() => {
  const emoji = props.communicationStyle?.signatureEmojis?.find((item) => item?.trim())
  if (emoji) return emoji
  if (normalizedPersonality.value.enthusiasm >= 80) return '🌟'
  if (normalizedPersonality.value.teasing >= 70) return '😏'
  if (normalizedPersonality.value.formality >= 70) return '♟️'
  return '✨'
})

const gameOver = computed(() => winner.value !== 0 || isDraw.value)
const winningCellKeys = computed(() => new Set(winningLine.value.map((cell) => `${cell.row}:${cell.col}`)))
const historyNewestFirst = computed(() => [...moveHistory.value].reverse())
const currentTurnLabel = computed(() => {
  if (winner.value === 1) return '黑棋获胜'
  if (winner.value === 2) return '白棋获胜'
  if (isDraw.value) return '平局'
  if (aiThinking.value) return `${waifuName.value}思考中…`
  return '轮到你落子'
})

function resetBoardState() {
  board.value = createBoard()
  moveHistory.value = []
  winner.value = 0
  isDraw.value = false
  winningLine.value = []
  aiThinking.value = false
  commentaryBubbles.value = []
  commentaryCounters.value = createCommentaryCounters()
}

function publishCommentary(kind: CommentaryKind, move?: MoveEntry) {
  const message = buildCommentary(kind, move)
  latestCommentary.value = message
  const speaker: BubbleSpeaker = kind === 'ready' || kind === 'reset' ? 'system' : 'waifu'
  commentaryBubbles.value.push({ id: nextBubbleId++, speaker, text: message })
  if (commentaryBubbles.value.length > 12) commentaryBubbles.value.shift()
  emit('commentary', message)
}

function buildCommentary(kind: CommentaryKind, move?: MoveEntry): string {
  const { warmth, formality, enthusiasm, teasing, humor } = normalizedPersonality.value
  const emoji = commentaryEmoji.value
  const affirmation = props.communicationStyle?.affirmationPhrase?.trim()
  const highEnergy = enthusiasm >= 80
  const formal = formality >= 70
  const playful = teasing >= 70 || humor >= 70
  const warm = warmth >= 75
  const self = selfReference.value
  const subject = thirdPerson.value ? waifuName.value : self
  const style = styleProfile.value
  const sparkle = style.musical ? '♪' : emoji
  const soften = (line: string) => {
    if (style.cute && !/[♪~💕🌸💗💖]$/.test(line)) return `${line}${sparkle}`
    if (style.elegant && !/[。！？♪~]$/.test(line)) return `${line}。`
    return line
  }
  const variants: Record<CommentaryKind, string[]> = {
    ready: highEnergy
      ? [
          `五子棋开始啦，黑棋先手${sparkle}`,
          `来吧来吧，看看谁能先连成五子${sparkle}`,
          style.cute ? `老公先下哦，${self}会认真陪你的${sparkle}` : `你先手，${subject}已经准备好了${sparkle}`,
          style.elegant ? `棋局像花瓣一样展开了，请先落子吧${sparkle}` : `开局啦，先把节奏握住吧${sparkle}`,
        ]
      : formal
        ? [`棋局已准备就绪。您执黑先行。`, `对局开始，请您先行。`, `${subject}将保持专注。`, `请落子，局势将从这一刻展开。`]
        : [`连成五子即可获胜${sparkle}`, `棋局开场，先手交给你${sparkle}`, `${subject}会看好每一步的${sparkle}`, `先手优势在你这里，别浪费哦${sparkle}`],
    reset: affirmation && highEnergy
      ? [`${self}会处理好的，新棋盘重新开始${sparkle}`, `${self}状态满满，重新来一局吧${sparkle}`, `${affirmation} 这次也要漂亮地开始${sparkle}`, `重开也很浪漫呀，新的胜负要来了${sparkle}`]
      : formal
        ? [`棋盘已重置，请开始落子。`, `新一局已准备，请您先行。`, `${subject}会重新评估局势。`, `对局归零，请谨慎开场。`]
        : [`新棋盘，新一局对决${sparkle}`, `刚才不算，我们再战一局${sparkle}`, `${self}已经重新打起精神了${sparkle}`, `换一盘新的，气氛也变新鲜了${sparkle}`],
    playerMove: playful
      ? [`这一步挺大胆嘛。`, `哼，攻势不错，别得意太早。`, style.cute ? `哎呀，老公这一步有点会嘛${sparkle}` : `想偷袭？${subject}可看见了。`, style.tsundere ? `才、才没有被你吓到呢。` : `节奏突然变有趣了。`]
      : formal
        ? [`您的攻势已纳入判断。`, `这一步改变了局势。`, `${subject}会重新计算防线。`, `您的布局意图已经很清晰。`]
        : [`不错，这一步很有想法${sparkle}`, `看起来你在布局了${sparkle}`, `${self}感觉局面开始热起来了${sparkle}`, `这一手让棋盘变得更有意思了${sparkle}`],
    aiMove: playful
      ? [`${subject}接招了，可别跟丢了。`, `轮到${subject}继续表演了。`, style.cute ? `${self}轻轻落下一子，欸嘿${sparkle}` : `${subject}把你的计划拨乱一点。`, style.tsundere ? `别误会，只是顺手挡一下而已。` : `这一步，先把主动权拿回来。`]
      : formal
        ? [`白棋完成应对。`, `防线已经调整。`, `${subject}已作出最优回应。`, `局势仍在可控范围内。`]
        : [`${subject}来接这一招${sparkle}`, `这一步先由${subject}稳住局面${sparkle}`, `${self}也要认真起来了${sparkle}`, `现在轮到你想办法破解啦${sparkle}`],
    playerWin: warm
      ? [`你赢下了这局，打得漂亮${sparkle}`, `这次是你更胜一筹，恭喜${sparkle}`, style.cute ? `呜，老公赢了呢……人家有点不甘心，但也好开心${sparkle}` : `你的布局很稳，${self}输得心服口服${sparkle}`, `这一局属于你，真的很精彩${sparkle}`]
      : formal
        ? [`确认胜利。黑棋已连成五子。`, `对局结束，您已获胜。`, `${subject}承认这是一场优秀的进攻。`, `胜负已定，您的判断更准确。`]
        : [`啊，被你赢到了。干得不错。`, `这局算你厉害，下次${self}不会大意。`, `居然真的让你连起来了，厉害。`, `这次你赢得很漂亮。`],
    aiWin: playful
      ? [`这一局是${subject}拿下了，早就看穿你的计划${sparkle}`, `白棋连成五子，想赢${subject}可没那么容易${sparkle}`, style.cute ? `嘿嘿，是${self}赢啦，不许耍赖哦${sparkle}` : `${subject}稍微认真一下，胜负就分出来了。`, `看吧，这就是${subject}的节奏。`]
      : formal
        ? [`白棋已取得胜利。`, `对局结束，白棋获胜。`, `${subject}已完成连线。`, `本局由${subject}取得优势并转化为胜势。`]
        : [`这一局是${subject}赢了${sparkle}`, `这次轮到${subject}庆祝啦${sparkle}`, `${self}抓住机会啦${sparkle}`, `胜利的节奏被${subject}拿到了${sparkle}`],
    draw: highEnergy
      ? [`棋盘下满啦，平局！刚才好险${sparkle}`, `势均力敌，平局收场${sparkle}`, style.cute ? `欸，居然谁也没赢，老公要不要再陪${self}一局${sparkle}` : `这盘拉满了，下一局一定更刺激${sparkle}`, `平局也不错，至少说明我们都很认真${sparkle}`]
      : formal
        ? [`判定平局，棋盘已无可用落点。`, `双方未能形成胜势，本局平局。`, `${subject}建议复盘后再开一局。`, `局势完全封闭，本局结束。`]
        : [`这局平手，要不要再来一局？`, `谁也没能取胜，再战一盘？`, `${self}觉得还没尽兴呢${sparkle}`, `平局呀，那就再给彼此一次机会吧${sparkle}`],
  }
  const candidates = variants[kind].map((candidate) => soften(candidate))
  const recent = new Set(commentaryBubbles.value.slice(-8).map((bubble) => bubble.text.trim()))
  const startIndex = commentaryCounters.value[kind] % candidates.length
  const rotated = candidates.slice(startIndex).concat(candidates.slice(0, startIndex))
  const overflow = [
    `${self}换个节奏陪你下${sparkle}`,
    `局势又变了，别眨眼${sparkle}`,
    style.cute ? `老公这盘真的越来越有趣啦${sparkle}` : `这一盘还没到终点。`,
    style.tsundere ? `哼，别以为这样就稳了。` : `${subject}还在认真观察。`,
    style.elegant ? `棋路像花枝一样分开了${sparkle}` : `下一步会更关键${sparkle}`,
    `${self}要重新组织攻势了${sparkle}`,
  ].map((candidate) => soften(candidate))
  const picked =
    rotated.find((candidate) => !recent.has(candidate.trim())) ??
    overflow.find((candidate) => !recent.has(candidate.trim())) ??
    overflow[commentaryCounters.value[kind] % overflow.length]

  commentaryCounters.value[kind] += 1
  return picked
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
  publishCommentary('reset')
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
    publishCommentary(player === 1 ? 'playerWin' : 'aiWin', moveHistory.value[moveHistory.value.length - 1])
    return true
  }

  if (moveHistory.value.length >= BOARD_SIZE * BOARD_SIZE) {
    isDraw.value = true
    publishCommentary('draw')
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
    coord: formatCoordinate(row, col),
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
  if (!finalizeMove(2, choice.row, choice.col)) publishCommentary('aiMove', move)
}

function playHumanMove(row: number, col: number) {
  if (aiThinking.value || gameOver.value || board.value[row][col] !== 0) return

  const move = commitMove(row, col, 1)
  if (finalizeMove(1, row, col)) return

  publishCommentary('playerMove', move)
  aiThinking.value = true
  clearAiTimer()
  aiMoveTimer = setTimeout(() => runAiTurn(), 260)
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
  publishCommentary('ready')
})

onBeforeUnmount(() => {
  clearAiTimer()
})
</script>

<template>
  <Teleport to="body">
    <section class="gomoku-panel fixed inset-0 z-[70] flex min-h-0 flex-col bg-[#090b12]/95 text-white backdrop-blur-2xl">
    <div class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-white/10 bg-black/20 px-5 py-4 sm:px-8">
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-lg font-semibold text-white">
          <span aria-hidden="true">⚫⚪</span>
          <span>Gomoku</span>
          <span class="rounded-full bg-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-neutral-300">15 × 15</span>
        </div>
        <p class="mt-1 text-xs text-neutral-400 sm:text-sm">
          You are black. {{ waifuName }} plays white with a deterministic heuristic AI.
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
          Reset
        </button>
        <button
          type="button"
          class="btn-ghost px-3 py-1.5 text-xs"
          aria-label="Close Gomoku panel"
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
                  'gomoku-cell-playable': !gameOver && !aiThinking && board[rowIndex - 1][colIndex - 1] === 0,
                  'gomoku-cell-winning': isWinningCell(rowIndex - 1, colIndex - 1),
                  'gomoku-cell-last': isLastMove(rowIndex - 1, colIndex - 1),
                }"
                :disabled="gameOver || aiThinking || board[rowIndex - 1][colIndex - 1] !== 0"
                :aria-label="`Play ${formatCoordinate(rowIndex - 1, colIndex - 1)}`"
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
            <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Live chat</div>
            <span class="text-[11px] text-neutral-500">personality output</span>
          </div>
          <div class="min-h-40 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
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
                  {{ bubble.speaker === 'system' ? 'Game' : waifuName }}
                </div>
                {{ bubble.text }}
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
