<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { WaifuCommunicationStyle, WaifuPersonalityTraits } from '@syntax-senpai/waifu-core'
import { useI18n } from '../composables/use-i18n'

type Pulse = 'surge' | 'calm'
type Side = 'player' | 'agent'
type ItemKind = 'lens' | 'inverter' | 'barrier' | 'vent'
type DialogueKind = 'ready' | 'playerRisk' | 'playerHit' | 'agentCalm' | 'agentHit' | 'item' | 'round' | 'playerWin' | 'agentWin'

interface DialogueEntry {
  id: number
  speaker: 'system' | 'agent'
  text: string
}

interface Inventory {
  lens: number
  inverter: number
  barrier: number
  vent: number
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

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const MAX_INTEGRITY = 5
const ITEM_ICONS: Record<ItemKind, string> = { lens: '◇', inverter: '↻', barrier: '⬡', vent: '⌁' }
const itemLabels = computed<Record<ItemKind, { name: string; icon: string; description: string }>>(() => ({
  lens: { name: t('fate.item.lens'), icon: ITEM_ICONS.lens, description: t('fate.item.lensDescription') },
  inverter: { name: t('fate.item.inverter'), icon: ITEM_ICONS.inverter, description: t('fate.item.inverterDescription') },
  barrier: { name: t('fate.item.barrier'), icon: ITEM_ICONS.barrier, description: t('fate.item.barrierDescription') },
  vent: { name: t('fate.item.vent'), icon: ITEM_ICONS.vent, description: t('fate.item.ventDescription') },
}))

const normalizedPersonality = computed<WaifuPersonalityTraits>(() => ({
  warmth: props.personality?.warmth ?? 65,
  formality: props.personality?.formality ?? 45,
  enthusiasm: props.personality?.enthusiasm ?? 55,
  teasing: props.personality?.teasing ?? 25,
  verbosity: props.personality?.verbosity ?? 60,
  humor: props.personality?.humor ?? 35,
}))

const waifuName = computed(() => props.waifuDisplayName?.trim() || 'Agent')
const promptCorpus = computed(() => [
  props.systemPromptTemplate,
  props.backstory,
  ...(props.catchphrases ?? []),
  ...(props.tags ?? []),
].filter(Boolean).join('\n'))

function inferSelfReference(value: string): string {
  const options = ['人家', '本小姐', '咱家', '妾身', '吾', '本王', '老娘', '俺', '在下', '小女子', '本姑娘', '本座', '余']
  return options.find((candidate) => value.includes(candidate)) ?? ''
}

const selfReference = computed(() =>
  inferSelfReference(promptCorpus.value) ||
  props.communicationStyle?.usesHonorificSelf?.trim() ||
  (props.communicationStyle?.speaksIn3rdPerson ? waifuName.value : '我'),
)

const signature = computed(() => props.communicationStyle?.signatureEmojis?.[0] || '✦')
const styleProfile = computed(() => {
  const corpus = promptCorpus.value
  return {
    cute: /人家|可爱|撒娇|少女|妖精|甜|粉色|♪|💕|🌸/.test(corpus),
    elegant: /优雅|浪漫|花|诗|星|月|梦|华丽/.test(corpus),
    tsundere: /傲娇|嘴硬|别误会|才不是|哼/.test(corpus),
    mysterious: /神秘|命运|夜|梦|低语|虚空/.test(corpus),
    technical: /工程|系统|算法|架构|调试|DevOps|代码/.test(corpus),
  }
})

const playerIntegrity = ref(MAX_INTEGRITY)
const agentIntegrity = ref(MAX_INTEGRITY)
const playerBarrier = ref(false)
const agentBarrier = ref(false)
const chamber = ref<Pulse[]>([])
const visibleComposition = ref({ surge: 0, calm: 0 })
const currentTurn = ref<Side>('player')
const thinking = ref(false)
const round = ref(0)
const winner = ref<Side | null>(null)
const revealedPulse = ref<Pulse | null>(null)
const playerItems = ref<Inventory>({ lens: 1, inverter: 1, barrier: 1, vent: 0 })
const agentItems = ref<Inventory>({ lens: 1, inverter: 1, barrier: 1, vent: 0 })
const dialogue = ref<DialogueEntry[]>([])
const generatingDialogue = ref(false)
const lastAction = ref('对局刚刚开始')
const firing = ref<{ actor: Side; target: Side } | null>(null)
const dialogueScrollRef = ref<HTMLDivElement | null>(null)
let dialogueId = 0
let agentTimer: ReturnType<typeof setTimeout> | null = null
let dialogueGeneration = 0
let actionGeneration = 0
let dialogueQueue: Promise<void> = Promise.resolve()

const currentPulse = computed(() => chamber.value[0] ?? null)
const gameOver = computed(() => winner.value !== null)
const canPlayerAct = computed(() =>
  currentTurn.value === 'player' &&
  !thinking.value &&
  !generatingDialogue.value &&
  !firing.value &&
  !gameOver.value &&
  chamber.value.length > 0,
)
const turnLabel = computed(() => {
  if (winner.value === 'player') return t('fate.playerWon')
  if (winner.value === 'agent') return t('fate.agentWon', { name: waifuName.value })
  if (thinking.value) return t('fate.agentThinking', { name: waifuName.value })
  if (firing.value) return t('fate.firing')
  return currentTurn.value === 'player' ? t('fate.playerTurn') : t('fate.agentTurn', { name: waifuName.value })
})

function shuffle<T>(values: T[]): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function randomItem(): ItemKind {
  const items: ItemKind[] = ['lens', 'inverter', 'barrier', 'vent']
  return items[Math.floor(Math.random() * items.length)]
}

function grantItems(inventory: Inventory, count: number) {
  for (let index = 0; index < count; index += 1) inventory[randomItem()] += 1
}

function loadRound(announce = true) {
  round.value += 1
  const total = Math.min(8, 4 + round.value)
  const surge = Math.max(2, Math.min(total - 1, Math.floor(total / 2) + (Math.random() > 0.5 ? 1 : 0)))
  const calm = total - surge
  chamber.value = shuffle([
    ...Array.from({ length: surge }, () => 'surge' as Pulse),
    ...Array.from({ length: calm }, () => 'calm' as Pulse),
  ])
  visibleComposition.value = { surge, calm }
  revealedPulse.value = null
  grantItems(playerItems.value, round.value === 1 ? 1 : 2)
  grantItems(agentItems.value, round.value === 1 ? 1 : 2)
  lastAction.value = `第 ${round.value} 轮完成装填`
  if (announce) void addDialogue('round')
}

function resetGame() {
  clearAgentTimer()
  playerIntegrity.value = MAX_INTEGRITY
  agentIntegrity.value = MAX_INTEGRITY
  playerBarrier.value = false
  agentBarrier.value = false
  currentTurn.value = 'player'
  thinking.value = false
  generatingDialogue.value = false
  firing.value = null
  round.value = 0
  winner.value = null
  dialogue.value = []
  playerItems.value = { lens: 1, inverter: 1, barrier: 1, vent: 0 }
  agentItems.value = { lens: 1, inverter: 1, barrier: 1, vent: 0 }
  dialogueGeneration += 1
  actionGeneration += 1
  dialogueQueue = Promise.resolve()
  loadRound(false)
  void addDialogue('ready')
}

function applyDamage(target: Side) {
  const barrier = target === 'player' ? playerBarrier : agentBarrier
  if (barrier.value) {
    barrier.value = false
    return false
  }
  const integrity = target === 'player' ? playerIntegrity : agentIntegrity
  integrity.value = Math.max(0, integrity.value - 1)
  if (integrity.value === 0) {
    winner.value = target === 'player' ? 'agent' : 'player'
  }
  return true
}

function removeFromComposition(pulse: Pulse) {
  visibleComposition.value[pulse] = Math.max(0, visibleComposition.value[pulse] - 1)
}

function invertComposition(from: Pulse) {
  const to: Pulse = from === 'surge' ? 'calm' : 'surge'
  removeFromComposition(from)
  visibleComposition.value[to] += 1
}

function consumePulse(target: Side, actor: Side): Promise<void> {
  const pulse = chamber.value.shift()
  revealedPulse.value = null
  if (!pulse) return Promise.resolve()
  removeFromComposition(pulse)

  let responseKind: DialogueKind
  if (pulse === 'surge') {
    const damaged = applyDamage(target)
    lastAction.value = `${actor === 'player' ? '用户' : waifuName.value}将脉冲引向${target === 'player' ? '用户' : waifuName.value}；结果为能量脉冲，${damaged ? '目标护盾损失 1 点' : '目标屏障抵消了伤害'}`
    responseKind = gameOver.value
      ? winner.value === 'player' ? 'playerWin' : 'agentWin'
      : actor === 'player' ? 'playerHit' : 'agentHit'
    currentTurn.value = actor === 'player' ? 'agent' : 'player'
  } else {
    lastAction.value = `${actor === 'player' ? '用户' : waifuName.value}将脉冲引向${target === 'player' ? '用户' : waifuName.value}；结果为静默脉冲，没有造成伤害`
    responseKind = actor === 'player' ? 'playerRisk' : 'agentCalm'
    currentTurn.value = target === actor ? actor : actor === 'player' ? 'agent' : 'player'
  }

  const response = addDialogue(responseKind)
  if (!gameOver.value && chamber.value.length === 0) {
    response.then(() => loadRound())
  } else if (!gameOver.value && currentTurn.value === 'agent') {
    response.then(() => scheduleAgentTurn())
  }
  return response
}

async function launchPulse(target: Side, actor: Side) {
  if (firing.value || gameOver.value) return
  const generation = actionGeneration
  firing.value = { actor, target }
  await new Promise((resolve) => setTimeout(resolve, 720))
  if (generation !== actionGeneration) return
  await consumePulse(target, actor)
  if (generation === actionGeneration) firing.value = null
}

function playerRoute(target: Side) {
  if (!canPlayerAct.value) return
  void launchPulse(target, 'player')
}

function usePlayerItem(item: ItemKind) {
  if (!canPlayerAct.value || playerItems.value[item] <= 0) return
  playerItems.value[item] -= 1
  lastAction.value = `用户使用了${itemLabels.value[item].name}`
  if (item === 'lens') revealedPulse.value = currentPulse.value
  if (item === 'inverter' && currentPulse.value) {
    invertComposition(currentPulse.value)
    chamber.value[0] = currentPulse.value === 'surge' ? 'calm' : 'surge'
    revealedPulse.value = chamber.value[0]
  }
  if (item === 'barrier') playerBarrier.value = true
  if (item === 'vent') {
    const removed = chamber.value.shift()
    if (removed) removeFromComposition(removed)
    revealedPulse.value = null
    if (chamber.value.length === 0) loadRound()
  }
}

function useAgentItem(item: ItemKind) {
  if (agentItems.value[item] <= 0) return
  agentItems.value[item] -= 1
  lastAction.value = `${waifuName.value}使用了${itemLabels.value[item].name}`
  if (item === 'inverter' && currentPulse.value) {
    invertComposition(currentPulse.value)
    chamber.value[0] = currentPulse.value === 'surge' ? 'calm' : 'surge'
  }
  if (item === 'barrier') agentBarrier.value = true
  if (item === 'vent') {
    const removed = chamber.value.shift()
    if (removed) removeFromComposition(removed)
    if (chamber.value.length === 0) loadRound()
  }
}

function runAgentTurn() {
  agentTimer = null
  if (gameOver.value || currentTurn.value !== 'agent') {
    thinking.value = false
    return
  }

  let known: Pulse | null = null
  if (agentItems.value.lens > 0 && (chamber.value.length <= 3 || agentIntegrity.value <= 2)) {
    useAgentItem('lens')
    known = currentPulse.value
  }
  if (!agentBarrier.value && agentItems.value.barrier > 0 && agentIntegrity.value <= 2) useAgentItem('barrier')
  if (known === 'calm') {
    thinking.value = false
    void launchPulse('agent', 'agent')
    return
  }
  if (known === 'surge') {
    thinking.value = false
    void launchPulse('player', 'agent')
    return
  }

  const surgeChance = visibleComposition.value.surge / Math.max(1, visibleComposition.value.surge + visibleComposition.value.calm)
  const target: Side = surgeChance < 0.44 && agentIntegrity.value > 1 ? 'agent' : 'player'
  thinking.value = false
  void launchPulse(target, 'agent')
}

function scheduleAgentTurn() {
  clearAgentTimer()
  thinking.value = true
  const delay = 1800 + Math.round(normalizedPersonality.value.verbosity * 10) + Math.floor(Math.random() * 700)
  agentTimer = setTimeout(runAgentTurn, delay)
}

function clearAgentTimer() {
  if (agentTimer) clearTimeout(agentTimer)
  agentTimer = null
}

function inventorySummary(inventory: Inventory): string {
  return (Object.keys(ITEM_ICONS) as ItemKind[])
    .map((item) => `${itemLabels.value[item].name}×${inventory[item]}`)
    .join('、')
}

function buildGameState(kind: DialogueKind): string {
  return [
    `事件类型：${kind}`,
    `最近行动与结果：${lastAction.value}`,
    `当前轮次：${round.value}`,
    `当前行动权：${currentTurn.value === 'player' ? '用户' : waifuName.value}`,
    `用户护盾：${playerIntegrity.value}/${MAX_INTEGRITY}${playerBarrier.value ? '，屏障已激活' : ''}`,
    `${waifuName.value}护盾：${agentIntegrity.value}/${MAX_INTEGRITY}${agentBarrier.value ? '，屏障已激活' : ''}`,
    `公开脉冲构成：能量 ${visibleComposition.value.surge}，静默 ${visibleComposition.value.calm}，共剩余 ${chamber.value.length}`,
    `用户道具：${inventorySummary(playerItems.value)}`,
    `${waifuName.value}道具：${inventorySummary(agentItems.value)}`,
    `胜负状态：${winner.value === 'player' ? '用户获胜' : winner.value === 'agent' ? `${waifuName.value}获胜` : '对局继续'}`,
    `信息边界：不得透露隐藏脉冲顺序；只有公开构成可被谈论。`,
  ].join('\n')
}

async function addDialogue(kind: DialogueKind): Promise<void> {
  const generation = dialogueGeneration
  const stateSnapshot = buildGameState(kind)
  dialogueQueue = dialogueQueue.then(async () => {
    if (generation !== dialogueGeneration) return
    generatingDialogue.value = true
    try {
      if (!props.dialogueGenerator) throw new Error('游戏对话生成器未连接。')
      const recentReplies = dialogue.value
        .filter((entry) => entry.speaker === 'agent')
        .slice(-6)
        .map((entry) => entry.text)
      const text = await props.dialogueGenerator(stateSnapshot, recentReplies)
      if (generation !== dialogueGeneration) return
      dialogue.value.push({ id: dialogueId++, speaker: 'agent', text })
      if (dialogue.value.length > 10) dialogue.value.shift()
    } catch (error) {
      if (generation !== dialogueGeneration) return
      const message = error instanceof Error ? error.message : String(error)
      dialogue.value.push({
        id: dialogueId++,
        speaker: 'system',
        text: `角色回应生成失败：${message}`,
      })
    } finally {
      if (generation === dialogueGeneration) generatingDialogue.value = false
    }
  })
  await dialogueQueue
}

onMounted(resetGame)
onBeforeUnmount(clearAgentTimer)

watch(
  () => [dialogue.value.length, generatingDialogue.value] as const,
  async () => {
    await nextTick()
    dialogueScrollRef.value?.scrollTo({
      top: dialogueScrollRef.value.scrollHeight,
      behavior: 'smooth',
    })
  },
)
</script>

<template>
  <Teleport to="body">
    <section class="fate-game fixed inset-0 z-[75] flex min-h-0 flex-col overflow-hidden bg-[#080912]/97 text-white backdrop-blur-2xl">
      <header class="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-black/20 px-5 py-4 sm:px-8">
        <div>
          <div class="flex items-center gap-3">
            <span class="fate-orb h-5 w-5 rounded-full" />
            <h2 class="text-lg font-semibold">{{ t('games.fate') }}</h2>
            <span class="rounded-full border border-violet-300/20 bg-violet-400/10 px-2.5 py-1 text-[10px] tracking-[0.16em] text-violet-200">{{ t('fate.energyDuel') }}</span>
          </div>
          <p class="mt-1 text-xs text-neutral-400">{{ t('fate.subtitle') }}</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-200">{{ turnLabel }}</span>
          <button class="btn-ghost px-3 py-1.5 text-xs" type="button" @click="resetGame">{{ t('games.reset') }}</button>
          <button class="btn-ghost px-3 py-1.5 text-xs" type="button" :aria-label="t('games.close')" @click="emit('close')">✕</button>
        </div>
      </header>

