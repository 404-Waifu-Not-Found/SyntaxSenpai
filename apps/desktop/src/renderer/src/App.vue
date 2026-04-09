<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { builtInWaifus } from '@syntax-senpai/waifu-core'
import { useChatStore } from './stores/chat'
import { useTheme } from './composables/use-theme'
import ChatBubble from './components/ChatBubble.vue'
import AppAvatar from './components/AppAvatar.vue'
import TypingDots from './components/TypingDots.vue'
import MessageSkeleton from './components/MessageSkeleton.vue'

const store = useChatStore()
const { theme, currentRainbowHue, hslToHex, resetTheme, setColor, setRainbow, DEFAULT_THEME } = useTheme()

const rainbowToggleBg = computed(() => {
  if (!theme.value.rainbow.enabled) return 'rgb(64,64,64)'
  const h = currentRainbowHue.value
  const s = theme.value.rainbow.saturation
  const l = theme.value.rainbow.lightness
  const c1 = hslToHex(h, s, l)
  const c2 = hslToHex((h + 60) % 360, s, l)
  const c3 = hslToHex((h + 120) % 360, s, l)
  return `linear-gradient(to right, ${c1}, ${c2}, ${c3})`
})
const settingsTab = ref<'general' | 'theme'>('general')
const providerOrder = [
  'anthropic',
  'openai',
  'openai-codex',
  'deepseek',
  'gemini',
  'mistral',
  'groq',
  'minimax-global',
  'minimax-cn',
  'xai',
  'huggingface',
  'github-models',
]
const providerMetadata = [
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    models: [
      { id: 'claude-opus-4-1', displayName: 'Claude Opus 4.1' },
      { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    models: [
      { id: 'gpt-4o', displayName: 'GPT-4o' },
      { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo' },
      { id: 'gpt-4', displayName: 'GPT-4' },
    ],
  },
  {
    id: 'openai-codex',
    displayName: 'OpenAI (Codex / Web Auth)',
    models: [
      { id: 'gpt-4o', displayName: 'GPT-4o' },
      { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo' },
    ],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' },
    ],
  },
  {
    id: 'gemini',
    displayName: 'Gemini',
    models: [
      { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
    ],
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    models: [
      { id: 'mistral-large-latest', displayName: 'Mistral Large' },
      { id: 'mistral-medium-latest', displayName: 'Mistral Medium' },
      { id: 'mistral-small-latest', displayName: 'Mistral Small' },
    ],
  },
  {
    id: 'groq',
    displayName: 'Groq',
    models: [
      { id: 'llama-3.1-70b-versatile', displayName: 'Llama 3.1 70B' },
      { id: 'mixtral-8x7b-32768', displayName: 'Mixtral 8x7B' },
      { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B' },
    ],
  },
  {
    id: 'minimax-global',
    displayName: 'MiniMax Global',
    models: [
      { id: 'MiniMax-Text-01', displayName: 'MiniMax Text 01' },
      { id: 'MiniMax-M1', displayName: 'MiniMax M1' },
    ],
  },
  {
    id: 'minimax-cn',
    displayName: 'MiniMax CN',
    models: [
      { id: 'MiniMax-Text-01', displayName: 'MiniMax Text 01 (CN)' },
      { id: 'MiniMax-M1', displayName: 'MiniMax M1 (CN)' },
    ],
  },
  {
    id: 'xai',
    displayName: 'xAI',
    models: [
      { id: 'grok-2-latest', displayName: 'Grok 2' },
      { id: 'grok-vision-beta', displayName: 'Grok Vision' },
    ],
  },
  {
    id: 'huggingface',
    displayName: 'Hugging Face',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B Instruct' },
      { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', displayName: 'Qwen 2.5 Coder 32B' },
    ],
  },
  {
    id: 'github-models',
    displayName: 'GitHub Models',
    models: [
      { id: 'openai/gpt-4o-mini', displayName: 'GPT-4o Mini' },
      { id: 'meta/Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B' },
    ],
  },
]
const providers = providerOrder
  .map((id) => providerMetadata.find((provider) => provider.id === id))
  .filter(Boolean)
  .map((provider) => ({ value: provider!.id, label: provider!.displayName }))

const sidebarOpen = ref(true)
const showSettings = ref(false)
const showAgent = ref(false)
const showModelPicker = ref(false)
const providerModels = ref<Record<string, Array<{ id: string; displayName: string }>>>({})
type AgentMode = 'ask' | 'auto' | 'full'
const agentMode = computed({
  get: () => store.agentMode as AgentMode,
  set: (v: AgentMode) => store.setAgentMode(v),
})
const convSearch = ref('')
const showMemory = ref(false)
const newMemoryKey = ref('')
const newMemoryValue = ref('')
const newMemoryCategory = ref('general')
const toast = ref<{ message: string; type: 'success' | 'error'; visible: boolean }>({ message: '', type: 'success', visible: false })
const showStartupSplash = ref(true)
const appReady = ref(false)
const startupAnimDone = ref(false)
let startupSplashTimer: number | null = null

function showToast(message: string, type: 'success' | 'error') {
  toast.value = { message, type, visible: true }
  setTimeout(() => { toast.value.visible = false }, 4000)
}

const messagesEndRef = ref<HTMLDivElement>()
const inputRef = ref<HTMLTextAreaElement>()

const filteredConversations = computed(() => {
  let convs = store.conversations
  if (store.sidebarFilter === 'favorites') {
    convs = convs.filter((c: any) => c.favorited)
  }
  if (convSearch.value) {
    const q = convSearch.value.toLowerCase()
    convs = convs.filter((c: any) => (c.title || '').toLowerCase().includes(q))
  }
  return convs
})

const currentProviderMeta = computed(() =>
  providerMetadata.find((provider) => provider.id === store.selectedProvider),
)

const currentProviderModels = computed(() =>
  providerModels.value[store.selectedProvider] ||
  currentProviderMeta.value?.models ||
  [],
)

const affectionTier = computed(() => {
  const value = store.affection
  if (value <= 15) return '冰冷'
  if (value <= 30) return '疏离'
  if (value <= 45) return '普通'
  if (value <= 60) return '友好'
  if (value <= 75) return '亲近'
  if (value <= 90) return '依恋'
  return '挚爱'
})

const affectionFillStyle = computed(() => {
  return {
    width: `${store.affection}%`,
    background: rainbowToggleBg.value,
  }
})

const affectionAccentStyle = computed(() => {
  const h = currentRainbowHue.value
  const s = theme.value.rainbow.saturation
  const l = theme.value.rainbow.lightness
  const accent = hslToHex(h, s, l)
  const softAccent = hslToHex(h, Math.max(s - 10, 35), Math.min(l + 18, 84))

  return {
    borderColor: `${accent}55`,
    color: softAccent,
    boxShadow: `0 0 18px color-mix(in srgb, ${accent} 24%, transparent)`,
  }
})

const emptyStateGlowStyle = computed(() => {
  const h = currentRainbowHue.value
  const s = theme.value.rainbow.saturation
  const l = theme.value.rainbow.lightness
  const accent = theme.value.rainbow.enabled
    ? hslToHex(h, s, l)
    : theme.value.colors.primary
  const softAccent = theme.value.rainbow.enabled
    ? hslToHex(h, Math.max(s - 10, 35), Math.min(l + 18, 84))
    : accent

  return {
    color: softAccent,
    textShadow: `0 0 18px color-mix(in srgb, ${accent} 55%, transparent)`,
  }
})

const startupAccentStyle = computed(() => {
  const h = currentRainbowHue.value
  const s = theme.value.rainbow.saturation
  const l = theme.value.rainbow.lightness
  const accent = theme.value.rainbow.enabled
    ? hslToHex(h, s, l)
    : theme.value.colors.accent
  const primary = theme.value.rainbow.enabled
    ? hslToHex((h + 60) % 360, s, l)
    : theme.value.colors.primary

  return {
    background: `radial-gradient(circle at top, color-mix(in srgb, ${accent} 28%, transparent), transparent 58%), linear-gradient(135deg, color-mix(in srgb, ${primary} 26%, #05070b), #05070b 65%)`,
    color: accent,
    boxShadow: `0 0 42px color-mix(in srgb, ${accent} 30%, transparent)`,
  }
})

onMounted(() => {
  ;(async () => {
    store.loadSetup()
    await store.hydrateProviderConfig()
    await loadProviderModels(store.selectedProvider, store.apiKey)
    if (store.isSetup) {
      store.loadConversations()
      store.loadMemories()
    }
  })()

  startupSplashTimer = window.setTimeout(() => {
    showStartupSplash.value = false
    nextTick(() => { appReady.value = true })
    // Clear startup animation classes after they finish so they don't conflict with toggle transitions
    window.setTimeout(() => { startupAnimDone.value = true }, 2500)
  }, 1200)
})

onUnmounted(() => {
  if (startupSplashTimer !== null) {
    window.clearTimeout(startupSplashTimer)
  }
})

watch(() => store.messages.length, () => {
  nextTick(() => {
    messagesEndRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
})

watch(() => store.selectedProvider, async (provider, previousProvider) => {
  if (!provider || provider === previousProvider) return
  await store.hydrateProviderConfig(provider)
  await loadProviderModels(provider, store.apiKey)
})

async function loadProviderModels(provider: string, apiKeyValue: string) {
  const res = await (window as any).electron?.ipcRenderer?.invoke('provider:listModels', provider, apiKeyValue || '')
  if (res?.success && Array.isArray(res.models) && res.models.length > 0) {
    providerModels.value = {
      ...providerModels.value,
      [provider]: res.models,
    }
  }
}

function adjustInputHeight() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    store.sendMessage(store.inputValue)
  }
}

async function handleSetup(apiKeyValue: string) {
  const trimmedKey = apiKeyValue.trim()

  if (trimmedKey) {
    // Validate the API key first
    const validation = await (window as any).electron?.ipcRenderer?.invoke(
      'provider:validateKey',
      store.selectedProvider,
      trimmedKey,
    )

    if (validation && !validation.success) {
      showToast(validation.error || 'Invalid API key', 'error')
      return
    }

    if (validation?.success) {
      showToast(validation.message || 'API key is valid', 'success')
    }

    await store.saveApiKey(apiKeyValue)
    await loadProviderModels(store.selectedProvider, trimmedKey)
    const hasSelectedModel = currentProviderModels.value.some((model) => model.id === store.selectedModel)
    if (!hasSelectedModel) {
      store.selectedModel = currentProviderModels.value[0]?.id || store.selectedModel
    }
    showModelPicker.value = true
    return
  }

  await finalizeSetup(apiKeyValue)
}

async function finalizeSetup(apiKeyValue: string) {
  try {
    await store.setup(apiKeyValue, store.selectedModel)
    showModelPicker.value = false
    showSettings.value = false
  } catch (err: any) {
    alert('Setup failed: ' + (err?.message || 'Unknown error'))
  }
}

function startDemoMode() {
  localStorage.setItem('syntax-senpai-setup', JSON.stringify({
    waifuId: store.selectedWaifuId,
    provider: store.selectedProvider,
    hasSetup: true,
    demo: true,
  }))
  store.isSetup = true
  showSettings.value = false
}

function saveAgentMode(mode: AgentMode) {
  store.setAgentMode(mode)
}

async function addMemoryEntry() {
  if (!newMemoryKey.value.trim() || !newMemoryValue.value.trim()) return
  await store.setMemory(newMemoryKey.value.trim(), newMemoryValue.value.trim(), newMemoryCategory.value)
  newMemoryKey.value = ''
  newMemoryValue.value = ''
  newMemoryCategory.value = 'general'
  showToast('Memory saved', 'success')
}
</script>

<template>
  <!-- Toast Notification -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      leave-active-class="transition-all duration-300 ease-in"
      enter-from-class="-translate-y-4 opacity-0"
      leave-to-class="-translate-y-4 opacity-0"
    >
      <div
        v-if="toast.visible"
        :class="[
          'fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-lg',
          'text-sm font-semibold backdrop-blur-md',
          toast.type === 'success'
            ? 'bg-emerald-500/90 text-white'
            : 'bg-red-500/90 text-white',
        ]"
      >
        {{ toast.type === 'success' ? '200 ' : '' }}{{ toast.message }}
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-500 ease-out"
      leave-active-class="transition-all duration-700 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showStartupSplash"
        class="fixed inset-0 z-[-1] flex items-center justify-center overflow-hidden bg-neutral-950"
      >
        <div class="absolute inset-0 opacity-70" :style="startupAccentStyle" />
        <div class="absolute h-90 w-90 rounded-full border border-white/10 animate-ping opacity-20" />
        <div class="absolute h-64 w-64 rounded-full border border-white/15 animate-pulse" />
        <div class="relative flex flex-col items-center gap-4 px-8 text-center">
          <div
            class="flex h-24 w-24 items-center justify-center rounded-[2rem] border border-white/15 bg-black/35 text-4xl backdrop-blur-xl animate-[startup-float_1.4s_ease-in-out_infinite]"
            :style="startupAccentStyle"
          >
            ✨
          </div>
          <div class="space-y-2">
            <h1 class="font-display text-4xl font-bold tracking-[0.12em] text-white drop-shadow-[0_0_24px_rgba(255,255,255,0.12)]">
              SyntaxSenpai
            </h1>
            <p class="text-sm uppercase tracking-[0.28em] text-neutral-300">
              Booting Your Waifu Workspace
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Setup Screen -->
  <div
    v-if="!store.isSetup && !showSettings"
    :class="[
      'flex items-center justify-center h-screen w-screen',
      'bg-gradient-to-br from-neutral-950 to-neutral-900',
    ]"
  >
    <div class="text-center max-w-md px-6">
      <div class="text-6xl mb-6">
        ✨
      </div>
      <h1 class="text-4xl font-bold text-white mb-3 font-display">
        SyntaxSenpai
      </h1>
      <p class="text-neutral-400 mb-8">
        Your AI companion that codes with you
      </p>
      <div class="space-y-3">
        <button
          class="btn-primary w-full py-3 text-base font-bold"
          @click="showSettings = true"
        >
          Get Started
        </button>
        <button
          class="btn-secondary w-full py-3 text-base font-bold"
          @click="startDemoMode"
        >
          Try Demo Mode (no API)
        </button>
      </div>
    </div>
  </div>

  <!-- Settings Modal -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showSettings"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
        @click.self="showSettings = false"
      >
        <div class="glass-surface rounded-2xl p-6 max-w-lg w-full mx-4 animate-content-show max-h-[85vh] overflow-y-auto">
          <h2 class="text-xl font-bold text-white mb-4">
            Settings
          </h2>

          <!-- Tabs -->
          <div class="flex gap-1 mb-5 p-1 rounded-lg bg-neutral-800/40">
            <button
              :class="[
                'flex-1 text-sm font-semibold py-2 rounded-md transition-all duration-150',
                settingsTab === 'general'
                  ? 'bg-neutral-700/60 text-white'
                  : 'text-neutral-400 hover:text-neutral-200',
              ]"
              @click="settingsTab = 'general'"
            >
              General
            </button>
            <button
              :class="[
                'flex-1 text-sm font-semibold py-2 rounded-md transition-all duration-150',
                settingsTab === 'theme'
                  ? 'bg-neutral-700/60 text-white'
                  : 'text-neutral-400 hover:text-neutral-200',
              ]"
              @click="settingsTab = 'theme'"
            >
              Theme
            </button>
          </div>

          <!-- General Tab -->
          <div v-if="settingsTab === 'general'">
            <div class="mb-4">
              <label class="block text-sm font-semibold text-neutral-200 mb-2">Waifu</label>
              <select
                v-model="store.selectedWaifuId"
                class="input-field"
              >
                <option v-for="w in builtInWaifus" :key="w.id" :value="w.id">
                  {{ w.displayName }}
                </option>
              </select>
            </div>

            <div class="mb-4">
              <label class="block text-sm font-semibold text-neutral-200 mb-2">Provider</label>
              <select v-model="store.selectedProvider" class="input-field">
                <option v-for="provider in providers" :key="provider.value" :value="provider.value">
                  {{ provider.label }}
                </option>
              </select>
            </div>

            <div class="mb-6">
              <label class="block text-sm font-semibold text-neutral-200 mb-2">API Key</label>
              <input
                v-model="store.apiKey"
                type="password"
                placeholder="sk-..."
                class="input-field"
              >
            </div>

            <div class="flex gap-2">
              <button class="btn-secondary flex-1" @click="showSettings = false">
                Cancel
              </button>
              <button
                class="btn-primary flex-1"
                @click="handleSetup(store.apiKey)"
              >
                Save
              </button>
              <button class="btn-ghost flex-1" @click="startDemoMode">
                Skip (Demo)
              </button>
            </div>
          </div>

          <!-- Theme Tab -->
          <div v-if="settingsTab === 'theme'">
            <!-- Rainbow Mode -->
            <div class="mb-6 p-4 rounded-xl border border-neutral-700/40 bg-neutral-800/30">
              <div class="flex items-center justify-between mb-3">
                <div>
                  <h3 class="text-sm font-bold text-white">Rainbow Mode</h3>
                  <p class="text-xs text-neutral-400">Cycles through colors automatically</p>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-all duration-300 cursor-pointer shrink-0"
                  :style="{ background: rainbowToggleBg }"
                  @click="setRainbow({ enabled: !theme.rainbow.enabled })"
                >
                  <span
                    class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                    :style="{ transform: theme.rainbow.enabled ? 'translateX(20px)' : 'translateX(0)' }"
                  />
                </button>
              </div>

              <Transition
                enter-active-class="transition-all duration-200"
                leave-active-class="transition-all duration-150"
                enter-from-class="opacity-0 -translate-y-2"
                leave-to-class="opacity-0 -translate-y-2"
              >
                <div v-if="theme.rainbow.enabled" class="space-y-3 mt-3 pt-3 border-t border-neutral-700/40">
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <label class="text-xs font-semibold text-neutral-300">Speed</label>
                      <span class="text-xs text-neutral-500">{{ theme.rainbow.speed }}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      :value="theme.rainbow.speed"
                      class="w-full accent-purple-500"
                      @input="setRainbow({ speed: +($event.target as HTMLInputElement).value })"
                    >
                  </div>
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <label class="text-xs font-semibold text-neutral-300">Saturation</label>
                      <span class="text-xs text-neutral-500">{{ theme.rainbow.saturation }}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      :value="theme.rainbow.saturation"
                      class="w-full accent-purple-500"
                      @input="setRainbow({ saturation: +($event.target as HTMLInputElement).value })"
                    >
                  </div>
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <label class="text-xs font-semibold text-neutral-300">Lightness</label>
                      <span class="text-xs text-neutral-500">{{ theme.rainbow.lightness }}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="90"
                      :value="theme.rainbow.lightness"
                      class="w-full accent-purple-500"
                      @input="setRainbow({ lightness: +($event.target as HTMLInputElement).value })"
                    >
                  </div>
                </div>
              </Transition>
            </div>

            <!-- Color Pickers -->
            <div class="space-y-3 mb-6">
              <h3 class="text-sm font-bold text-white">Colors</h3>

              <div class="grid grid-cols-2 gap-3">
                <div v-for="(colorDef, idx) in [
                  { key: 'primary', label: 'Primary' },
                  { key: 'accent', label: 'Accent' },
                  { key: 'bg', label: 'Background' },
                  { key: 'surface', label: 'Surface' },
                  { key: 'fg', label: 'Text' },
                  { key: 'userBubble', label: 'User Bubble' },
                  { key: 'assistantBubble', label: 'AI Bubble' },
                  { key: 'surface2', label: 'Surface Alt' },
                ]" :key="idx" class="flex items-center gap-2 p-2 rounded-lg bg-neutral-800/30">
                  <div class="relative shrink-0">
                    <div
                      class="w-8 h-8 rounded-lg border-2 border-neutral-600 cursor-pointer overflow-hidden"
                      :style="{ backgroundColor: theme.colors[colorDef.key as keyof typeof theme.colors] }"
                    >
                      <input
                        type="color"
                        :value="theme.colors[colorDef.key as keyof typeof theme.colors]"
                        class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        @input="setColor(colorDef.key as any, ($event.target as HTMLInputElement).value)"
                      >
                    </div>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-xs font-semibold text-neutral-200">{{ colorDef.label }}</p>
                    <p class="text-[10px] text-neutral-500 font-mono uppercase">{{ theme.colors[colorDef.key as keyof typeof theme.colors] }}</p>
                  </div>
                </div>
              </div>

              <!-- RGB Input for primary -->
              <div class="p-3 rounded-lg bg-neutral-800/30 border border-neutral-700/30">
                <p class="text-xs font-semibold text-neutral-300 mb-2">Primary RGB</p>
                <div class="flex gap-2">
                  <div class="flex-1">
                    <label class="text-[10px] text-neutral-500 block mb-0.5">R</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      :value="parseInt(theme.colors.primary.slice(1,3), 16)"
                      class="input-field text-xs text-center py-1"
                      @input="(() => {
                        const r = +($event.target as HTMLInputElement).value
                        const g = parseInt(theme.colors.primary.slice(3,5), 16)
                        const b = parseInt(theme.colors.primary.slice(5,7), 16)
                        setColor('primary', '#' + [r,g,b].map(x => Math.max(0,Math.min(255,x)).toString(16).padStart(2,'0')).join(''))
                      })()"
                    >
                  </div>
                  <div class="flex-1">
                    <label class="text-[10px] text-neutral-500 block mb-0.5">G</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      :value="parseInt(theme.colors.primary.slice(3,5), 16)"
                      class="input-field text-xs text-center py-1"
                      @input="(() => {
                        const r = parseInt(theme.colors.primary.slice(1,3), 16)
                        const g = +($event.target as HTMLInputElement).value
                        const b = parseInt(theme.colors.primary.slice(5,7), 16)
                        setColor('primary', '#' + [r,g,b].map(x => Math.max(0,Math.min(255,x)).toString(16).padStart(2,'0')).join(''))
                      })()"
                    >
                  </div>
                  <div class="flex-1">
                    <label class="text-[10px] text-neutral-500 block mb-0.5">B</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      :value="parseInt(theme.colors.primary.slice(5,7), 16)"
                      class="input-field text-xs text-center py-1"
                      @input="(() => {
                        const r = parseInt(theme.colors.primary.slice(1,3), 16)
                        const g = parseInt(theme.colors.primary.slice(3,5), 16)
                        const b = +($event.target as HTMLInputElement).value
                        setColor('primary', '#' + [r,g,b].map(x => Math.max(0,Math.min(255,x)).toString(16).padStart(2,'0')).join(''))
                      })()"
                    >
                  </div>
                </div>
              </div>
            </div>

            <!-- Preview -->
            <div class="mb-5 p-4 rounded-xl border border-neutral-700/30 overflow-hidden"
                 :style="{ backgroundColor: theme.colors.bg }">
              <p class="text-xs font-semibold text-neutral-400 mb-2">Preview</p>
              <div class="space-y-2">
                <div class="flex justify-end">
                  <div class="px-3 py-2 rounded-xl text-xs text-white max-w-[70%]"
                       :style="{ background: `linear-gradient(to right, ${theme.colors.userBubble}, ${theme.colors.primary})` }">
                    Hey, how's it going?
                  </div>
                </div>
                <div class="flex justify-start">
                  <div class="px-3 py-2 rounded-xl text-xs max-w-[70%] border border-neutral-700/40"
                       :style="{ backgroundColor: theme.colors.assistantBubble, color: theme.colors.fg }">
                    I'm doing great! What can I help with?
                  </div>
                </div>
                <div class="flex gap-2 mt-2">
                  <div class="h-5 rounded-md text-[10px] px-2 flex items-center text-white font-semibold"
                       :style="{ backgroundColor: theme.colors.primary }">
                    Button
                  </div>
                  <div class="h-5 rounded-md text-[10px] px-2 flex items-center text-white font-semibold"
                       :style="{ backgroundColor: theme.colors.accent }">
                    Accent
                  </div>
                </div>
              </div>
            </div>

            <div class="flex gap-2">
              <button class="btn-secondary flex-1" @click="resetTheme">
                Reset Defaults
              </button>
              <button class="btn-primary flex-1" @click="showSettings = false">
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showModelPicker"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
        @click.self="showModelPicker = false"
      >
        <div class="glass-surface rounded-2xl p-6 max-w-md w-full mx-4 animate-content-show">
          <h2 class="text-xl font-bold text-white mb-2">
            Choose Model
          </h2>
          <p class="text-sm text-neutral-400 mb-5">
            Pick which model {{ providers.find((provider) => provider.value === store.selectedProvider)?.label || store.selectedProvider }} should use with this saved API key.
          </p>

          <div class="mb-6">
            <label class="block text-sm font-semibold text-neutral-200 mb-2">Model</label>
            <select v-model="store.selectedModel" class="input-field">
              <option v-for="model in currentProviderModels" :key="model.id" :value="model.id">
                {{ model.displayName }}
              </option>
            </select>
          </div>

          <div class="flex gap-2">
            <button class="btn-secondary flex-1" @click="showModelPicker = false">
              Cancel
            </button>
            <button class="btn-primary flex-1" @click="finalizeSetup(store.apiKey)">
              Save
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Agent Modal -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showAgent"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
        @click.self="showAgent = false"
      >
        <div class="glass-surface rounded-2xl p-6 max-w-md w-full mx-4 animate-content-show">
          <h2 class="text-xl font-bold text-white mb-1">
            Agent Access
          </h2>
          <p class="text-sm text-neutral-400 mb-5">
            Choose how the agent can act on your machine.
          </p>

          <div class="space-y-3 mb-6">
            <!-- Ask before running -->
            <button
              :class="[
                'w-full text-left rounded-xl p-4 border-2 transition-all duration-200',
                agentMode === 'ask'
                  ? 'border-primary-500/60 bg-primary-500/10'
                  : 'border-neutral-700/40 bg-neutral-800/30 hover:border-neutral-600/60',
              ]"
              @click="saveAgentMode('ask')"
            >
              <div class="flex items-center gap-3">
                <span class="text-xl">🔔</span>
                <div>
                  <div class="text-sm font-semibold text-white">
                    Ask before running
                  </div>
                  <div class="text-xs text-neutral-400 mt-0.5">
                    Confirm every command before it executes
                  </div>
                </div>
                <div v-if="agentMode === 'ask'" class="ml-auto w-2 h-2 rounded-full bg-primary-400" />
              </div>
            </button>

            <!-- Auto + common commands -->
            <button
              :class="[
                'w-full text-left rounded-xl p-4 border-2 transition-all duration-200',
                agentMode === 'auto'
                  ? 'border-primary-500/60 bg-primary-500/10'
                  : 'border-neutral-700/40 bg-neutral-800/30 hover:border-neutral-600/60',
              ]"
              @click="saveAgentMode('auto')"
            >
              <div class="flex items-center gap-3">
                <span class="text-xl">⚡</span>
                <div>
                  <div class="text-sm font-semibold text-white">
                    Edit automatically
                  </div>
                  <div class="text-xs text-neutral-400 mt-0.5">
                    Auto-run common commands (read, write, build) — confirm others
                  </div>
                </div>
                <div v-if="agentMode === 'auto'" class="ml-auto w-2 h-2 rounded-full bg-primary-400" />
              </div>
            </button>

            <!-- Full access -->
            <button
              :class="[
                'w-full text-left rounded-xl p-4 border-2 transition-all duration-200',
                agentMode === 'full'
                  ? 'border-red-500/60 bg-red-500/10'
                  : 'border-neutral-700/40 bg-neutral-800/30 hover:border-neutral-600/60',
              ]"
              @click="saveAgentMode('full')"
            >
              <div class="flex items-center gap-3">
                <span class="text-xl">🔓</span>
                <div>
                  <div class="text-sm font-semibold text-white">
                    Full access
                  </div>
                  <div class="text-xs text-neutral-400 mt-0.5">
                    Run any command without confirmation — use with caution
                  </div>
                </div>
                <div v-if="agentMode === 'full'" class="ml-auto w-2 h-2 rounded-full bg-red-400" />
              </div>
            </button>
          </div>

          <button class="btn-secondary w-full" @click="showAgent = false">
            Cancel
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Memory Modal -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showMemory"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
        @click.self="showMemory = false"
      >
        <div class="glass-surface rounded-2xl p-6 max-w-lg w-full mx-4 animate-content-show max-h-[80vh] flex flex-col">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-white">
              AI Memory
            </h2>
            <span class="text-xs text-neutral-400">{{ store.userMemories.length }} entries</span>
          </div>
          <p class="text-sm text-neutral-400 mb-4">
            Persistent memory the AI uses across all chats. The AI auto-saves things you share (name, preferences), or you can add entries manually.
          </p>

          <!-- Add new memory -->
          <div class="mb-4 p-3 rounded-xl bg-neutral-800/40 border border-neutral-700/40">
            <div class="flex gap-2 mb-2">
              <input
                v-model="newMemoryKey"
                placeholder="Label (e.g. favorite_language)"
                class="input-field text-sm flex-1"
              >
              <select v-model="newMemoryCategory" class="input-field text-sm w-28">
                <option value="general">General</option>
                <option value="identity">Identity</option>
                <option value="preferences">Preferences</option>
                <option value="projects">Projects</option>
                <option value="user_notes">Notes</option>
              </select>
            </div>
            <div class="flex gap-2">
              <input
                v-model="newMemoryValue"
                placeholder="Value (e.g. TypeScript)"
                class="input-field text-sm flex-1"
                @keydown.enter="addMemoryEntry"
              >
              <button class="btn-primary text-sm px-4" @click="addMemoryEntry">
                Add
              </button>
            </div>
          </div>

          <!-- Memory list -->
          <div class="flex-1 overflow-auto space-y-2 min-h-0">
            <div v-if="store.userMemories.length === 0" class="text-center text-neutral-500 text-sm py-6">
              No memories yet. Chat naturally and the AI will remember key details, or add them manually above.
            </div>
            <div
              v-for="mem in store.userMemories"
              :key="mem.key"
              class="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-neutral-800/30 border border-neutral-700/30 group"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-0.5">
                  <span class="text-xs font-semibold text-primary-400 truncate">{{ mem.key }}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-700/50 text-neutral-400">{{ mem.category }}</span>
                </div>
                <div class="text-sm text-neutral-200 truncate">{{ mem.value }}</div>
              </div>
              <button
                class="text-xs text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all duration-150 shrink-0 mt-1"
                title="Delete memory"
                @click="store.deleteMemory(mem.key)"
              >
                ✕
              </button>
            </div>
          </div>

          <div class="flex gap-2 mt-4">
            <button class="btn-secondary flex-1" @click="showMemory = false">
              Close
            </button>
            <button
              v-if="store.userMemories.length > 0"
              class="btn-ghost text-sm text-red-400 hover:text-red-300"
              @click="store.clearMemories(); showToast('All memories cleared', 'success')"
            >
              Clear All
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Main Chat Interface -->
  <div
    v-if="store.isSetup"
    :class="[
      'relative flex h-screen w-screen overflow-hidden',
      'bg-gradient-to-br from-neutral-950 to-neutral-900 text-white',
    ]"
  >
    <!-- Ambient background -->
    <div class="absolute inset-0 pointer-events-none -z-10 opacity-60">
      <div
        class="absolute inset-0"
        :style="{ background: `radial-gradient(circle at 10% 10%, rgba(var(--primary-rgb),0.12), transparent 8%), radial-gradient(circle at 90% 90%, rgba(var(--accent-rgb),0.08), transparent 18%)`, filter: 'blur(40px)' }"
      />
    </div>

    <!-- Sidebar -->
    <div
      :class="[
        'sidebar-wrapper overflow-hidden shrink-0',
        sidebarOpen ? 'sidebar-open' : 'sidebar-closed',
        !startupAnimDone && appReady ? 'app-slide-in-left' : '',
        !appReady ? 'opacity-0' : '',
      ]"
    >
      <div
        class="w-72 h-full flex flex-col p-4 glass-surface border-r border-neutral-800/40"
      >
        <h1 :class="['text-xl font-bold mb-3 themed-primary-text', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-1' : '', !appReady ? 'opacity-0' : '']">
          SyntaxSenpai
        </h1>

        <!-- New Chat button -->
        <button
          :class="['themed-new-chat-btn w-full flex items-center justify-center gap-2 px-4 py-2.5 mb-3 rounded-xl text-white font-semibold text-sm shadow-lg transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-2' : '', !appReady ? 'opacity-0' : '']"
          @click="store.newChat()"
        >
          <span class="text-base">+</span> New Chat
        </button>

        <div :class="['flex items-center gap-2 mb-3', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-3' : '', !appReady ? 'opacity-0' : '']">
          <div class="flex-1">
            <p class="text-xs text-neutral-500">
              Waifu
            </p>
            <p class="text-sm font-semibold">
              {{ store.selectedWaifu?.displayName }}
            </p>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-[10px] text-emerald-400 font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">auto-saved</span>
          </div>
        </div>

        <!-- Filter tabs: All / Favorites -->
        <div :class="['flex gap-1 mb-3 p-1 rounded-lg bg-neutral-800/40', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-4' : '', !appReady ? 'opacity-0' : '']">
          <button
            :class="[
              'flex-1 text-xs font-semibold py-1.5 rounded-md transition-all duration-150',
              store.sidebarFilter === 'all'
                ? 'bg-neutral-700/60 text-white'
                : 'text-neutral-400 hover:text-neutral-200',
            ]"
            @click="store.sidebarFilter = 'all'"
          >
            All Chats
          </button>
          <button
            :class="[
              'flex-1 text-xs font-semibold py-1.5 rounded-md transition-all duration-150',
              store.sidebarFilter === 'favorites'
                ? 'bg-neutral-700/60 text-amber-400'
                : 'text-neutral-400 hover:text-neutral-200',
            ]"
            @click="store.sidebarFilter = 'favorites'"
          >
            Favorites
          </button>
        </div>

        <input
          v-model="convSearch"
          placeholder="Search conversations..."
          :class="['input-field text-sm mb-3', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-5' : '', !appReady ? 'opacity-0' : '']"
        >

        <div :class="['flex-1 overflow-auto', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-6' : '', !appReady ? 'opacity-0' : '']">
          <p v-if="filteredConversations.length === 0" class="text-xs text-neutral-500 text-center py-4">
            {{ store.sidebarFilter === 'favorites' ? 'No favorite chats yet' : 'No conversations yet' }}
          </p>
          <ul class="space-y-1.5">
            <li
              v-for="c in filteredConversations"
              :key="c.id"
              :class="[
                'flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer group',
                'transition-all duration-160',
                store.conversationId === c.id
                  ? 'themed-active-item text-white shadow-lg'
                  : 'hover:bg-white/4 text-neutral-300',
              ]"
              @click="store.selectConversation(c.id)"
            >
              <AppAvatar :name="c.title || store.selectedWaifu?.displayName" :size="32" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold truncate">
                  {{ c.title }}
                </div>
                <div class="text-xs text-neutral-400 flex items-center gap-1">
                  {{ new Date(c.updatedAt).toLocaleString() }}
                  <span v-if="c.messageCount" class="text-neutral-500">({{ c.messageCount }})</span>
                </div>
              </div>
              <div class="flex gap-0.5 shrink-0 items-center">
                <!-- Favorite star -->
                <button
                  :class="[
                    'text-sm px-1 transition-all duration-150',
                    c.favorited
                      ? 'text-amber-400 opacity-100'
                      : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-neutral-400',
                  ]"
                  title="Toggle favorite"
                  @click.stop="store.toggleFavorite(c.id)"
                >
                  {{ c.favorited ? '★' : '☆' }}
                </button>
                <!-- Delete -->
                <button
                  class="text-xs px-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-neutral-400 hover:text-red-400 transition-all duration-150"
                  title="Delete"
                  @click.stop="store.deleteConversation(c.id)"
                >
                  ✕
                </button>
              </div>
            </li>
          </ul>
        </div>

        <div :class="['mt-3 space-y-2', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-7' : '', !appReady ? 'opacity-0' : '']">
          <button class="btn-primary themed-btn-primary w-full text-sm" @click="showAgent = true">
            Agent
          </button>
          <div class="flex gap-2">
            <button class="btn-secondary flex-1 text-sm" @click="showSettings = true">
              Settings
            </button>
            <button
              class="btn-secondary text-sm px-3"
              title="AI Memory"
              @click="showMemory = true"
            >
              🧠
            </button>
          </div>
          <button class="btn-ghost w-full text-sm" @click="sidebarOpen = false">
            Collapse
          </button>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col">
      <!-- Header -->
      <div
        :class="[
          'sticky top-0 z-20 px-6 py-3',
          'glass-surface border-b border-neutral-800/40',
          'flex items-center justify-between',
          !startupAnimDone && appReady ? 'app-slide-in-top' : '',
          !appReady ? 'opacity-0' : '',
        ]"
      >
        <div class="flex items-center gap-3 min-w-0">
          <button class="btn-ghost p-2" @click="sidebarOpen = !sidebarOpen">
            {{ sidebarOpen ? '←' : '☰' }}
          </button>
          <div class="flex items-center gap-4 min-w-0">
            <div class="min-w-0">
              <div class="text-lg font-semibold truncate">
                {{ store.selectedWaifu?.displayName }}
              </div>
              <div class="text-xs text-neutral-400 truncate">
                {{ store.selectedWaifu?.backstory?.slice(0, 60) }}
              </div>
            </div>
            <div class="w-44 shrink-0 rounded-xl border bg-neutral-900/70 px-3 py-2" :style="affectionAccentStyle">
              <div class="flex items-center justify-between text-[11px] uppercase tracking-[0.18em]">
                <span>好感度</span>
                <span>{{ store.affection }} / 100({{ affectionTier }})</span>
              </div>
              <div class="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800/90">
                <div class="h-full rounded-full transition-all duration-500 ease-out" :style="affectionFillStyle" />
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-ghost p-2" @click="showSettings = true">
            ⚙️
          </button>
          <button class="btn-ghost p-2" @click="showAgent = true">
            🤖
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div :class="['flex-1 overflow-y-auto p-4 space-y-4', !startupAnimDone && appReady ? 'app-fade-in-scale' : '', !appReady ? 'opacity-0' : '']">
        <div
          v-if="store.messages.length === 0"
          class="flex flex-col items-center justify-center h-full text-center text-neutral-400"
        >
          <div class="text-4xl mb-4" :style="emptyStateGlowStyle">
            💬
          </div>
          <h3 class="text-lg font-semibold text-white mb-2 font-display" :style="emptyStateGlowStyle">
            Chat with {{ store.selectedWaifu?.displayName }}
          </h3>
          <p class="text-sm" :style="emptyStateGlowStyle">
            Start a conversation!
          </p>
        </div>

        <TransitionGroup
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          leave-active-class="transition-all duration-200"
          leave-to-class="opacity-0 -translate-y-2"
        >
          <div
            v-for="msg in store.messages"
            :key="msg.id"
            :class="[
              'flex',
              msg.role === 'user' ? 'justify-end items-end' : 'justify-start items-start',
            ]"
          >
            <div v-if="msg.role !== 'user'" class="mr-3 shrink-0">
              <div
                class="themed-assistant-avatar w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
              >
                {{ store.selectedWaifu?.displayName?.[0] || 'A' }}
              </div>
            </div>

            <ChatBubble
              :role="msg.role"
              :content="msg.content"
              :timestamp="msg.timestamp"
              :recent="msg.id === store.recentMessageId"
              :show-copy="msg.role === 'assistant'"
            />

            <div v-if="msg.role === 'user'" class="ml-3 shrink-0">
              <div class="themed-user-avatar w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white">
                U
              </div>
            </div>
          </div>
        </TransitionGroup>

        <div v-if="store.isLoading" class="space-y-2">
          <MessageSkeleton />
          <div class="flex justify-start">
            <ChatBubble role="assistant" :show-copy="false">
              <TypingDots />
            </ChatBubble>
          </div>
        </div>

        <div ref="messagesEndRef" />
      </div>

      <!-- Input -->
      <div :class="['glass-surface border-t border-neutral-800/40 p-4', !startupAnimDone && appReady ? 'app-slide-in-bottom' : '', !appReady ? 'opacity-0' : '']">
        <div class="flex gap-3 items-end">
          <textarea
            ref="inputRef"
            v-model="store.inputValue"
            placeholder="Say something... (Press / to focus)"
            :disabled="store.isLoading"
            rows="1"
            :class="[
              'input-field flex-1 resize-none',
              'disabled:opacity-50',
            ]"
            style="max-height: 100px"
            @input="adjustInputHeight"
            @keydown="handleKeyDown"
          />
          <button
            class="btn-primary themed-btn-primary min-w-fit flex items-center justify-center gap-2"
            :disabled="!store.inputValue.trim() || store.isLoading"
            @click="store.sendMessage(store.inputValue)"
          >
            {{ store.isLoading ? '⚙️ Sending' : '➤ Send' }}
          </button>
        </div>
        <p class="text-xs text-neutral-500 mt-2">
          Press Enter to send, Shift+Enter for newline
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes startup-float {
  0%, 100% {
    transform: translateY(0) scale(1);
  }

  50% {
    transform: translateY(-6px) scale(1.03);
  }
}

