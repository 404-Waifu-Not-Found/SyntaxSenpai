<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { PhGameController, PhMaskHappy } from '@phosphor-icons/vue'
import Live2DAvatar from './Live2DAvatar.vue'
import { useIpc } from '../composables/use-ipc'
import { useI18n } from '../composables/use-i18n'

type PetSession = {
  modelPath?: string
  displayName?: string
  expression?: string
  expressionRevision?: number
  motionMap?: Record<string, string>
  renderScale?: number
}

type PetGame = 'tictactoe' | 'connect4' | 'chess' | 'gomoku' | 'fate-roulette'

const { invoke, on } = useIpc()
const { t } = useI18n()
const session = ref<PetSession | null>(null)
const menuOpen = ref(false)
const gamesOpen = ref(false)
const chatVisible = ref(true)
const copilotEnabled = ref(localStorage.getItem('syntax-senpai-warthunder-copilot-enabled') === 'true')
const opacity = ref(readOpacity())
const menuElement = ref<HTMLElement | null>(null)
const menuAnchor = ref({ x: 8, y: 28 })
const menuPosition = ref({ x: 8, y: 28 })
let removeSessionListener: (() => void) | null = null
let removeChatVisibilityListener: (() => void) | null = null
const modelWidth = Math.max(120, window.innerWidth - 12)
const modelHeight = Math.max(200, window.innerHeight - 16)
const petLabel = computed(() => session.value?.displayName || t('app.name'))

function readOpacity(): number {
  const stored = Number(localStorage.getItem('syntax-senpai-pet-bubble-opacity'))
  return Number.isFinite(stored) && stored > 0 ? Math.min(0.95, Math.max(0.15, stored)) : 0.78
}

function clampMenu() {
  if (!menuOpen.value) return
  const rect = menuElement.value?.getBoundingClientRect()
  const width = rect?.width || Math.min(272, window.innerWidth - 16)
  const height = rect?.height || Math.min(360, window.innerHeight - 16)
  menuPosition.value = {
    x: Math.min(Math.max(8, menuAnchor.value.x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, menuAnchor.value.y), Math.max(8, window.innerHeight - height - 8)),
  }
}

async function openMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  menuAnchor.value = { x: event.clientX, y: event.clientY }
  gamesOpen.value = false
  menuOpen.value = true
  await nextTick()
  clampMenu()
  menuElement.value?.focus({ preventScroll: true })
}

function closeMenu() {
  menuOpen.value = false
  gamesOpen.value = false
}

async function toggleGames() {
  gamesOpen.value = !gamesOpen.value
  await nextTick()
  clampMenu()
}

function handleOutsidePointer(event: PointerEvent) {
  const target = event.target as Element | null
  if (target?.closest('.desktop-pet-menu')) return
  closeMenu()
}

function saveOpacity(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  opacity.value = Math.min(0.95, Math.max(0.15, value))
  localStorage.setItem('syntax-senpai-pet-bubble-opacity', String(opacity.value))
  void invoke('desktop-pet:command', { type: 'set-opacity', value: opacity.value })
}

async function toggleChat() {
  const result = await invoke('desktop-pet:command', { type: 'toggle-chat' })
  chatVisible.value = !!result?.visible
  closeMenu()
}

function toggleCopilot() {
  copilotEnabled.value = !copilotEnabled.value
  localStorage.setItem('syntax-senpai-warthunder-copilot-enabled', copilotEnabled.value ? 'true' : 'false')
  void invoke('desktop-pet:command', { type: 'set-warthunder', enabled: copilotEnabled.value })
}

function launchGame(game: PetGame) {
  closeMenu()
  void invoke('desktop-pet:command', { type: 'game', game })
}

function returnToNormal() {
  closeMenu()
  void invoke('desktop-pet:command', { type: 'return-to-normal' })
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
  if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
    event.preventDefault()
    void openMenu(new MouseEvent('contextmenu', { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }))
  }
}

onMounted(async () => {
  document.documentElement.classList.add('desktop-pet-renderer')
  window.addEventListener('pointerdown', handleOutsidePointer)
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', clampMenu)
  removeSessionListener = on('desktop-pet:session', (value: PetSession | null) => { session.value = value })
  removeChatVisibilityListener = on('desktop-pet:chat-visibility', (visible: boolean) => { chatVisible.value = !!visible })
  const result = await invoke('desktop-pet:ready')
  session.value = result?.session || null
  chatVisible.value = result?.chatVisible !== false
})

onUnmounted(() => {
  document.documentElement.classList.remove('desktop-pet-renderer')
  window.removeEventListener('pointerdown', handleOutsidePointer)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', clampMenu)
  removeSessionListener?.()
  removeChatVisibilityListener?.()
})
</script>