      <div class="grid min-h-0 flex-1 gap-5 overflow-y-auto p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_24rem] xl:p-8">
        <main class="fate-arena relative flex min-h-[38rem] flex-col overflow-hidden rounded-3xl border border-white/10 p-5 sm:p-8">
          <div class="pointer-events-none absolute inset-0 opacity-60">
            <div class="fate-ring absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-300/15" />
          </div>

          <div class="relative z-10 grid grid-cols-2 gap-4">
            <div class="rounded-2xl border border-cyan-300/15 bg-cyan-400/5 p-4">
              <div class="text-xs uppercase tracking-[0.16em] text-cyan-200/70">{{ t('fate.playerShield') }}</div>
              <div class="mt-3 flex gap-2">
                <span v-for="index in MAX_INTEGRITY" :key="`p-${index}`" :class="['h-3 flex-1 rounded-full transition-all', index <= playerIntegrity ? 'bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,.45)]' : 'bg-white/8']" />
              </div>
              <div v-if="playerBarrier" class="mt-2 text-xs text-cyan-200">{{ t('fate.barrierActive') }}</div>
            </div>
            <div class="rounded-2xl border border-violet-300/15 bg-violet-400/5 p-4 text-right">
              <div class="text-xs uppercase tracking-[0.16em] text-violet-200/70">{{ t('fate.agentShield', { name: waifuName }) }}</div>
              <div class="mt-3 flex gap-2">
                <span v-for="index in MAX_INTEGRITY" :key="`a-${index}`" :class="['h-3 flex-1 rounded-full transition-all', index <= agentIntegrity ? 'bg-violet-300 shadow-[0_0_14px_rgba(196,181,253,.45)]' : 'bg-white/8']" />
              </div>
              <div v-if="agentBarrier" class="mt-2 text-xs text-violet-200">{{ t('fate.barrierActive') }}</div>
            </div>
          </div>