/* App startup slide-in animations */
@keyframes appSlideInLeft {
  from {
    opacity: 0;
    transform: translateX(-80px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes appSlideInTop {
  from {
    opacity: 0;
    transform: translateY(-60px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes appSlideInBottom {
  from {
    opacity: 0;
    transform: translateY(80px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes appFadeInScale {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.app-slide-in-left {
  animation: appSlideInLeft 1200ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
  animation-delay: 0ms;
}

.app-slide-in-top {
  animation: appSlideInTop 1000ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
  animation-delay: 300ms;
}

.app-fade-in-scale {
  animation: appFadeInScale 1200ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
  animation-delay: 600ms;
}

.app-slide-in-bottom {
  animation: appSlideInBottom 1000ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
  animation-delay: 900ms;
}

/* Sidebar items staggered cascade */
@keyframes sidebarItemIn {
  from {
    opacity: 0;
    transform: translateX(-36px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.sidebar-item {
  animation: sidebarItemIn 800ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}

.sidebar-item-1 { animation-delay: 200ms; }
.sidebar-item-2 { animation-delay: 360ms; }
.sidebar-item-3 { animation-delay: 520ms; }
.sidebar-item-4 { animation-delay: 680ms; }
.sidebar-item-5 { animation-delay: 840ms; }
.sidebar-item-6 { animation-delay: 1000ms; }
.sidebar-item-7 { animation-delay: 1200ms; }

/* Sidebar toggle open/close — width-based so siblings animate too */
.sidebar-wrapper {
  transition: width 400ms cubic-bezier(0.25, 0.1, 0.25, 1);
}

.sidebar-open {
  width: 18rem; /* w-72 */
}

.sidebar-closed {
  width: 0;
}
</style>
