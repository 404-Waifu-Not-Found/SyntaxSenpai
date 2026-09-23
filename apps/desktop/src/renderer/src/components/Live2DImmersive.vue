<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Live2DAvatar from './Live2DAvatar.vue'

type Live2DSession = {
  modelPath: string
  displayName: string
  expression: string
  expressionRevision: number
  motionMap: Record<string, string>
  modelScale: number
}

type SpeechPayload = {
  text: string
  expression?: string
  createdAt?: number
}

const ipc = (window as any).electron?.ipcRenderer
const session = ref<Live2DSession | null>(null)
const speech = ref('')
const speechExpression = ref('neutral')
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const renderScale = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1))
const loading = ref(true)
const error = ref('')
let speechTimer: number | null = null

function handleSession(payload: Live2DSession) {
  if (!payload?.modelPath) {
    error.value = 'No Live2D model was supplied.'
    loading.value = false
    return
  }
  session.value = payload
  error.value = ''
  loading.value = false
}

function handleSpeech(payload: SpeechPayload) {
  const text = String(payload?.text || '').trim()
  if (!text) return
  speech.value = text
  speechExpression.value = String(payload.expression || 'neutral')
  if (speechTimer !== null) window.clearTimeout(speechTimer)
  const duration = Math.min(12000, Math.max(4500, text.length * 55))
  speechTimer = window.setTimeout(() => {
    speech.value = ''
    speechTimer = null
  }, duration)
}

function handleResize() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
}

function closeWindow() {
  void ipc?.invoke('live2d:closeImmersive')
}

function exitFullscreen() {
  void ipc?.invoke('live2d:exitFullscreen')
}

function handleModelError(message: string) {
  error.value = message
}

onMounted(() => {
  ipc?.on('live2d:session', handleSession)
  ipc?.on('live2d:speech', handleSpeech)
  window.addEventListener('resize', handleResize)
  void ipc?.invoke('live2d:window-ready')
})

onBeforeUnmount(() => {
  ipc?.removeListener('live2d:session', handleSession)
  ipc?.removeListener('live2d:speech', handleSpeech)
  window.removeEventListener('resize', handleResize)
  if (speechTimer !== null) window.clearTimeout(speechTimer)
})
</script>

<template>
  <main class="immersive-live2d relative min-h-screen overflow-hidden bg-[#071511] text-white">
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(19,126,94,0.24),transparent_48%)]" />

    <div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center text-sm text-white/60">
      Loading Live2D…
    </div>
    <div v-else-if="error" class="absolute inset-0 z-10 flex items-center justify-center p-8 text-center">
      <div class="max-w-xl rounded-2xl border border-red-300/20 bg-[#10241f]/90 px-8 py-6 shadow-2xl">
        <p class="text-lg font-semibold text-red-200">Live2D could not start</p>
        <p class="mt-2 text-sm leading-relaxed text-red-100/75">{{ error }}</p>
        <button class="mt-5 rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10" @click="closeWindow">
          Close window
        </button>
      </div>
    </div>

    <Live2DAvatar
      v-if="session && !error"
      class="absolute inset-0"
      :model-path="session.modelPath"
      :expression="speech ? speechExpression : session.expression"
      :expression-revision="session.expressionRevision"
      :motion-map="session.motionMap"
      :width="viewport.width"
      :height="viewport.height"
      :model-scale="session.modelScale"
      :render-scale="renderScale"
      @error="handleModelError"
    />

    <Transition name="speech-bubble">
      <div v-if="speech" class="absolute bottom-[13vh] left-1/2 z-20 w-[min(720px,78vw)] -translate-x-1/2" aria-live="polite">
        <div class="relative rounded-3xl border border-white/20 bg-[#10241f]/90 px-7 py-5 text-center text-xl leading-relaxed text-white shadow-2xl backdrop-blur-xl">
          {{ speech }}
          <div class="absolute -bottom-3 left-1/2 h-6 w-6 -translate-x-1/2 rotate-45 border-b border-r border-white/20 bg-[#10241f]/90" />
        </div>
      </div>
    </Transition>

    <div class="absolute left-6 right-6 top-5 z-30 flex items-center justify-between rounded-2xl border border-white/10 bg-[#10241f]/55 px-5 py-3 shadow-xl backdrop-blur-lg">
      <div>
        <p class="text-xs uppercase tracking-[0.24em] text-emerald-200/60">Immersive Live2D</p>
        <p class="mt-1 text-lg font-semibold text-white/90">{{ session?.displayName || 'Live2D' }}</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/10" @click="exitFullscreen">
          Exit fullscreen
        </button>
        <button class="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/10" @click="closeWindow">
          Close
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.speech-bubble-enter-active,
.speech-bubble-leave-active {
  transition: opacity 220ms ease, transform 220ms ease;
}
.speech-bubble-enter-from,
.speech-bubble-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