          <div class="relative z-10 flex flex-1 flex-col items-center justify-center py-8">
            <div class="text-center">
              <div class="text-[10px] uppercase tracking-[0.28em] text-neutral-500">ROUND {{ round }}</div>
              <div
                :class="[
                  'fate-core relative mt-5 flex h-48 w-48 items-center justify-center rounded-full border',
                  thinking ? 'fate-core-thinking border-violet-300/40' : 'border-white/15',
                  firing ? 'fate-core-firing' : '',
                ]"
              >
                <div class="absolute inset-5 rounded-full border border-dashed border-white/15" />
                <div v-if="firing" class="fate-flash absolute inset-0 rounded-full" />
                <div class="text-center">
                  <div class="text-4xl">{{ firing ? '◈' : thinking ? '✦' : revealedPulse === 'surge' ? '◆' : revealedPulse === 'calm' ? '◇' : '?' }}</div>
                  <div class="mt-2 text-xs text-neutral-400">
                    {{ firing
                      ? t('fate.routingTo', { target: firing.target === 'player' ? t('fate.yourCircuit') : waifuName })
                      : thinking
                        ? t('fate.calculating')
                        : revealedPulse === 'surge'
                          ? t('fate.energyPulse')
                          : revealedPulse === 'calm'
                            ? t('fate.calmPulse')
                            : t('fate.unknownPulse') }}
                  </div>
                </div>
              </div>
              <div
                v-if="firing"
                :class="[
                  'fate-discharge',
                  firing.target === 'player' ? 'fate-discharge-player' : 'fate-discharge-agent',
                ]"
              />
            </div>

            <div class="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs">
              <span class="rounded-full bg-rose-400/10 px-3 py-1.5 text-rose-200">◆ {{ t('fate.energyCount', { count: visibleComposition.surge }) }}</span>
              <span class="rounded-full bg-sky-400/10 px-3 py-1.5 text-sky-200">◇ {{ t('fate.calmCount', { count: visibleComposition.calm }) }}</span>
              <span class="rounded-full bg-white/5 px-3 py-1.5 text-neutral-300">{{ t('fate.remaining', { count: chamber.length }) }}</span>
            </div>
          </div>

          <div class="relative z-10">
            <div class="mb-3 grid grid-cols-4 gap-2">
              <button
                v-for="(item, key) in itemLabels"
                :key="key"
                type="button"
                class="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left transition hover:border-violet-300/30 hover:bg-violet-400/10 disabled:cursor-not-allowed disabled:opacity-35"
                :disabled="!canPlayerAct || playerItems[key as ItemKind] <= 0"
                :title="item.description"
                @click="usePlayerItem(key as ItemKind)"
              >
                <div class="flex items-center justify-between"><span class="text-lg">{{ item.icon }}</span><span class="text-xs text-neutral-400">×{{ playerItems[key as ItemKind] }}</span></div>
                <div class="mt-1 text-xs font-medium text-neutral-200">{{ item.name }}</div>
                <div class="mt-1.5 text-[10px] leading-4 text-neutral-500">{{ item.description }}</div>
              </button>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <button class="fate-action fate-action-self" type="button" :disabled="!canPlayerAct" @click="playerRoute('player')">
                <span class="text-sm font-semibold">{{ t('fate.routeSelf') }}</span>
                <span class="mt-1 text-[11px] text-neutral-400">{{ t('fate.routeSelfHint') }}</span>
              </button>
              <button class="fate-action fate-action-agent" type="button" :disabled="!canPlayerAct" @click="playerRoute('agent')">
                <span class="text-sm font-semibold">{{ t('fate.routeAgent', { name: waifuName }) }}</span>
                <span class="mt-1 text-[11px] text-neutral-400">{{ t('fate.routeAgentHint') }}</span>
              </button>
            </div>
          </div>
        </main>

        <aside class="fate-dialogue flex min-h-[28rem] flex-col rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <div class="mb-4 flex items-center justify-between">
            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-300">{{ t('fate.dialogue') }}</div>
              <div class="mt-1 text-[11px] text-neutral-500">{{ t('fate.dialogueHint') }}</div>
            </div>
            <span v-if="thinking || generatingDialogue" class="thinking-dots text-xs text-violet-200">
              {{ generatingDialogue ? t('fate.organizing', { name: waifuName }) : t('fate.agentThinking', { name: waifuName }) }}
            </span>
          </div>
          <div ref="dialogueScrollRef" class="flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
            <div v-for="entry in dialogue" :key="entry.id" class="flex justify-start">
              <div :class="['max-w-[96%] rounded-2xl rounded-bl-md px-4 py-3 text-sm leading-7 shadow-lg', entry.speaker === 'system' ? 'bg-white/7 text-neutral-300' : 'bg-violet-500/18 text-violet-50']">
                <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">{{ entry.speaker === 'system' ? t('fate.device') : waifuName }}</div>
                {{ entry.text }}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.fate-game { animation: fate-enter 280ms cubic-bezier(.16, 1, .3, 1); }
