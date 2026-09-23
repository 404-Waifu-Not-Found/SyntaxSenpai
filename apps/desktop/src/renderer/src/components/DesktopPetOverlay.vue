<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ChatBubble from './ChatBubble.vue'
import Live2DAvatar from './Live2DAvatar.vue'

const props = withDefaults(defineProps<{
  modelPath: string
  modelName?: string
  expression?: string
  expressionRevision?: number
  motionMap?: Record<string, string>
  modelWidth: number
  modelHeight: number
  modelScale: number
  modelOffsetX?: number
  modelOffsetY?: number
  renderScale?: number
  locked?: boolean
  bubbleOpacity?: number
  latestMessage?: string
  inputValue?: string
  loading?: boolean
}>(), {
  modelName: 'Desktop Pet',
  expression: 'neutral',
  expressionRevision: 0,
  modelOffsetX: 0,
  modelOffsetY: 0,
  renderScale: 1,
  locked: false,
  bubbleOpacity: 92,
  latestMessage: '',
  inputValue: '',
  loading: false,
})

const emit = defineEmits<{
  (event: 'update:inputValue', value: string): void
  (event: 'send'): void
  (event: 'update:locked', value: boolean): void
  (event: 'update:bubbleOpacity', value: number): void
  (event: 'update:modelScale', value: number): void
  (event: 'mini-game'): void
  (event: 'reset-window'): void
  (event: 'reset-layout'): void
}>()

const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuRef = ref<HTMLElement | null>(null)
const modelPosition = ref<{ x: number; y: number } | null>(null)
const dragStart = ref<{ pointerId: number; x: number; y: number; modelX: number; modelY: number } | null>(null)
const opacityOptions = [35, 55, 75, 92, 100]
let mouseMoveHandler: ((event: MouseEvent) => void) | null = null
let ignoreRequestInFlight = false

const bubbleStyle = computed(() => ({
  '--pet-bubble-opacity': String(Math.min(Math.max(props.bubbleOpacity, 0), 100) / 100),
}))

const modelStyle = computed(() => ({
  width: `${props.modelWidth}px`,
  height: `${props.modelHeight}px`,
  ...(modelPosition.value
    ? { left: `${modelPosition.value.x}px`, top: `${modelPosition.value.y}px`, right: 'auto', bottom: 'auto' }
    : {}),
}))

function beginModelDrag(event: PointerEvent) {
  if (props.locked || event.button !== 0) return
  const target = event.currentTarget as HTMLElement
  const bounds = target.getBoundingClientRect()
  modelPosition.value = { x: bounds.left, y: bounds.top }
  dragStart.value = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    modelX: bounds.left,
    modelY: bounds.top,
  }
  target.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function moveModel(event: PointerEvent) {
  if (!dragStart.value || event.pointerId !== dragStart.value.pointerId) return
  modelPosition.value = {
    x: dragStart.value.modelX + event.clientX - dragStart.value.x,
    y: dragStart.value.modelY + event.clientY - dragStart.value.y,
  }
}

function endModelDrag(event: PointerEvent) {
  if (dragStart.value?.pointerId === event.pointerId) dragStart.value = null
}

function openContextMenu(event: MouseEvent) {
  event.preventDefault()
  menuX.value = Math.min(event.clientX, window.innerWidth - 230)
  menuY.value = Math.min(event.clientY, window.innerHeight - 290)
  menuOpen.value = true
}

function closeContextMenu() {
  menuOpen.value = false
}

function send() {
  if (props.loading || !props.inputValue?.trim()) return
  emit('send')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  }
}

function changeScale(delta: number) {
  emit('update:modelScale', Math.min(Math.max(props.modelScale + delta, 0.35), 2.8))
}

async function setMouseClickThrough(ignore: boolean) {
  if (ignoreRequestInFlight) return
  ignoreRequestInFlight = true
  try {
    await (window as any).electron?.ipcRenderer?.invoke('window:setIgnoreMouseEvents', ignore)
  } finally {
    ignoreRequestInFlight = false
  }
}

function isInteractivePoint(x: number, y: number) {
  const element = document.elementFromPoint(x, y)
  return element instanceof HTMLElement && Boolean(element.closest('.desktop-pet-interactive'))
}

onMounted(() => {
  void setMouseClickThrough(true)
  mouseMoveHandler = (event) => {
    void setMouseClickThrough(!isInteractivePoint(event.clientX, event.clientY))
  }
  window.addEventListener('mousemove', mouseMoveHandler)
})

onBeforeUnmount(() => {
  if (mouseMoveHandler) window.removeEventListener('mousemove', mouseMoveHandler)
  mouseMoveHandler = null
  void setMouseClickThrough(false)
})
</script>