<template>
  <main class="desktop-pet-root" :aria-label="petLabel" @contextmenu="openMenu">
    <div class="pet-drag-handle" aria-hidden="true" />
    <Live2DAvatar
      v-if="session?.modelPath"
      class="pet-avatar"
      :model-path="session.modelPath"
      :expression="session.expression || 'neutral'"
      :expression-revision="session.expressionRevision || 0"
      :motion-map="session.motionMap || {}"
      :width="modelWidth"
      :height="modelHeight"
      :model-scale="0.92"
      :render-scale="session.renderScale || 1"
    />
    <div v-else class="pet-no-model">
      <PhMaskHappy :size="30" aria-hidden="true" />
      <span>{{ t('pet.live2dNotBound') }}</span>
    </div>
    <div class="pet-name">{{ petLabel }}</div>

    <div
      v-if="menuOpen"
      ref="menuElement"
      class="desktop-pet-menu"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      role="dialog"
      :aria-label="t('pet.menu')"
      tabindex="-1"
      @contextmenu.prevent
      @pointerdown.stop
      @click.stop
      @keydown.esc.stop.prevent="closeMenu"
    >
      <div class="menu-heading">
        <span>🐾 {{ t('pet.menu') }}</span>
        <button type="button" :aria-label="t('pet.closeMenu')" @click="closeMenu">×</button>
      </div>

      <label class="menu-opacity">
        <span><span>{{ t('pet.chatBubbleOpacity') }}</span><span>{{ Math.round(opacity * 100) }}%</span></span>
        <input type="range" min="0.15" max="0.95" step="0.05" :value="opacity" :aria-label="t('pet.chatBubbleOpacity')" @input="saveOpacity">
      </label>

      <button type="button" class="menu-item" role="menuitem" @click="toggleChat">
        <span>{{ chatVisible ? t('pet.hideChat') : t('pet.showChat') }}</span>
        <span>{{ chatVisible ? '◌' : '◉' }}</span>
      </button>

      <button type="button" class="menu-item" role="menuitemcheckbox" :aria-checked="copilotEnabled" @click="toggleCopilot">
        <span>{{ t('pet.warThunderCopilot') }}</span>
        <span :class="copilotEnabled ? 'menu-on' : 'menu-muted'">{{ copilotEnabled ? t('pet.copilotOn') : t('pet.copilotOff') }}</span>
      </button>

      <button type="button" class="menu-item" :aria-expanded="gamesOpen" @click="toggleGames">
        <span class="inline-flex items-center gap-2"><PhGameController :size="16" aria-hidden="true" />{{ t('pet.miniGames') }}</span>
        <span>{{ gamesOpen ? '⌃' : '›' }}</span>
      </button>
      <div v-if="gamesOpen" class="menu-games">
        <button type="button" @click="launchGame('tictactoe')">{{ t('games.tictactoe') }}</button>
        <button type="button" @click="launchGame('connect4')">{{ t('games.connect4') }}</button>
        <button type="button" @click="launchGame('chess')">{{ t('games.chess') }}</button>
        <button type="button" @click="launchGame('gomoku')">{{ t('games.gomoku') }}</button>
        <button type="button" class="game-wide" @click="launchGame('fate-roulette')">{{ t('games.fate') }}</button>
      </div>

      <button type="button" class="menu-item menu-return" @click="returnToNormal">
        <span>{{ t('pet.returnToWindow') }}</span>
        <span aria-hidden="true">↗</span>
      </button>
    </div>
  </main>
</template>

<style>
html.desktop-pet-renderer,
html.desktop-pet-renderer body,
html.desktop-pet-renderer #desktop-pet-app {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent !important;
}

.desktop-pet-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  color: white;
  background: transparent;
  user-select: none;
  -webkit-app-region: no-drag;
}

.pet-drag-handle {
  position: absolute;
  z-index: 10;
  inset: 0 20% auto;
  height: 20px;
  -webkit-app-region: drag;
}

.pet-avatar {
  position: absolute;
  inset: 0 auto auto 50%;
  transform: translateX(-50%);
  pointer-events: none;
}

.pet-no-model {
  position: absolute;
  inset: 18px 8px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.7);
  text-align: center;
  font-size: 12px;
}

.pet-name {
  position: absolute;
  right: 8px;
  bottom: 2px;
  left: 8px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.72);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}

.desktop-pet-root:hover .pet-name { opacity: 1; }

.desktop-pet-menu {
  position: fixed;
  z-index: 100;
  box-sizing: border-box;
  width: min(272px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.17);
  border-radius: 16px;
  padding: 10px;
  background: rgba(17, 21, 33, 0.96);
  box-shadow: 0 16px 38px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(18px);
  user-select: none;
  -webkit-app-region: no-drag;
}

.menu-heading, .menu-opacity > span, .menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.menu-heading {
  padding: 2px 4px 9px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 12px;
  font-weight: 600;
}

.menu-heading button {
  color: rgba(255, 255, 255, 0.65);
  font-size: 18px;
}

.menu-opacity {
  display: block;
  margin-top: 9px;
  border-radius: 11px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.055);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.82);
}

.menu-opacity input { display: block; width: 100%; margin-top: 7px; accent-color: #a78bfa; }

.menu-item {
  width: 100%;
  min-height: 36px;
  margin-top: 4px;
  border-radius: 10px;
  padding: 7px 9px;
  color: rgba(255, 255, 255, 0.9);
  text-align: left;
  font-size: 11px;
}

.menu-item:hover, .menu-games button:hover { background: rgba(255, 255, 255, 0.08); }
.menu-on { color: #fcd34d; }
.menu-muted { color: rgba(255, 255, 255, 0.52); }

.menu-games {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  padding-left: 8px;
}

.menu-games button {
  min-width: 0;
  border-radius: 8px;
  padding: 6px 5px;
  color: rgba(255, 255, 255, 0.78);
  text-align: left;
  font-size: 10px;
}

.menu-games .game-wide { grid-column: 1 / -1; }

.menu-return {
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 9px;
  color: #fecdd3;
}
</style>