.fate-arena {
  background:
    radial-gradient(circle at 50% 44%, rgba(139, 92, 246, .18), transparent 35%),
    linear-gradient(145deg, rgba(17, 24, 39, .96), rgba(8, 10, 24, .98));
  animation: fate-arena-enter 420ms cubic-bezier(.16, 1, .3, 1) 80ms both;
}
.fate-dialogue { animation: fate-dialogue-enter 460ms cubic-bezier(.16, 1, .3, 1) 140ms both; }
.fate-orb { background: radial-gradient(circle at 35% 30%, #fff, #a78bfa 35%, #4c1d95 75%); box-shadow: 0 0 24px rgba(167, 139, 250, .7); }
.fate-ring { box-shadow: inset 0 0 80px rgba(139, 92, 246, .06), 0 0 80px rgba(139, 92, 246, .08); animation: fate-ring-spin 24s linear infinite; }
.fate-core { z-index: 1; background: radial-gradient(circle, rgba(124, 58, 237, .18), rgba(8, 10, 24, .95) 68%); box-shadow: 0 0 80px rgba(124, 58, 237, .18); transition: all 240ms ease; }
.fate-core-thinking { animation: fate-pulse 1.8s ease-in-out infinite; }
.fate-core-firing { animation: fate-fire-kick 720ms cubic-bezier(.2, .8, .2, 1); border-color: rgba(216, 180, 254, .85); }
.fate-flash { background: radial-gradient(circle, rgba(255,255,255,.95), rgba(167,139,250,.48) 24%, transparent 68%); animation: fate-flash 720ms ease-out both; }
.fate-discharge {
  position: absolute;
  left: 50%;
  top: calc(50% - 8rem);
  z-index: 0;
  pointer-events: none;
  width: min(34vw, 27rem);
  height: .42rem;
  transform-origin: left center;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255,255,255,.98), rgba(167,139,250,.9), transparent);
  filter: drop-shadow(0 0 10px rgba(196,181,253,.9));
  animation: fate-discharge 720ms ease-out both;
}
.fate-discharge-player { transform: rotate(-151deg); }
.fate-discharge-agent { transform: rotate(-29deg); }
.fate-action { display: flex; min-height: 5rem; flex-direction: column; justify-content: center; border-radius: 1rem; border: 1px solid rgba(255,255,255,.1); padding: 1rem; text-align: left; transition: all 160ms ease; }
.fate-action:not(:disabled):hover { transform: translateY(-2px); }
.fate-action-self { background: rgba(34, 211, 238, .06); }
.fate-action-self:not(:disabled):hover { border-color: rgba(103, 232, 249, .35); background: rgba(34, 211, 238, .11); }
.fate-action-agent { background: rgba(139, 92, 246, .08); }
.fate-action-agent:not(:disabled):hover { border-color: rgba(196, 181, 253, .35); background: rgba(139, 92, 246, .14); }
.fate-action:disabled { cursor: not-allowed; opacity: .4; }
.thinking-dots::after { content: '…'; animation: fate-dots 1.4s steps(4, end) infinite; }
@keyframes fate-enter { from { opacity: 0; backdrop-filter: blur(0); } to { opacity: 1; backdrop-filter: blur(24px); } }
@keyframes fate-arena-enter { from { opacity: 0; transform: translateY(18px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes fate-dialogue-enter { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
@keyframes fate-ring-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
@keyframes fate-pulse { 50% { transform: scale(1.04); box-shadow: 0 0 110px rgba(167, 139, 250, .35); } }
@keyframes fate-fire-kick {
  0% { transform: scale(1); }
  28% { transform: scale(.9); }
  48% { transform: scale(1.1); box-shadow: 0 0 140px rgba(216,180,254,.7); }
  100% { transform: scale(1); }
}
@keyframes fate-flash {
  0%, 24% { opacity: 0; transform: scale(.5); }
  42% { opacity: 1; transform: scale(1.25); }
  100% { opacity: 0; transform: scale(1.8); }
}
@keyframes fate-discharge {
  0%, 30% { opacity: 0; clip-path: inset(0 100% 0 0); }
  43% { opacity: 1; clip-path: inset(0 0 0 0); }
  100% { opacity: 0; clip-path: inset(0 0 0 0); }
}
@keyframes fate-dots { 0% { clip-path: inset(0 100% 0 0); } 100% { clip-path: inset(0 0 0 0); } }
@media (prefers-reduced-motion: reduce) {
  .fate-game, .fate-arena, .fate-dialogue, .fate-ring, .fate-core-thinking, .fate-core-firing, .fate-flash, .fate-discharge, .thinking-dots::after { animation: none; }
}
</style>