<template>
  <div class="desktop-pet-root fixed inset-0 z-[80] pointer-events-none select-none" @click="closeContextMenu" @pointermove="moveModel" @pointerup="endModelDrag">
    <section
      class="desktop-pet-model desktop-pet-interactive pointer-events-auto"
      :class="[locked ? 'desktop-pet-locked' : 'desktop-pet-draggable']"
      :style="modelStyle"
      @contextmenu="openContextMenu"
      @pointerdown="beginModelDrag"
    >
      <Live2DAvatar
        :model-path="modelPath"
        :expression="expression"
        :expression-revision="expressionRevision"
        :motion-map="motionMap"
        :width="modelWidth"
        :height="modelHeight"
        :model-scale="modelScale"
        :offset-x="modelOffsetX"
        :offset-y="modelOffsetY"
        :render-scale="renderScale"
      />
    </section>

    <section v-if="latestMessage || !locked" class="desktop-pet-bubble desktop-pet-interactive pointer-events-auto" :style="bubbleStyle" @click.stop>
      <div class="desktop-pet-bubble-header">
        <span>{{ modelName }}</span>
      </div>
      <ChatBubble v-if="latestMessage" :content="latestMessage" :show-copy="false" />
      <div class="desktop-pet-composer">
        <input
          :value="inputValue"
          type="text"
          :placeholder="`Chat with ${modelName}`"
          aria-label="Desktop pet message"
          :disabled="loading"
          @input="emit('update:inputValue', ($event.target as HTMLInputElement).value)"
          @keydown="handleKeydown"
        />
        <button type="button" :disabled="loading || !inputValue?.trim()" aria-label="Send message" @click="send">↵</button>
      </div>
    </section>

    <nav
      v-if="menuOpen"
      ref="menuRef"
      class="desktop-pet-menu desktop-pet-interactive pointer-events-auto"
      :style="{ left: `${menuX}px`, top: `${menuY}px` }"
      aria-label="Desktop pet menu"
      @click.stop
    >
      <button type="button" @click="emit('update:locked', !locked); closeContextMenu()">
        {{ locked ? 'Unlock position' : 'Lock position' }}
      </button>
      <label>
        <span>Bubble opacity {{ bubbleOpacity }}%</span>
        <input
          :value="bubbleOpacity"
          type="range"
          min="0"
          max="100"
          step="1"
          aria-label="Bubble opacity"
          @input="emit('update:bubbleOpacity', Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <div class="desktop-pet-menu-row">
        <button v-for="opacity in opacityOptions" :key="opacity" type="button" @click="emit('update:bubbleOpacity', opacity)">{{ opacity }}%</button>
      </div>
      <div class="desktop-pet-menu-row">
        <button type="button" @click="changeScale(-0.1)">Model -</button>
        <button type="button" @click="changeScale(0.1)">Model +</button>
      </div>
      <button type="button" @click="emit('mini-game'); closeContextMenu()">Mini game</button>
      <button type="button" @click="modelPosition = null; emit('reset-layout'); closeContextMenu()">Reset pet layout</button>
      <button type="button" @click="emit('reset-window'); closeContextMenu()">Restore normal window</button>
    </nav>
  </div>
</template>

<style scoped>
.desktop-pet-root {
  pointer-events: none;
}
.desktop-pet-model {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 1;
  overflow: visible;
  -webkit-app-region: no-drag;
}
.desktop-pet-draggable {
  cursor: grab;
}
.desktop-pet-draggable:active {
  cursor: grabbing;
}
.desktop-pet-locked {
  cursor: default;
}
.desktop-pet-bubble {
  position: absolute;
  right: min(320px, 62vw);
  bottom: 150px;
  z-index: 2;
  width: min(300px, calc(100vw - 32px));
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  background: rgba(12, 16, 24, var(--pet-bubble-opacity));
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(14px);
}
.desktop-pet-bubble-header,
.desktop-pet-menu-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.desktop-pet-bubble-header {
  justify-content: space-between;
  padding: 0 3px 7px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 11px;
  font-weight: 700;
}
.desktop-pet-bubble-header button,
.desktop-pet-menu button {
  border: 0;
  border-radius: 7px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.desktop-pet-bubble-header button:hover,
.desktop-pet-menu button:hover {
  background: rgba(255, 255, 255, 0.1);
}
.desktop-pet-composer {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.desktop-pet-composer input {
  min-width: 0;
  flex: 1;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 7px 9px;
  color: white;
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}
.desktop-pet-composer button {
  width: 32px;
  border: 0;
  border-radius: 8px;
  color: white;
  background: rgba(var(--primary-rgb), 0.85);
  cursor: pointer;
}
.desktop-pet-composer button:disabled {
  opacity: 0.45;
  cursor: default;
}
.desktop-pet-menu {
  position: fixed;
  z-index: 3;
  display: grid;
  gap: 5px;
  min-width: 210px;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  color: white;
  background: rgba(17, 23, 34, 0.96);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(14px);
  font-size: 12px;
}
.desktop-pet-menu > button,
.desktop-pet-menu label {
  padding: 7px 8px;
  text-align: left;
}
.desktop-pet-menu label {
  display: grid;
  gap: 5px;
  color: rgba(255, 255, 255, 0.75);
}
.desktop-pet-menu-row button {
  flex: 1;
  padding: 5px 3px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 10px;
}
.desktop-pet-menu input[type='range'] {
  width: 100%;
  accent-color: rgb(var(--primary-rgb));
}
</style>
