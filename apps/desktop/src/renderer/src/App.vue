<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { builtInWaifus, classifySentiment, EXPRESSION_EMOJI } from '@syntax-senpai/waifu-core'
import type { Expression } from '@syntax-senpai/waifu-core'
import { unwrapExport, SchemaError } from '@syntax-senpai/storage'
import { useChatStore } from './stores/chat'
import { useTheme } from './composables/use-theme'
import { useI18n, formatLocalizedCost } from './composables/use-i18n'
import { useIpc } from './composables/use-ipc'
import { useVoice } from './composables/use-voice'
import ChatBubble from './components/ChatBubble.vue'
import AppAvatar from './components/AppAvatar.vue'
import TypingDots from './components/TypingDots.vue'
import MessageSkeleton from './components/MessageSkeleton.vue'
import QrPairModal from './components/QrPairModal.vue'
import SakuraPetals from './components/SakuraPetals.vue'

const store = useChatStore()
const { invoke, on } = useIpc()
const { theme, currentRainbowHue, hslToHex, resetTheme, setColor, setRainbow, setUI, DEFAULT_THEME } = useTheme()
const { t, locale, setLocale, localeOptions } = useI18n()
const voice = useVoice()

function sentimentEmoji(expression: Expression): string {
  return EXPRESSION_EMOJI[expression] ?? EXPRESSION_EMOJI.neutral
}

// After each new assistant message lands (streaming done), speak it in
// the waifu's voice and attach a sentiment result so the avatar mood-pip
// reflects what was just said. Fires once per finalized message.
watch(
  () => [store.messages.length, store.isLoading] as const,
  ([len, loading], prev) => {
    if (loading) return
    const prevLen = prev ? (prev as any)[0] : 0
    if (len <= prevLen) return
    const last: any = store.messages[len - 1]
    if (!last || last.role !== 'assistant' || !last.content) return
    const content = String(last.content)
    last.sentiment = classifySentiment(content)
    voice.speak(content, store.selectedWaifuId)
  },
)

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
type SettingsTabId = 'general' | 'ai' | 'data' | 'metrics' | 'theme' | 'interface' | 'mobile'
const settingsTab = ref<SettingsTabId>('general')
const settingsTabs: Array<{ id: SettingsTabId; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: '⚙️' },
  { id: 'ai', label: 'AI', icon: '🤖' },
  { id: 'data', label: 'Data', icon: '💾' },
  { id: 'metrics', label: 'Metrics', icon: '📊' },
  { id: 'theme', label: 'Theme', icon: '🎨' },
  { id: 'interface', label: 'Interface', icon: '✨' },
  { id: 'mobile', label: 'Mobile', icon: '📱' },
]

// Height-animate the settings tab body on switch. Capture the outgoing
// height before leave, measure the incoming child on enter, transition
// the wrapper from old→new px. Restored to `auto` after the transition
// so natural resizes (form fields, dynamic metrics) don't fight it.
const tabInnerRef = ref<HTMLDivElement | null>(null)
const tabHeight = ref<string>('auto')

function onTabBeforeLeave(el: Element) {
  void el
  if (tabInnerRef.value) {
    tabHeight.value = tabInnerRef.value.offsetHeight + 'px'
  }
}

function onTabEnter(el: Element, done: () => void) {
  const target = el as HTMLElement
  requestAnimationFrame(() => {
    const h = target.scrollHeight
    tabHeight.value = h + 'px'
    const timer = setTimeout(() => {
      tabHeight.value = 'auto'
      done()
    }, 320)
    target.addEventListener(
      'transitionend',
      () => {
        clearTimeout(timer)
        tabHeight.value = 'auto'
        done()
      },
      { once: true }
    )
  })
}
const showQrPair = ref(false)
const mobilePairedDevice = ref<string | null>(null)

async function checkMobilePairingStatus() {
  try {
    const status = await invoke('ws:getPairingStatus')
    if (status?.paired) {
      mobilePairedDevice.value = status.deviceName || 'Mobile Device'
    } else {
      mobilePairedDevice.value = null
    }
  } catch {
    mobilePairedDevice.value = null
  }
}
const providerOrder = [
  'anthropic',
  'openai',
  'lmstudio',
  'openai-codex',
  'deepseek',
  'gemini',
  'mistral',
  'groq',
  'cohere',
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
    id: 'lmstudio',
    displayName: 'LM Studio (Local)',
    models: [{ id: 'local-model', displayName: 'Detected Local Model' }],
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
    id: 'cohere',
    displayName: 'Cohere',
    models: [
      { id: 'command-r-plus', displayName: 'Command R Plus' },
      { id: 'command-r', displayName: 'Command R' },
      { id: 'command-a-03-2025', displayName: 'Command A' },
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

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-1': 200000,
  'claude-sonnet-4-20250514': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-opus-4-7': 200000,
  'gpt-4o': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-4o-mini': 128000,
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
  'gemini-2.0-flash': 1000000,
  'gemini-1.5-pro': 2000000,
  'gemini-1.5-flash': 1000000,
  'mistral-large-latest': 128000,
  'mistral-medium-latest': 32000,
  'mistral-small-latest': 32000,
  'llama-3.1-70b-versatile': 128000,
  'mixtral-8x7b-32768': 32768,
  'llama-3.1-8b-instant': 128000,
  'grok-2-latest': 131072,
  'MiniMax-Text-01': 1000000,
  'MiniMax-M1': 1000000,
  'command-r-plus': 128000,
  'command-r': 128000,
  'command-a-03-2025': 256000,
}

const colorPresets: Array<{
  id: string
  nameKey: string
  colors: string[]
  theme: Record<string, string>
  rainbow?: boolean
}> = [
  {
    id: 'rainbow',
    nameKey: 'preset.rainbow',
    colors: ['#ff0080', '#ffea00', '#00c2ff'],
    theme: { bg: '#0f0f0f', surface: '#111216', surface2: '#0d0f13', fg: '#ffffff', primary: '#6366f1', accent: '#ec4899', userBubble: '#4f46e5', assistantBubble: '#1a1a2e' },
    rainbow: true,
  },
  {
    id: 'default',
    nameKey: 'preset.default',
    colors: ['#6366f1', '#ec4899', '#0f0f0f'],
    theme: { bg: '#0f0f0f', surface: '#111216', surface2: '#0d0f13', fg: '#ffffff', primary: '#6366f1', accent: '#ec4899', userBubble: '#4f46e5', assistantBubble: '#1a1a2e' },
  },
  {
    id: 'ocean',
    nameKey: 'preset.ocean',
    colors: ['#0ea5e9', '#06b6d4', '#0a0f1a'],
    theme: { bg: '#0a0f1a', surface: '#0d1525', surface2: '#081018', fg: '#e0f2fe', primary: '#0ea5e9', accent: '#06b6d4', userBubble: '#0369a1', assistantBubble: '#0c1a2e' },
  },
  {
    id: 'sunset',
    nameKey: 'preset.sunset',
    colors: ['#f97316', '#ef4444', '#1a0f0a'],
    theme: { bg: '#1a0f0a', surface: '#201410', surface2: '#150d08', fg: '#fff7ed', primary: '#f97316', accent: '#ef4444', userBubble: '#c2410c', assistantBubble: '#2a1810' },
  },
  {
    id: 'emerald',
    nameKey: 'preset.emerald',
    colors: ['#10b981', '#34d399', '#0a1a14'],
    theme: { bg: '#0a1a14', surface: '#0d2018', surface2: '#081510', fg: '#ecfdf5', primary: '#10b981', accent: '#34d399', userBubble: '#047857', assistantBubble: '#0f2a1e' },
  },
  {
    id: 'rose',
    nameKey: 'preset.rose',
    colors: ['#f43f5e', '#fb7185', '#1a0a10'],
    theme: { bg: '#1a0a10', surface: '#201015', surface2: '#150810', fg: '#fff1f2', primary: '#f43f5e', accent: '#fb7185', userBubble: '#be123c', assistantBubble: '#2a1018' },
  },
  {
    id: 'cherry-blossom',
    nameKey: 'preset.cherryBlossom',
    colors: ['#f9a8d4', '#f472b6', '#ffffff'],
    theme: { bg: '#ffffff', surface: '#fff5fb', surface2: '#fde7f3', fg: '#3f1630', primary: '#f472b6', accent: '#f9a8d4', userBubble: '#db2777', assistantBubble: '#fff0f7' },
  },
  {
    id: 'lavender',
    nameKey: 'preset.lavender',
    colors: ['#a78bfa', '#c084fc', '#120f1a'],
    theme: { bg: '#120f1a', surface: '#181425', surface2: '#100d18', fg: '#f5f3ff', primary: '#a78bfa', accent: '#c084fc', userBubble: '#7c3aed', assistantBubble: '#1e1830' },
  },
  {
    id: 'amber',
    nameKey: 'preset.amber',
    colors: ['#f59e0b', '#fbbf24', '#1a150a'],
    theme: { bg: '#1a150a', surface: '#201a10', surface2: '#151008', fg: '#fffbeb', primary: '#f59e0b', accent: '#fbbf24', userBubble: '#b45309', assistantBubble: '#2a2010' },
  },
  {
    id: 'midnight',
    nameKey: 'preset.midnight',
    colors: ['#6366f1', '#818cf8', '#050510'],
    theme: { bg: '#050510', surface: '#0a0a1a', surface2: '#060612', fg: '#e0e7ff', primary: '#6366f1', accent: '#818cf8', userBubble: '#4338ca', assistantBubble: '#10102a' },
  },
  {
    id: 'light-mode',
    nameKey: 'preset.lightMode',
    colors: ['#3b82f6', '#f59e0b', '#f8fafc'],
    theme: { bg: '#ffffff', surface: '#ffffff', surface2: '#f8fafc', fg: '#1f2937', primary: '#3b82f6', accent: '#f59e0b', userBubble: '#2563eb', assistantBubble: '#ffffff' },
  },
  {
    id: 'cherry-blossom-dark',
    nameKey: 'preset.cherryBlossomDark',
    colors: ['#f472b6', '#fbcfe8', '#1a0f18'],
    theme: { bg: '#1a0f18', surface: '#231424', surface2: '#140a14', fg: '#fde3ef', primary: '#f472b6', accent: '#f9a8d4', userBubble: '#be185d', assistantBubble: '#2a1726' },
  },
  {
    id: 'dracula',
    nameKey: 'preset.dracula',
    colors: ['#bd93f9', '#ff79c6', '#282a36'],
    theme: { bg: '#282a36', surface: '#2f3142', surface2: '#21222c', fg: '#f8f8f2', primary: '#bd93f9', accent: '#ff79c6', userBubble: '#6272a4', assistantBubble: '#343746' },
  },
  {
    id: 'nord',
    nameKey: 'preset.nord',
    colors: ['#88c0d0', '#81a1c1', '#2e3440'],
    theme: { bg: '#2e3440', surface: '#3b4252', surface2: '#242933', fg: '#eceff4', primary: '#88c0d0', accent: '#81a1c1', userBubble: '#5e81ac', assistantBubble: '#434c5e' },
  },
  {
    id: 'tokyo-night',
    nameKey: 'preset.tokyoNight',
    colors: ['#7aa2f7', '#bb9af7', '#1a1b26'],
    theme: { bg: '#1a1b26', surface: '#24283b', surface2: '#16161e', fg: '#c0caf5', primary: '#7aa2f7', accent: '#bb9af7', userBubble: '#3d59a1', assistantBubble: '#292e42' },
  },
  {
    id: 'catppuccin',
    nameKey: 'preset.catppuccin',
    colors: ['#cba6f7', '#f5c2e7', '#1e1e2e'],
    theme: { bg: '#1e1e2e', surface: '#302d41', surface2: '#181825', fg: '#cdd6f4', primary: '#cba6f7', accent: '#f5c2e7', userBubble: '#7f849c', assistantBubble: '#313244' },
  },
  {
    id: 'synthwave',
    nameKey: 'preset.synthwave',
    colors: ['#f92aad', '#ff8b39', '#130c25'],
    theme: { bg: '#130c25', surface: '#1d1141', surface2: '#0c0722', fg: '#f7f7ff', primary: '#f92aad', accent: '#ff8b39', userBubble: '#c71585', assistantBubble: '#241548' },
  },
  {
    id: 'matrix',
    nameKey: 'preset.matrix',
    colors: ['#22c55e', '#4ade80', '#050a05'],
    theme: { bg: '#050a05', surface: '#0a150a', surface2: '#040804', fg: '#bbf7d0', primary: '#22c55e', accent: '#4ade80', userBubble: '#15803d', assistantBubble: '#0f1a0f' },
  },
]

function applyPreset(preset: typeof colorPresets[0]) {
  Object.entries(preset.theme).forEach(([key, value]) => {
    setColor(key as any, value)
  })
  setRainbow({ enabled: !!preset.rainbow })
}

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
const convSearchMatchIds = ref<Set<string> | null>(null)
let convSearchTimer: ReturnType<typeof setTimeout> | null = null
const showMemory = ref(false)
const agentAllowlist = ref<string[]>([])
const newAllowCmd = ref('')
const showAllowlist = ref(false)
const newMemoryKey = ref('')
const newMemoryValue = ref('')
const newMemoryCategory = ref('general')
const toast = ref<{ message: string; type: 'success' | 'error'; visible: boolean }>({ message: '', type: 'success', visible: false })
const showStartupSplash = ref(true)
const appReady = ref(false)
const startupAnimDone = ref(false)
let startupSplashTimer: number | null = null
let removeMobileChatListener: (() => void) | null = null
const THEME_STORAGE_KEY = 'syntax-senpai-theme'
const API_TELEMETRY_HISTORY_STORAGE_KEY = 'syntax-senpai-api-telemetry-history'
const KEYLESS_PROVIDERS = new Set(['lmstudio'])

function providerRequiresApiKey(provider: string) {
  return !KEYLESS_PROVIDERS.has(provider)
}

function showToast(message: string, type: 'success' | 'error') {
  toast.value = { message, type, visible: true }
  setTimeout(() => { toast.value.visible = false }, 4000)
}

const messagesEndRef = ref<HTMLDivElement>()
const inputRef = ref<HTMLTextAreaElement>()
const fileInputRef = ref<HTMLInputElement>()
const isDraggingFiles = ref(false)

async function ingestFiles(fileList: FileList | null | undefined) {
  if (!fileList || fileList.length === 0) return
  for (const file of Array.from(fileList)) {
    if (!file.type.startsWith('image/')) continue
    try {
      await store.addAttachment(file)
    } catch (err: any) {
      showToast(err?.message || t('toast.attachmentFailed'), 'error')
    }
  }
}

function handleFilePick(event: Event) {
  const input = event.target as HTMLInputElement
  ingestFiles(input.files)
  // reset so re-selecting the same file still fires @change
  input.value = ''
}

async function handlePaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items || items.length === 0) return
  const images: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) images.push(file)
    }
  }
  if (images.length === 0) return
  event.preventDefault()
  const list = new DataTransfer()
  for (const f of images) list.items.add(f)
  await ingestFiles(list.files)
}

async function handleFileDrop(event: DragEvent) {
  isDraggingFiles.value = false
  await ingestFiles(event.dataTransfer?.files)
}

const filteredConversations = computed(() => {
  let convs = [...store.conversations]
  if (store.sidebarFilter === 'favorites') {
    convs = convs.filter((c: any) => c.favorited)
  }
  if (convSearch.value) {
    if (convSearchMatchIds.value !== null) {
      convs = convs.filter((c: any) => convSearchMatchIds.value!.has(c.id))
    } else {
      const q = convSearch.value.toLowerCase()
      convs = convs.filter((c: any) => (c.title || '').toLowerCase().includes(q))
    }
  }
  return convs.sort((a: any, b: any) => {
    const favoriteDelta = Number(!!b.favorited) - Number(!!a.favorited)
    if (favoriteDelta !== 0) return favoriteDelta
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  })
})

const currentProviderMeta = computed(() =>
  providerMetadata.find((provider) => provider.id === store.selectedProvider),
)

const currentProviderModels = computed(() =>
  providerModels.value[store.selectedProvider] ||
  currentProviderMeta.value?.models ||
  [],
)

const contextWindowSize = computed(() =>
  MODEL_CONTEXT_WINDOWS[store.selectedModel] ?? 0,
)

const estimatedTokensUsed = computed(() => {
  const totalChars = store.messages.reduce((sum: number, m: any) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
    return sum + content.length
  }, 0)
  return Math.round(totalChars / 4)
})

const contextUsagePercent = computed(() => {
  if (!contextWindowSize.value || !store.messages.length) return 0
  return Math.min(100, Math.round((estimatedTokensUsed.value / contextWindowSize.value) * 100))
})

const affectionTier = computed(() => {
  const value = store.affection
  if (value <= 15) return t('affection.icy')
  if (value <= 30) return t('affection.distant')
  if (value <= 45) return t('affection.neutral')
  if (value <= 60) return t('affection.friendly')
  if (value <= 75) return t('affection.close')
  if (value <= 90) return t('affection.attached')
  return t('affection.devoted')
})

const affectionFillStyle = computed(() => {
  const fallbackGradient = `linear-gradient(to right, ${theme.value.colors.primary}, ${theme.value.colors.accent})`
  return {
    width: `${store.affection}%`,
    background: theme.value.rainbow.enabled ? rainbowToggleBg.value : fallbackGradient,
  }
})

const affectionAccentStyle = computed(() => {
  const accent = theme.value.rainbow.enabled
    ? hslToHex(currentRainbowHue.value, theme.value.rainbow.saturation, theme.value.rainbow.lightness)
    : theme.value.colors.accent
  const softAccent = theme.value.rainbow.enabled
    ? hslToHex(
        currentRainbowHue.value,
        Math.max(theme.value.rainbow.saturation - 10, 35),
        Math.min(theme.value.rainbow.lightness + 18, 84),
      )
    : theme.value.colors.primary

  return {
    borderColor: `${accent}55`,
    color: softAccent,
    boxShadow: `0 0 18px color-mix(in srgb, ${accent} 24%, transparent)`,
  }
})

const affectionMeterClass = computed(() =>
  locale.value === 'en' ? 'w-70' : 'w-52',
)

const appShellStyle = computed(() => ({
  background: `linear-gradient(135deg, ${theme.value.colors.bg}, ${theme.value.colors.surface})`,
  color: theme.value.colors.fg,
}))

const isLightTheme = computed(() =>
  ['#ffffff', '#f8fafc', '#fff5fb'].includes(theme.value.colors.bg.toLowerCase()),
)

const secondaryPanelStyle = computed(() => ({
  background: isLightTheme.value
    ? `linear-gradient(135deg, color-mix(in srgb, ${theme.value.colors.surface} 94%, ${theme.value.colors.accent} 6%), color-mix(in srgb, ${theme.value.colors.surface2} 96%, ${theme.value.colors.primary} 4%))`
    : `linear-gradient(135deg, color-mix(in srgb, ${theme.value.colors.surface} 82%, ${theme.value.colors.accent} 18%), color-mix(in srgb, ${theme.value.colors.surface2} 88%, ${theme.value.colors.primary} 12%))`,
  borderColor: isLightTheme.value
    ? `color-mix(in srgb, ${theme.value.colors.fg} 14%, transparent)`
    : `color-mix(in srgb, ${theme.value.colors.accent} 22%, transparent)`,
}))

const inputSurfaceStyle = computed(() => ({
  background: `color-mix(in srgb, ${theme.value.colors.surface2} 90%, ${theme.value.colors.accent} 10%)`,
  borderColor: isLightTheme.value
    ? `color-mix(in srgb, ${theme.value.colors.fg} 16%, transparent)`
    : `color-mix(in srgb, ${theme.value.colors.accent} 24%, transparent)`,
  color: theme.value.colors.fg,
}))

const primaryButtonStyle = computed(() => ({
  background: `linear-gradient(135deg, ${theme.value.colors.primary}, ${theme.value.colors.accent})`,
  color: '#ffffff',
  borderColor: 'transparent',
  boxShadow: `0 10px 24px color-mix(in srgb, ${theme.value.colors.primary} 26%, transparent)`,
}))

const secondaryButtonStyle = computed(() => ({
  background: `color-mix(in srgb, ${theme.value.colors.surface} 84%, ${theme.value.colors.accent} 16%)`,
  borderColor: isLightTheme.value
    ? `color-mix(in srgb, ${theme.value.colors.fg} 16%, transparent)`
    : `color-mix(in srgb, ${theme.value.colors.accent} 24%, transparent)`,
  color: theme.value.colors.fg,
}))

const ghostButtonStyle = computed(() => ({
  color: theme.value.colors.fg,
  borderColor: isLightTheme.value
    ? `color-mix(in srgb, ${theme.value.colors.fg} 14%, transparent)`
    : `color-mix(in srgb, ${theme.value.colors.accent} 18%, transparent)`,
}))

const filterTabsStyle = computed(() => ({
  background: `color-mix(in srgb, ${theme.value.colors.surface2} 88%, ${theme.value.colors.accent} 12%)`,
  borderColor: isLightTheme.value
    ? `color-mix(in srgb, ${theme.value.colors.fg} 12%, transparent)`
    : `color-mix(in srgb, ${theme.value.colors.accent} 18%, transparent)`,
}))

function filterTabStyle(active: boolean, favorite = false) {
  if (active) {
    return {
      background: favorite
        ? `color-mix(in srgb, ${theme.value.colors.accent} 32%, ${theme.value.colors.surface})`
        : `color-mix(in srgb, ${theme.value.colors.primary} 30%, ${theme.value.colors.surface})`,
      color: theme.value.colors.fg,
      boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${favorite ? theme.value.colors.accent : theme.value.colors.primary} 28%, transparent)`,
    }
  }

  return {
    color: `color-mix(in srgb, ${theme.value.colors.fg} 72%, transparent)`,
  }
}

const affectionBoxStyle = computed(() => ({
  ...affectionAccentStyle.value,
  background: `linear-gradient(135deg, color-mix(in srgb, ${theme.value.colors.surface2} 84%, ${theme.value.colors.accent} 16%), color-mix(in srgb, ${theme.value.colors.surface} 90%, ${theme.value.colors.primary} 10%))`,
}))

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

const telemetryHistory = computed(() => [...store.apiTelemetryHistory].reverse())

const telemetryStats = computed(() => {
  const history = store.apiTelemetryHistory
  if (history.length === 0) {
    return {
      latest: null,
      average: null,
      p95: null,
      fastest: null,
      slowest: null,
      alertCount: 0,
      maxMs: 1,
    }
  }

  const totals = history.map((sample) => sample.totalMs).sort((a, b) => a - b)
  const latest = history[0]?.totalMs ?? null
  const average = Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length)
  const p95 = totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))]
  const fastest = totals[0]
  const slowest = totals[totals.length - 1]
  const alertCount = history.filter((sample) => sample.alert).length
  const maxMs = Math.max(...totals, 1)

  return { latest, average, p95, fastest, slowest, alertCount, maxMs }
})

function telemetryBarHeight(totalMs: number) {
  return `${Math.max(18, Math.round((totalMs / telemetryStats.value.maxMs) * 100))}%`
}

function formatDuration(ms: number | null | undefined): { value: string; unit: string } {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return { value: '—', unit: '' }
  const abs = Math.abs(ms)
  if (abs < 1) return { value: (ms * 1000).toFixed(0), unit: 'μs' }
  if (abs < 1000) return { value: Math.round(ms).toString(), unit: 'ms' }
  if (abs < 60000) return { value: (ms / 1000).toFixed(ms < 10000 ? 2 : 1), unit: 's' }
  const mins = Math.floor(ms / 60000)
  const secs = Math.round((ms % 60000) / 1000)
  return { value: secs ? `${mins}m ${secs}s` : `${mins}m`, unit: '' }
}

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

const showShortcuts = ref(false)

function onAppError(e: Event) {
  const detail = (e as CustomEvent).detail
  const msg = typeof detail === 'string' ? detail : 'Unexpected error'
  showToast(msg, 'error')
}
function onAppRetry(e: Event) {
  const detail = (e as CustomEvent).detail
  showToast(typeof detail === 'string' ? detail : 'Retrying…', 'error')
}

function onGlobalKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  const target = e.target as HTMLElement | null
  const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

  // Esc closes the topmost modal.
  if (e.key === 'Escape') {
    if (showShortcuts.value) { showShortcuts.value = false; e.preventDefault(); return }
    if (showSettings.value) { showSettings.value = false; e.preventDefault(); return }
    if (showAgent.value) { showAgent.value = false; e.preventDefault(); return }
    if (showModelPicker.value) { showModelPicker.value = false; e.preventDefault(); return }
    if (showMemory.value) { showMemory.value = false; e.preventDefault(); return }
    if (showQrPair.value) { showQrPair.value = false; e.preventDefault(); return }
  }
  if (mod && e.key.toLowerCase() === 'k' && !isTyping) { e.preventDefault(); store.newChat() }
  if (mod && e.key === ',') { e.preventDefault(); showSettings.value = true }
  if (!isTyping && e.key === '?' && e.shiftKey) { e.preventDefault(); showShortcuts.value = !showShortcuts.value }
}

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

  removeMobileChatListener = on('mobile-chat:event', async (payload: any) => {
    store.handleExternalConversationEvent(payload)

    if (payload?.type === 'user_message' || payload?.type === 'assistant_end' || payload?.type === 'assistant_error') {
      await store.loadConversations()
    }
  })

  on('tray:new-chat', () => {
    store.newChat()
  })

  window.addEventListener('app:error', onAppError as EventListener)
  window.addEventListener('app:retry', onAppRetry as EventListener)
  window.addEventListener('keydown', onGlobalKeydown)

  startupSplashTimer = window.setTimeout(() => {
    showStartupSplash.value = false
    nextTick(() => { appReady.value = true })
    // Clear startup animation classes after they finish so they don't conflict with toggle transitions
    window.setTimeout(() => { startupAnimDone.value = true }, 2500)
  }, 1200)
})

onUnmounted(() => {
  removeMobileChatListener?.()
  window.removeEventListener('app:error', onAppError as EventListener)
  window.removeEventListener('app:retry', onAppRetry as EventListener)
  window.removeEventListener('keydown', onGlobalKeydown)
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

watch(
  () => [store.selectedProvider, store.selectedModel, store.apiKey],
  async ([provider, model, apiKey]) => {
    await invoke('ws:updateRuntimeConfig', {
      provider,
      model,
      apiKey,
    })
  },
  { immediate: true },
)

watch(() => store.apiTelemetryAlert, (alert, previous) => {
  if (!alert.active) return
  if (previous?.triggeredAt === alert.triggeredAt) return
  showToast(alert.message, 'error')
}, { deep: true })

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
  const requiresApiKey = providerRequiresApiKey(store.selectedProvider)

  if (trimmedKey || !requiresApiKey) {
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

    if (trimmedKey) {
      await store.saveApiKey(apiKeyValue)
    }
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
    showToast((err?.message || t('toast.exportFailed')), 'error')
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
  showToast(t('toast.memorySaved'), 'success')
}

function readLocalStorageJson(key: string) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function bcp47Locale(loc: string): string {
  switch (loc) {
    case 'zh': return 'zh-CN'
    case 'fr': return 'fr-FR'
    case 'ru': return 'ru-RU'
    case 'ja': return 'ja-JP'
    default:   return 'en-US'
  }
}

function currencyCodeForLocale(loc: string): string {
  switch (loc) {
    case 'zh': return 'CNY'
    case 'fr': return 'EUR'
    case 'ru': return 'RUB'
    case 'ja': return 'JPY'
    default:   return 'USD'
  }
}

function relativeTime(iso: string | number | Date | undefined): string {
  if (!iso) return ''
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'now'
  const m = Math.round(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.round(diff / 3_600_000)
  if (h < 24) return `${h}h`
  const d = Math.round(diff / 86_400_000)
  if (d < 7) return `${d}d`
  const w = Math.round(d / 7)
  if (w < 5) return `${w}w`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.round(d / 365)}y`
}

watch(convSearch, (q) => {
  if (convSearchTimer) clearTimeout(convSearchTimer)
  if (!q || q.length < 2) {
    convSearchMatchIds.value = null
    return
  }
  convSearchTimer = setTimeout(async () => {
    const res = await invoke('store:searchConversations', q)
    if (res?.success && Array.isArray(res.conversationIds)) {
      convSearchMatchIds.value = new Set(res.conversationIds)
    }
  }, 250)
})

async function exportAuditLog() {
  try {
    const res = await invoke('agent:getAudit')
    if (!res?.success || !res.content) {
      showToast('No audit log data', 'error')
      return
    }
    const blob = new Blob([res.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agent-audit-${new Date().toISOString().slice(0, 10)}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    showToast('Failed to export audit log', 'error')
  }
}

async function loadAllowlist() {
  const res = await invoke('agent:getAllowlist')
  if (res?.success) agentAllowlist.value = res.allowlist || []
}

async function addToAllowlist() {
  const cmd = newAllowCmd.value.trim()
  if (!cmd) return
  await invoke('agent:addAllow', cmd)
  newAllowCmd.value = ''
  await loadAllowlist()
}

async function removeFromAllowlist(cmd: string) {
  await invoke('agent:removeAllow', cmd)
  await loadAllowlist()
}

function exportConversationMarkdown() {
  if (store.messages.length === 0) return
  const title = store.conversations.find((c: any) => c.id === store.conversationId)?.title || 'Conversation'
  const now = new Date()
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const lines: string[] = [
    `# ${title}`,
    '',
    `_Exported ${now.toLocaleString()} • Provider: ${store.selectedProvider} • Model: ${store.selectedModel}_`,
    '',
  ]
  for (const m of store.messages) {
    if (m.id.startsWith('tool-')) {
      lines.push(`> _tool:_ ${m.content}`, '')
      continue
    }
    const who = m.role === 'user' ? '**You**' : `**${m.waifuDisplayName || store.selectedWaifu?.displayName || 'Assistant'}**`
    lines.push(`### ${who}`)
    if (m.timestamp) lines.push(`_${m.timestamp}_`)
    lines.push('', m.content, '')
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'conversation'}-${stamp}.md`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  showToast(t('toast.conversationExported'), 'success')
}

async function handleExportData() {
  try {
    const conversationsRes = await invoke('store:listConversations')
    const allConversations = conversationsRes?.success ? (conversationsRes.conversations || []) : []

    const conversations = await Promise.all(
      allConversations.map(async (conversation: any) => {
        const res = await invoke('store:getMessages', conversation.id)
        return {
          ...conversation,
          messages: res?.success ? (res.messages || []) : [],
        }
      }),
    )

    const payload = {
      schemaVersion: 1,
      app: 'SyntaxSenpai',
      exportedAt: new Date().toISOString(),
      security: {
        apiKeysIncluded: false,
        notes: [
          'API keys are stored separately in the secure keystore and are excluded from exports.',
          'The current in-memory API key field is not serialized.',
        ],
      },
      settings: {
        locale: locale.value,
        theme: theme.value,
        setup: readLocalStorageJson('syntax-senpai-setup'),
        groupChat: readLocalStorageJson('syntax-senpai-group-chat'),
        providerPreferences: readLocalStorageJson('syntax-senpai-provider-preferences'),
        agentMode: localStorage.getItem('syntax-senpai-agent-mode') || store.agentMode,
        affection: readLocalStorageJson('syntax-senpai-affection'),
        apiTelemetryHistory: readLocalStorageJson(API_TELEMETRY_HISTORY_STORAGE_KEY),
        maxToolIterations: store.maxToolIterations,
        apiSpikeThresholdMs: store.apiSpikeThresholdMs,
      },
      data: {
        selectedWaifuId: store.selectedWaifuId,
        selectedProvider: store.selectedProvider,
        selectedModel: store.selectedModel,
        conversations,
        memories: store.userMemories,
      },
    }

    const result = await invoke(
      'export:saveJson',
      payload,
      `syntax-senpai-export-${new Date().toISOString().slice(0, 10)}.json`,
    )

    if (result?.success) {
      showToast(t('toast.exportSaved'), 'success')
      return
    }

    if (!result?.canceled) {
      showToast(result?.error || t('toast.exportFailed'), 'error')
    }
  } catch (err: any) {
    showToast(err?.message || t('toast.exportFailed'), 'error')
  }
}

async function handleImportData() {
  try {
    const result = await invoke('export:openJson')
    if (!result?.success) {
      if (!result?.canceled) showToast(result?.error || t('toast.importFailed'), 'error')
      return
    }

    let payload: any
    try {
      payload = unwrapExport(result.payload)
    } catch (err) {
      if (err instanceof SchemaError) {
        showToast(err.message, 'error')
        return
      }
      throw err
    }

    const importedConversations = Array.isArray(payload?.data?.conversations) ? payload.data.conversations : []
    const importedMemories = Array.isArray(payload?.data?.memories) ? payload.data.memories : []

    const replace = await invoke('store:replaceSnapshot', {
      conversations: importedConversations,
      memories: importedMemories,
    })

    if (!replace?.success) {
      showToast(replace?.error || t('toast.importFailed'), 'error')
      return
    }

    if (payload?.settings?.locale) {
      setLocale(payload.settings.locale as any)
    }

    if (payload?.settings?.theme) {
      theme.value = {
        colors: {
          ...DEFAULT_THEME.colors,
          ...(payload.settings.theme.colors || {}),
        },
        rainbow: {
          ...DEFAULT_THEME.rainbow,
          ...(payload.settings.theme.rainbow || {}),
        },
        ui: {
          ...DEFAULT_THEME.ui,
          ...(payload.settings.theme.ui || {}),
        },
      }
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme.value))
    }

    if (payload?.settings?.setup) {
      localStorage.setItem('syntax-senpai-setup', JSON.stringify(payload.settings.setup))
    }
    if (payload?.settings?.groupChat) {
      localStorage.setItem('syntax-senpai-group-chat', JSON.stringify(payload.settings.groupChat))
      store.isGroupChat = !!payload.settings.groupChat.enabled
      store.groupWaifuIds = Array.isArray(payload.settings.groupChat.waifuIds)
        ? payload.settings.groupChat.waifuIds
        : []
    }
    if (payload?.settings?.providerPreferences) {
      localStorage.setItem('syntax-senpai-provider-preferences', JSON.stringify(payload.settings.providerPreferences))
    }
    if (payload?.settings?.agentMode) {
      store.setAgentMode(payload.settings.agentMode)
    }
    if (typeof payload?.settings?.maxToolIterations === 'number') {
      store.setMaxToolIterations(payload.settings.maxToolIterations)
    }
    if (typeof payload?.settings?.apiSpikeThresholdMs === 'number') {
      store.setApiSpikeThresholdMs(payload.settings.apiSpikeThresholdMs)
    }
    if (payload?.settings?.affection) {
      localStorage.setItem('syntax-senpai-affection', JSON.stringify(payload.settings.affection))
    }
    if (payload?.settings?.apiTelemetryHistory) {
      localStorage.setItem(API_TELEMETRY_HISTORY_STORAGE_KEY, JSON.stringify(payload.settings.apiTelemetryHistory))
      store.apiTelemetryHistory = Array.isArray(payload.settings.apiTelemetryHistory)
        ? payload.settings.apiTelemetryHistory
        : []
      const latestSample = store.apiTelemetryHistory[0]
      store.apiTelemetry = latestSample
        ? {
            lastResponseMs: latestSample.totalMs,
            lastRoundTripMs: latestSample.lastRoundTripMs,
            roundTrips: latestSample.roundTrips,
            provider: latestSample.provider,
            model: latestSample.model,
            measuredAt: latestSample.measuredAt,
          }
        : {
            lastResponseMs: null,
            lastRoundTripMs: null,
            roundTrips: 0,
            provider: '',
            model: '',
            measuredAt: null,
          }
      store.apiTelemetryAlert = latestSample?.alert
        ? {
            active: true,
            thresholdMs: store.apiSpikeThresholdMs,
            message: `${latestSample.provider} ${latestSample.model} latency spiked to ${Math.round(latestSample.totalMs)} ms`,
            triggeredAt: latestSample.measuredAt,
          }
        : {
            active: false,
            thresholdMs: store.apiSpikeThresholdMs,
            message: '',
            triggeredAt: null,
          }
    } else {
      localStorage.removeItem(API_TELEMETRY_HISTORY_STORAGE_KEY)
      store.apiTelemetryHistory = []
      store.apiTelemetry = {
        lastResponseMs: null,
        lastRoundTripMs: null,
        roundTrips: 0,
        provider: '',
        model: '',
        measuredAt: null,
      }
      store.apiTelemetryAlert = {
        active: false,
        thresholdMs: store.apiSpikeThresholdMs,
        message: '',
        triggeredAt: null,
      }
    }

    if (payload?.data?.selectedWaifuId) store.selectedWaifuId = payload.data.selectedWaifuId
    if (payload?.data?.selectedProvider) store.selectedProvider = payload.data.selectedProvider
    if (payload?.data?.selectedModel) store.selectedModel = payload.data.selectedModel

    store.messages = []
    store.conversationId = null
    await store.hydrateProviderConfig(store.selectedProvider)
    await loadProviderModels(store.selectedProvider, store.apiKey)
    await store.loadConversations()
    await store.loadMemories()

    showToast(t('toast.importSaved'), 'success')
  } catch (err: any) {
    showToast(err?.message || t('toast.importFailed'), 'error')
  }
}
</script>

<template>
  <!-- Rainbow tint overlay — blends every pixel with the cycling hue while keeping luminosity.
       Always mounted so the fade-in/out runs cleanly; visibility is driven by data-rainbow on :root. -->
  <Teleport to="body">
    <div class="rainbow-overlay" aria-hidden="true" />
  </Teleport>

  <!-- Keyboard shortcuts overlay (? toggle) -->
  <Teleport to="body">
    <Transition name="modal-backdrop">
      <div
        v-if="showShortcuts"
        class="fixed inset-0 bg-black/50 backdrop-blur-md flex items-center justify-center z-[80]"
        @click.self="showShortcuts = false"
      >
        <div class="modal-glass rounded-2xl p-6 max-w-md w-full mx-4">
          <h2 class="text-lg font-bold text-white mb-4">{{ t('shortcuts.title') }}</h2>
          <ul class="space-y-2 text-sm">
            <li class="flex items-center justify-between gap-3">
              <span class="text-neutral-300">{{ t('shortcuts.newChat') }}</span>
              <kbd class="px-2 py-0.5 rounded bg-white/10 text-xs font-mono">⌘/Ctrl K</kbd>
            </li>
            <li class="flex items-center justify-between gap-3">
              <span class="text-neutral-300">{{ t('shortcuts.openSettings') }}</span>
              <kbd class="px-2 py-0.5 rounded bg-white/10 text-xs font-mono">⌘/Ctrl ,</kbd>
            </li>
            <li class="flex items-center justify-between gap-3">
              <span class="text-neutral-300">{{ t('shortcuts.closeModal') }}</span>
              <kbd class="px-2 py-0.5 rounded bg-white/10 text-xs font-mono">Esc</kbd>
            </li>
            <li class="flex items-center justify-between gap-3">
              <span class="text-neutral-300">{{ t('shortcuts.showOverlay') }}</span>
              <kbd class="px-2 py-0.5 rounded bg-white/10 text-xs font-mono">?</kbd>
            </li>
            <li class="flex items-center justify-between gap-3">
              <span class="text-neutral-300">{{ t('shortcuts.sendMessage') }}</span>
              <kbd class="px-2 py-0.5 rounded bg-white/10 text-xs font-mono">Enter</kbd>
            </li>
            <li class="flex items-center justify-between gap-3">
              <span class="text-neutral-300">{{ t('shortcuts.newline') }}</span>
              <kbd class="px-2 py-0.5 rounded bg-white/10 text-xs font-mono">Shift Enter</kbd>
            </li>
          </ul>
          <div class="mt-5 flex justify-end">
            <button class="btn-primary" @click="showShortcuts = false">{{ t('shortcuts.gotIt') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Sakura petal overlay (fixed, behind UI content, toggled via theme.ui.petals) -->
  <Teleport to="body">
    <SakuraPetals v-if="theme.ui.petals" />
  </Teleport>

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
              {{ t('app.booting') }}
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
    ]"
    :style="appShellStyle"
  >
    <div class="text-center max-w-md px-6">
      <div class="text-6xl mb-6">
        ✨
      </div>
      <h1 class="text-4xl font-bold text-white mb-3 font-display">
        SyntaxSenpai
      </h1>
      <p class="text-neutral-400 mb-8">
        {{ t('setup.subtitle') }}
      </p>
      <div class="space-y-3">
        <button
          class="btn-primary w-full py-3 text-base font-bold"
          @click="showSettings = true"
        >
          {{ t('setup.getStarted') }}
        </button>
        <button
          class="btn-secondary w-full py-3 text-base font-bold"
          @click="startDemoMode"
        >
          {{ t('setup.demoMode') }}
        </button>
      </div>
    </div>
  </div>

  <!-- Settings Modal -->
  <Teleport to="body">
    <Transition name="modal-backdrop">
      <div
        v-if="showSettings"
        class="fixed inset-0 bg-black/50 backdrop-blur-md flex items-end sm:items-center justify-center z-50"
        @click.self="showSettings = false"
      >
          <div
            class="settings-glass relative rounded-t-3xl sm:rounded-3xl max-w-6xl w-full mx-0 sm:mx-4 max-h-[92vh] overflow-hidden flex"
          >
            <div class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent z-10" />
            <div class="pointer-events-none absolute inset-0 rounded-t-3xl sm:rounded-3xl ring-1 ring-inset ring-white/5 z-10" />

            <!-- Sidebar nav -->
            <aside class="w-56 shrink-0 border-r border-white/6 bg-black/20 flex flex-col relative">
              <div class="px-5 pt-5 pb-3 border-b border-white/5">
                <h2 class="text-base font-bold text-white">{{ t('settings.title') }}</h2>
              </div>
              <nav class="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
                <button
                  v-for="tab in settingsTabs"
                  :key="tab.id"
                  :class="['settings-nav-btn', settingsTab === tab.id && 'settings-nav-btn-active']"
                  @click="tab.id === 'mobile' ? (settingsTab = 'mobile', checkMobilePairingStatus()) : (settingsTab = tab.id)"
                >
                  <span class="text-base leading-none shrink-0">{{ tab.icon }}</span>
                  <span class="truncate">{{ tab.label }}</span>
                </button>
              </nav>
            </aside>

            <!-- Content pane -->
            <main class="flex-1 min-w-0 relative overflow-y-auto">
              <div class="p-5">
          <div
            ref="tabInnerRef"
            class="tab-wrapper"
            :style="{ height: tabHeight }"
          >
          <Transition
            name="tab-slide"
            mode="out-in"
            @before-leave="onTabBeforeLeave"
            @enter="onTabEnter"
          >
          <div :key="settingsTab">
          <!-- General Tab: language, waifu, group chat -->
          <div v-if="settingsTab === 'general'">
            <div class="mb-4">
              <label class="block text-sm font-semibold text-neutral-200 mb-2">{{ t('settings.language') }}</label>
              <select
                :value="locale"
                class="input-field"
                @change="setLocale(($event.target as HTMLSelectElement).value as any)"
              >
                <option v-for="lang in localeOptions" :key="lang.value" :value="lang.value">
                  {{ lang.label }}
                </option>
              </select>
            </div>

            <div class="mb-4">
              <label class="block text-sm font-semibold text-neutral-200 mb-2">{{ t('settings.waifu') }}</label>
              <select
                v-model="store.selectedWaifuId"
                class="input-field"
              >
                <option v-for="w in builtInWaifus" :key="w.id" :value="w.id">
                  {{ w.displayName }}
                </option>
              </select>
            </div>

            <div class="settings-card">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="text-sm font-semibold text-neutral-200">{{ t('settings.groupChat') }}</div>
                  <p class="mt-1 text-xs text-neutral-400">
                    {{ t('settings.groupChatDescription') }}
                  </p>
                </div>
                <label class="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    :checked="store.isGroupChat"
                    class="accent-violet-500"
                    @change="store.setGroupChat(($event.target as HTMLInputElement).checked)"
                  >
                  <span>{{ t('sidebar.groupToggle') }}</span>
                </label>
              </div>

              <div class="mt-4">
                <div class="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                  {{ t('settings.groupChatParticipants') }}
                </div>
                <p class="mb-3 text-[11px] text-neutral-500">
                  {{ t('settings.groupChatHint') }}
                </p>
                <div class="space-y-2">
                  <label
                    v-for="w in builtInWaifus"
                    :key="`settings-group-${w.id}`"
                    :class="[
                      'flex items-center gap-2 rounded-lg border px-3 py-2 transition-all duration-150',
                      store.groupWaifuIds.includes(w.id)
                        ? 'border-violet-500/30 bg-violet-500/10'
                        : 'border-neutral-700/40 bg-neutral-900/40 hover:bg-white/5',
                    ]"
                  >
                    <input
                      type="checkbox"
                      :checked="store.groupWaifuIds.includes(w.id)"
                      class="accent-violet-500"
                      @change="store.toggleGroupWaifu(w.id)"
                    >
                    <span class="text-sm text-neutral-200">{{ w.displayName }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- AI Tab: provider, API key -->
          <div v-if="settingsTab === 'ai'">
            <div class="mb-4">
              <label class="block text-sm font-semibold text-neutral-200 mb-2">{{ t('settings.provider') }}</label>
              <select v-model="store.selectedProvider" class="input-field">
                <option v-for="provider in providers" :key="provider.value" :value="provider.value">
                  {{ provider.label }}
                </option>
              </select>
            </div>

            <div class="mb-6">
              <label class="block text-sm font-semibold text-neutral-200 mb-2">{{ t('settings.apiKey') }}</label>
              <input
                v-model="store.apiKey"
                type="password"
                placeholder="sk-..."
                class="input-field"
              >
            </div>

            <div class="mb-6">
              <button
                class="btn-secondary w-full"
                @click="loadProviderModels(store.selectedProvider, store.apiKey)"
              >
                {{ t('settings.refreshModels') }}
              </button>
              <p class="mt-1 text-[10px] text-neutral-500 text-right">
                {{ t('settings.modelsLoaded', { count: currentProviderModels.length }) }}
              </p>
            </div>
          </div>

          <!-- Data Tab: export / import -->
          <div v-if="settingsTab === 'data'">
            <div class="settings-card">
              <div class="mb-3">
                <h3 class="text-sm font-bold text-white">{{ t('settings.exportData') }}</h3>
                <p class="text-xs text-neutral-400">
                  {{ t('settings.exportDescription') }}
                </p>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <button class="btn-secondary w-full" @click="handleExportData">
                  {{ t('settings.exportButton') }}
                </button>
                <button class="btn-secondary w-full" @click="handleImportData">
                  {{ t('settings.importButton') }}
                </button>
              </div>
              <p class="mt-3 text-[11px] text-neutral-500">
                {{ t('settings.importDescription') }}
              </p>
            </div>

            <div class="settings-card">
              <div class="mb-3">
                <h3 class="text-sm font-bold text-white">{{ t('settings.exportMarkdownTitle') }}</h3>
                <p class="text-xs text-neutral-400">
                  {{ t('settings.exportMarkdownDesc') }}
                </p>
              </div>
              <button class="btn-secondary w-full" :disabled="store.messages.length === 0" @click="exportConversationMarkdown">
                {{ t('settings.exportMarkdownButton') }}
              </button>
            </div>

            <!-- Agent audit log export -->
            <div class="settings-card">
              <div class="mb-3">
                <h3 class="text-sm font-bold text-white">Agent Audit Log</h3>
                <p class="text-xs text-neutral-400">Download a JSONL log of every command the agent has run, including outputs and timestamps.</p>
              </div>
              <button class="btn-secondary w-full" @click="exportAuditLog">
                Export Audit Log (.jsonl)
              </button>
            </div>

            <!-- Agent command allowlist -->
            <div class="settings-card">
              <div class="flex items-center justify-between mb-1">
                <div>
                  <h3 class="text-sm font-bold text-white">Command Allowlist</h3>
                  <p class="text-xs text-neutral-400">Commands the agent may run without a destructive-action dialog.</p>
                </div>
                <button
                  class="text-xs text-primary-400 hover:text-primary-300 font-semibold"
                  @click="showAllowlist = !showAllowlist; showAllowlist && loadAllowlist()"
                >
                  {{ showAllowlist ? 'Hide' : 'Manage' }}
                </button>
              </div>
              <Transition
                enter-active-class="transition-all duration-150"
                leave-active-class="transition-all duration-100"
                enter-from-class="opacity-0 -translate-y-1"
                leave-to-class="opacity-0 -translate-y-1"
              >
                <div v-if="showAllowlist" class="mt-3">
                  <div class="flex gap-2 mb-3">
                    <input
                      v-model="newAllowCmd"
                      placeholder="command name (e.g. pnpm)"
                      class="input-field text-sm flex-1"
                      @keydown.enter="addToAllowlist"
                    >
                    <button class="btn-primary text-sm px-4" @click="addToAllowlist">Add</button>
                  </div>
                  <div class="space-y-1 max-h-36 overflow-y-auto">
                    <div
                      v-for="cmd in agentAllowlist"
                      :key="cmd"
                      class="flex items-center justify-between px-3 py-1.5 rounded-lg bg-neutral-800/40 border border-neutral-700/30 group"
                    >
                      <code class="text-xs text-emerald-400 font-mono">{{ cmd }}</code>
                      <button
                        class="text-xs text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all duration-150"
                        @click="removeFromAllowlist(cmd)"
                      >
                        ✕
                      </button>
                    </div>
                    <div v-if="agentAllowlist.length === 0" class="text-xs text-neutral-500 text-center py-2">
                      No commands in allowlist
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- Metrics Tab: telemetry -->
          <div v-if="settingsTab === 'metrics'">
            <div class="settings-card">
              <div class="mb-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-bold text-white">{{ t('settings.metricsTitle') }}</h3>
                    <p class="text-xs text-neutral-400">
                      {{ t('settings.metricsDescription') }}
                    </p>
                  </div>
                  <span
                    class="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    :class="store.apiTelemetryAlert.active ? 'bg-red-500/20 text-red-200' : 'bg-emerald-500/20 text-emerald-200'"
                  >
                    {{ t('settings.metricsThreshold') }}: {{ formatDuration(store.apiSpikeThresholdMs).value }} {{ formatDuration(store.apiSpikeThresholdMs).unit }}
                  </span>
                </div>
              </div>

              <div class="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label class="rounded-xl bg-neutral-900/55 p-3 text-sm">
                  <div class="font-semibold text-neutral-200">{{ t('settings.maxIterations') }}</div>
                  <div class="mt-1 text-xs text-neutral-500">{{ t('settings.maxIterationsDescription') }}</div>
                  <input
                    class="input-field mt-3"
                    type="number"
                    min="1"
                    max="24"
                    :value="store.maxToolIterations"
                    @change="store.setMaxToolIterations(Number(($event.target as HTMLInputElement).value))"
                  >
                </label>
                <label class="rounded-xl bg-neutral-900/55 p-3 text-sm">
                  <div class="font-semibold text-neutral-200">{{ t('settings.responseThreshold') }}</div>
                  <div class="mt-1 text-xs text-neutral-500">{{ t('settings.responseThresholdDescription') }}</div>
                  <input
                    class="input-field mt-3"
                    type="number"
                    min="250"
                    max="60000"
                    step="250"
                    :value="store.apiSpikeThresholdMs"
                    @change="store.setApiSpikeThresholdMs(Number(($event.target as HTMLInputElement).value))"
                  >
                </label>
              </div>

              <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div class="rounded-xl bg-neutral-900/55 p-3">
                  <div class="text-[11px] uppercase tracking-[0.16em] text-neutral-500">{{ t('settings.metricsLatest') }}</div>
                  <div class="mt-2 text-xl font-bold text-white">{{ formatDuration(telemetryStats.latest).value }}<span v-if="telemetryStats.latest !== null" class="ml-1 text-xs text-neutral-400">{{ formatDuration(telemetryStats.latest).unit }}</span></div>
                </div>
                <div class="rounded-xl bg-neutral-900/55 p-3">
                  <div class="text-[11px] uppercase tracking-[0.16em] text-neutral-500">{{ t('settings.metricsAverage') }}</div>
                  <div class="mt-2 text-xl font-bold text-white">{{ formatDuration(telemetryStats.average).value }}<span v-if="telemetryStats.average !== null" class="ml-1 text-xs text-neutral-400">{{ formatDuration(telemetryStats.average).unit }}</span></div>
                </div>
                <div class="rounded-xl bg-neutral-900/55 p-3">
                  <div class="text-[11px] uppercase tracking-[0.16em] text-neutral-500">{{ t('settings.metricsP95') }}</div>
                  <div class="mt-2 text-xl font-bold text-white">{{ formatDuration(telemetryStats.p95).value }}<span v-if="telemetryStats.p95 !== null" class="ml-1 text-xs text-neutral-400">{{ formatDuration(telemetryStats.p95).unit }}</span></div>
                </div>
                <div class="rounded-xl bg-neutral-900/55 p-3">
                  <div class="text-[11px] uppercase tracking-[0.16em] text-neutral-500">{{ t('settings.metricsAlerts') }}</div>
                  <div class="mt-2 text-xl font-bold" :class="store.apiTelemetryAlert.active ? 'text-red-300' : 'text-white'">{{ telemetryStats.alertCount }}</div>
                </div>
              </div>

              <div class="mt-4 rounded-xl bg-neutral-900/55 p-3">
                <div class="mb-3 flex items-center justify-between">
                  <div class="text-[11px] uppercase tracking-[0.16em] text-neutral-500">{{ t('settings.metricsHistory') }}</div>
                  <div v-if="store.apiTelemetryAlert.active" class="text-xs font-semibold text-red-300">
                    {{ store.apiTelemetryAlert.message }}
                  </div>
                </div>

                <div v-if="telemetryHistory.length > 0" class="space-y-3">
                  <div class="flex h-24 items-end gap-2">
                    <div
                      v-for="sample in telemetryHistory.slice(-16)"
                      :key="sample.id"
                      class="flex-1 rounded-t-md transition-all"
                      :class="sample.alert ? 'bg-red-400/80' : 'bg-cyan-400/80'"
                      :style="{ height: telemetryBarHeight(sample.totalMs) }"
                      :title="`${sample.provider} ${sample.model}: ${formatDuration(sample.totalMs).value} ${formatDuration(sample.totalMs).unit}`"
                    />
                  </div>
                  <div class="max-h-36 space-y-2 overflow-y-auto pr-1">
                    <div
                      v-for="sample in store.apiTelemetryHistory.slice(0, 6)"
                      :key="sample.id"
                      class="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-xs"
                    >
                      <div class="min-w-0">
                        <div class="truncate font-semibold text-neutral-200">{{ sample.provider }} · {{ sample.model }}</div>
                        <div class="text-neutral-500">{{ new Date(sample.measuredAt).toLocaleTimeString() }}</div>
                      </div>
                      <div class="ml-3 text-right">
                        <div :class="sample.alert ? 'text-red-300' : 'text-cyan-200'">{{ formatDuration(sample.totalMs).value }} {{ formatDuration(sample.totalMs).unit }}</div>
                        <div class="text-neutral-500">{{ sample.roundTrips }} calls</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-else class="py-4 text-sm text-neutral-500">
                  {{ t('settings.metricsEmpty') }}
                </div>
              </div>
            </div>
          </div>

          <!-- Shared Save/Cancel footer for General/AI/Data/Metrics -->
          <div
            v-if="['general', 'ai', 'data', 'metrics'].includes(settingsTab)"
            class="flex gap-2"
          >
            <button class="btn-secondary flex-1" @click="showSettings = false">
              {{ t('settings.cancel') }}
            </button>
            <button
              class="btn-primary flex-1"
              @click="handleSetup(store.apiKey)"
            >
              {{ t('settings.save') }}
            </button>
            <button class="btn-ghost flex-1" @click="startDemoMode">
              {{ t('settings.skipDemo') }}
            </button>
          </div>

          <!-- Theme Tab -->
          <div v-if="settingsTab === 'theme'">
            <!-- Color Presets -->
            <div class="settings-card">
              <div class="mb-3">
                <h3 class="text-sm font-bold text-white">{{ t('theme.presets') }}</h3>
                <p class="text-xs text-neutral-400">{{ t('theme.presetsDesc') }}</p>
              </div>

              <div class="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                <button
                  v-for="preset in colorPresets"
                  :key="preset.id"
                  :class="[
                    'rounded-lg border p-1.5 text-left transition-colors duration-150',
                    (preset.rainbow ? theme.rainbow.enabled : !theme.rainbow.enabled && theme.colors.primary === preset.theme.primary && theme.colors.bg === preset.theme.bg)
                      ? 'border-primary-500/60 bg-primary-500/10'
                      : 'border-neutral-700/30 bg-neutral-900/40 hover:border-primary-500/50 hover:bg-neutral-800/60',
                  ]"
                  :title="preset.rainbow ? t('preset.rainbow') : `${preset.theme.primary} / ${preset.theme.accent}`"
                  @click="applyPreset(preset)"
                >
                  <div
                    class="h-9 w-full rounded-md mb-1.5 border border-white/5"
                    :style="{
                      background: preset.rainbow
                        ? 'linear-gradient(135deg,#ff0080,#ff8a00,#ffea00,#00c853,#00c2ff,#7928ca,#ff0080)'
                        : `linear-gradient(135deg, ${preset.colors[0]}, ${preset.colors[1]} 55%, ${preset.colors[2]})`,
                    }"
                  />
                  <div class="text-[11px] font-semibold text-neutral-100 truncate leading-tight">
                    {{ t(preset.nameKey) }}
                  </div>
                </button>
              </div>
            </div>

            <!-- Rainbow tuning — only visible when the Rainbow theme is active -->
            <Transition
              enter-active-class="transition-all duration-200"
              leave-active-class="transition-all duration-150"
              enter-from-class="opacity-0 -translate-y-2"
              leave-to-class="opacity-0 -translate-y-2"
            >
              <div v-if="theme.rainbow.enabled" class="settings-card">
                <div class="mb-2 flex items-center justify-between">
                  <h3 class="settings-section-title">{{ t('theme.rainbowMode') }}</h3>
                  <div class="h-2 w-16 rounded-full" :style="{ background: rainbowToggleBg }" />
                </div>
                <div class="grid grid-cols-3 gap-3">
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <label class="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{{ t('theme.speed') }}</label>
                      <span class="text-[10px] text-neutral-500 font-mono">{{ theme.rainbow.speed }}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      :value="theme.rainbow.speed"
                      class="w-full accent-primary-500"
                      @input="setRainbow({ speed: +($event.target as HTMLInputElement).value })"
                    >
                  </div>
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <label class="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{{ t('theme.saturation') }}</label>
                      <span class="text-[10px] text-neutral-500 font-mono">{{ theme.rainbow.saturation }}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      :value="theme.rainbow.saturation"
                      class="w-full accent-primary-500"
                      @input="setRainbow({ saturation: +($event.target as HTMLInputElement).value })"
                    >
                  </div>
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <label class="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{{ t('theme.lightness') }}</label>
                      <span class="text-[10px] text-neutral-500 font-mono">{{ theme.rainbow.lightness }}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="90"
                      :value="theme.rainbow.lightness"
                      class="w-full accent-primary-500"
                      @input="setRainbow({ lightness: +($event.target as HTMLInputElement).value })"
                    >
                  </div>
                </div>
              </div>
            </Transition>

            <!-- Color Pickers -->
            <div class="space-y-3 mb-6">
              <h3 class="text-sm font-bold text-white">{{ t('theme.colors') }}</h3>

              <div class="grid grid-cols-2 gap-3">
                <div v-for="(colorDef, idx) in [
                  { key: 'primary', label: t('theme.primary') },
                  { key: 'accent', label: t('theme.accent') },
                  { key: 'bg', label: t('theme.background') },
                  { key: 'surface', label: t('theme.surface') },
                  { key: 'fg', label: t('theme.text') },
                  { key: 'userBubble', label: t('theme.userBubble') },
                  { key: 'assistantBubble', label: t('theme.aiBubble') },
                  { key: 'surface2', label: t('theme.surfaceAlt') },
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
                <p class="text-xs font-semibold text-neutral-300 mb-2">{{ t('theme.primaryRgb') }}</p>
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
              <p class="text-xs font-semibold text-neutral-400 mb-2">{{ t('theme.preview') }}</p>
              <div class="space-y-2">
                <div class="flex justify-end">
                  <div class="px-3 py-2 rounded-xl text-xs text-white max-w-[70%]"
                       :style="{ background: `linear-gradient(to right, ${theme.colors.userBubble}, ${theme.colors.primary})` }">
                    {{ t('theme.previewUser') }}
                  </div>
                </div>
                <div class="flex justify-start">
                  <div class="px-3 py-2 rounded-xl text-xs max-w-[70%] border border-neutral-700/40"
                       :style="{ backgroundColor: theme.colors.assistantBubble, color: theme.colors.fg }">
                    {{ t('theme.previewAi') }}
                  </div>
                </div>
                <div class="flex gap-2 mt-2">
                  <div class="h-5 rounded-md text-[10px] px-2 flex items-center text-white font-semibold"
                       :style="{ backgroundColor: theme.colors.primary }">
                    {{ t('theme.button') }}
                  </div>
                  <div class="h-5 rounded-md text-[10px] px-2 flex items-center text-white font-semibold"
                       :style="{ backgroundColor: theme.colors.accent }">
                    {{ t('theme.accent') }}
                  </div>
                </div>
              </div>
            </div>

            <div class="flex gap-2">
              <button class="btn-secondary flex-1" @click="resetTheme">
                {{ t('theme.resetDefaults') }}
              </button>
              <button class="btn-primary flex-1" @click="showSettings = false">
                {{ t('theme.done') }}
              </button>
            </div>
          </div>

          <!-- Interface Tab: density, radius, blur, petals -->
          <div v-if="settingsTab === 'interface'">
            <div class="settings-card">
              <h3 class="text-sm font-bold text-white">{{ t('interface.density') }}</h3>
              <p class="text-xs text-neutral-400 mb-3">{{ t('interface.densityDesc') }}</p>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="opt in [
                    { value: 'cozy', label: t('interface.densityCozy') },
                    { value: 'compact', label: t('interface.densityCompact') },
                  ]"
                  :key="opt.value"
                  :class="[
                    'rounded-lg py-2 text-xs font-semibold transition-colors border',
                    theme.ui.density === opt.value
                      ? 'bg-primary-500/25 border-primary-500/50 text-white'
                      : 'bg-neutral-900/50 border-neutral-700/40 text-neutral-300 hover:bg-neutral-800/70',
                  ]"
                  @click="setUI({ density: opt.value as any })"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <div class="settings-card">
              <h3 class="text-sm font-bold text-white">{{ t('interface.radius') }}</h3>
              <p class="text-xs text-neutral-400 mb-3">{{ t('interface.radiusDesc') }}</p>
              <div class="grid grid-cols-3 gap-2">
                <button
                  v-for="opt in [
                    { value: 'sharp', label: t('interface.radiusSharp'), radius: '2px' },
                    { value: 'default', label: t('interface.radiusDefault'), radius: '10px' },
                    { value: 'rounded', label: t('interface.radiusRounded'), radius: '18px' },
                  ]"
                  :key="opt.value"
                  :class="[
                    'py-3 text-xs font-semibold transition-colors border',
                    theme.ui.radius === opt.value
                      ? 'bg-primary-500/25 border-primary-500/50 text-white'
                      : 'bg-neutral-900/50 border-neutral-700/40 text-neutral-300 hover:bg-neutral-800/70',
                  ]"
                  :style="{ borderRadius: opt.radius }"
                  @click="setUI({ radius: opt.value as any })"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <div class="settings-card">
              <div class="flex items-center justify-between mb-1">
                <h3 class="text-sm font-bold text-white">{{ t('interface.blur') }}</h3>
                <span class="text-xs text-neutral-500 font-mono">{{ theme.ui.blur }}px</span>
              </div>
              <p class="text-xs text-neutral-400 mb-3">{{ t('interface.blurDesc') }}</p>
              <input
                type="range"
                min="0"
                max="40"
                :value="theme.ui.blur"
                class="w-full accent-primary-500"
                @input="setUI({ blur: Number(($event.target as HTMLInputElement).value) })"
              >
            </div>

            <div class="settings-card">
              <div class="flex items-center justify-between mb-1">
                <div>
                  <h3 class="text-sm font-bold text-white">{{ t('interface.petals') }}</h3>
                  <p class="text-xs text-neutral-400">{{ t('interface.petalsDesc') }}</p>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-all duration-300 cursor-pointer shrink-0"
                  :style="{ background: theme.ui.petals ? 'linear-gradient(90deg,#f472b6,#f9a8d4)' : '#404040' }"
                  @click="setUI({ petals: !theme.ui.petals })"
                >
                  <span
                    class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                    :style="{ transform: theme.ui.petals ? 'translateX(20px)' : 'translateX(0)' }"
                  />
                </button>
              </div>
            </div>

            <div v-if="voice.supported" class="settings-card">
              <div class="flex items-center justify-between mb-1">
                <div>
                  <h3 class="text-sm font-bold text-white">Waifu voice (TTS)</h3>
                  <p class="text-xs text-neutral-400">Reads assistant replies aloud using a per-waifu voice profile.</p>
                </div>
                <button
                  aria-label="Toggle waifu voice"
                  class="relative w-11 h-6 rounded-full transition-all duration-300 cursor-pointer shrink-0"
                  :style="{ background: voice.enabled.value ? 'linear-gradient(90deg,#60a5fa,#a78bfa)' : '#404040' }"
                  @click="voice.setEnabled(!voice.enabled.value)"
                >
                  <span
                    class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                    :style="{ transform: voice.enabled.value ? 'translateX(20px)' : 'translateX(0)' }"
                  />
                </button>
              </div>
              <p v-if="voice.enabled.value && voice.voices.value.length === 0" class="text-xs text-amber-400 mt-2">
                No voices are installed on this system. Install a system voice pack or leave this off.
              </p>
            </div>

            <div class="flex gap-2">
              <button class="btn-secondary flex-1" @click="resetTheme">
                {{ t('theme.resetDefaults') }}
              </button>
              <button class="btn-primary flex-1" @click="showSettings = false">
                {{ t('theme.done') }}
              </button>
            </div>
          </div>

          <!-- Mobile Tab -->
          <div v-if="settingsTab === 'mobile'">
            <!-- Connection Status -->
            <div class="settings-card">
              <h3 class="text-sm font-bold text-white mb-1">{{ t('mobile.title') }}</h3>
              <p class="text-xs text-neutral-400 mb-4">{{ t('mobile.description') }}</p>

              <div class="flex items-center gap-2 mb-4">
                <div
                  class="w-2.5 h-2.5 rounded-full"
                  :class="mobilePairedDevice ? 'bg-emerald-400' : 'bg-neutral-600'"
                />
                <span class="text-sm text-neutral-300">
                  {{ mobilePairedDevice ? t('mobile.connected', { device: mobilePairedDevice }) : t('mobile.noDevice') }}
                </span>
              </div>

              <div class="flex gap-2">
                <button class="btn-primary flex-1" @click="showQrPair = true; showSettings = false">
                  {{ t('mobile.showQr') }}
                </button>
                <button
                  v-if="mobilePairedDevice"
                  class="btn-secondary flex-1"
                  @click="invoke('ws:stop').then(() => { mobilePairedDevice = null })"
                >
                  {{ t('mobile.disconnect') }}
                </button>
              </div>
            </div>

            <div class="flex gap-2">
              <button class="btn-primary flex-1" @click="showSettings = false">{{ t('mobile.done') }}</button>
            </div>
          </div>
          </div>
          </Transition>
          </div>
              </div>
            </main>
          </div>
      </div>
    </Transition>
  </Teleport>

  <!-- QR Pair Modal -->
  <QrPairModal :visible="showQrPair" @close="showQrPair = false; checkMobilePairingStatus()" />

  <Teleport to="body">
    <Transition name="modal-backdrop">
      <div
        v-if="showModelPicker"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50"
        @click.self="showModelPicker = false"
      >
        <div class="modal-glass rounded-t-3xl sm:rounded-2xl p-6 max-w-md w-full mx-0 sm:mx-4">
          <h2 class="text-xl font-bold text-white mb-2">
            {{ t('model.title') }}
          </h2>
          <p class="text-sm text-neutral-400 mb-5">
            {{ t('model.description', { provider: providers.find((provider) => provider.value === store.selectedProvider)?.label || store.selectedProvider }) }}
          </p>

          <div class="mb-6">
            <label class="block text-sm font-semibold text-neutral-200 mb-2">{{ t('model.label') }}</label>
            <select v-model="store.selectedModel" class="input-field">
              <option v-for="model in currentProviderModels" :key="model.id" :value="model.id">
                {{ model.displayName }}
              </option>
            </select>
          </div>

          <div class="flex gap-2">
            <button class="btn-secondary flex-1" @click="showModelPicker = false">
              {{ t('settings.cancel') }}
            </button>
            <button class="btn-primary flex-1" @click="finalizeSetup(store.apiKey)">
              {{ t('settings.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Agent Modal -->
  <Teleport to="body">
    <Transition name="modal-backdrop">
      <div
        v-if="showAgent"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50"
        @click.self="showAgent = false"
      >
        <div class="modal-glass rounded-t-3xl sm:rounded-2xl p-6 max-w-md w-full mx-0 sm:mx-4">
          <h2 class="text-xl font-bold text-white mb-1">
            {{ t('agent.title') }}
          </h2>
          <p class="text-sm text-neutral-400 mb-5">
            {{ t('agent.description') }}
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
                    {{ t('agent.askTitle') }}
                  </div>
                  <div class="text-xs text-neutral-400 mt-0.5">
                    {{ t('agent.askDesc') }}
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
                    {{ t('agent.autoTitle') }}
                  </div>
                  <div class="text-xs text-neutral-400 mt-0.5">
                    {{ t('agent.autoDesc') }}
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
                    {{ t('agent.fullTitle') }}
                  </div>
                  <div class="text-xs text-neutral-400 mt-0.5">
                    {{ t('agent.fullDesc') }}
                  </div>
                </div>
                <div v-if="agentMode === 'full'" class="ml-auto w-2 h-2 rounded-full bg-red-400" />
              </div>
            </button>
          </div>

          <button class="btn-secondary w-full" @click="showAgent = false">
            {{ t('settings.cancel') }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Memory Modal -->
  <Teleport to="body">
    <Transition name="modal-backdrop">
      <div
        v-if="showMemory"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50"
        @click.self="showMemory = false"
      >
        <div class="modal-glass rounded-t-3xl sm:rounded-2xl p-6 max-w-lg w-full mx-0 sm:mx-4 max-h-[80vh] flex flex-col">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-white">
              {{ t('memory.title') }}
            </h2>
            <span class="text-xs text-neutral-400">{{ t('memory.entries', { count: store.userMemories.length }) }}</span>
          </div>
          <p class="text-sm text-neutral-400 mb-4">
            {{ t('memory.description') }}
          </p>

          <!-- Add new memory -->
          <div class="mb-4 p-3 rounded-xl bg-neutral-800/40 border border-neutral-700/40">
            <div class="flex gap-2 mb-2">
              <input
                v-model="newMemoryKey"
                :placeholder="t('memory.labelPlaceholder')"
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
                :placeholder="t('memory.valuePlaceholder')"
                class="input-field text-sm flex-1"
                @keydown.enter="addMemoryEntry"
              >
              <button class="btn-primary text-sm px-4" @click="addMemoryEntry">
                {{ t('memory.add') }}
              </button>
            </div>
          </div>

          <!-- Memory list -->
          <div class="flex-1 overflow-auto space-y-2 min-h-0">
            <div v-if="store.userMemories.length === 0" class="text-center text-neutral-500 text-sm py-6">
              {{ t('memory.empty') }}
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
              {{ t('memory.close') }}
            </button>
            <button
              v-if="store.userMemories.length > 0"
              class="btn-ghost text-sm text-red-400 hover:text-red-300"
              @click="store.clearMemories(); showToast(t('toast.memoriesCleared'), 'success')"
            >
              {{ t('memory.clearAll') }}
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
    ]"
    :style="appShellStyle"
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
        class="w-72 h-full flex flex-col p-4 glass-surface border-r"
        :style="secondaryPanelStyle"
      >
        <h1 :class="['text-xl font-bold mb-3 themed-primary-text', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-1' : '', !appReady ? 'opacity-0' : '']">
          SyntaxSenpai
        </h1>

        <!-- New Chat button -->
        <button
          :class="['themed-new-chat-btn w-full flex items-center justify-center gap-2 px-4 py-2.5 mb-3 rounded-xl text-white font-semibold text-sm shadow-lg transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-2' : '', !appReady ? 'opacity-0' : '']"
          :style="primaryButtonStyle"
          @click="store.newChat()"
        >
          <span class="text-base">+</span> {{ t('sidebar.newChat') }}
        </button>

        <div :class="['flex items-center gap-2 mb-3', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-3' : '', !appReady ? 'opacity-0' : '']">
          <div class="flex-1">
            <p class="text-xs text-neutral-500">
              {{ t('sidebar.waifu') }}
            </p>
            <p class="text-sm font-semibold">
              {{ store.isGroupChat ? t('sidebar.groupChat') : store.selectedWaifu?.displayName }}
            </p>
          </div>
          <div class="flex items-center gap-1">
            <button
              :class="[
                'text-[10px] font-medium px-1.5 py-0.5 rounded-full border transition-all duration-150 cursor-pointer',
                store.isGroupChat
                  ? 'text-violet-400 bg-violet-500/10 border-violet-500/20'
                  : 'text-neutral-400 bg-neutral-500/10 border-neutral-500/20 hover:text-violet-400 hover:bg-violet-500/10',
              ]"
              @click="store.setGroupChat(!store.isGroupChat)"
            >
              {{ t('sidebar.groupToggle') }}
            </button>
            <span class="text-[10px] text-emerald-400 font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">{{ t('sidebar.autoSaved') }}</span>
          </div>
        </div>

        <!-- Group chat waifu selector -->
        <div
          v-if="store.isGroupChat"
          :class="['mb-3 p-2 rounded-lg border border-neutral-700/40 bg-neutral-800/30', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-3' : '']"
        >
          <p class="text-xs text-neutral-500 mb-2">{{ t('sidebar.selectWaifus') }}</p>
          <div class="space-y-1">
            <label
              v-for="w in builtInWaifus"
              :key="w.id"
              :class="[
                'flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150',
                store.groupWaifuIds.includes(w.id) ? 'bg-violet-500/15 border border-violet-500/30' : 'hover:bg-white/5 border border-transparent',
              ]"
            >
              <input
                type="checkbox"
                :checked="store.groupWaifuIds.includes(w.id)"
                class="accent-violet-500"
                @change="store.toggleGroupWaifu(w.id)"
              >
              <span class="text-sm">{{ w.displayName }}</span>
            </label>
          </div>
        </div>

        <!-- Filter tabs: All / Favorites -->
        <div :class="['flex gap-1 mb-3 p-1 rounded-lg border', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-4' : '', !appReady ? 'opacity-0' : '']" :style="filterTabsStyle">
          <button
            :class="[
              'flex-1 text-xs font-semibold py-1.5 rounded-md transition-all duration-150',
            ]"
            :style="filterTabStyle(store.sidebarFilter === 'all')"
            @click="store.sidebarFilter = 'all'"
          >
            {{ t('sidebar.allChats') }}
          </button>
          <button
            :class="[
              'flex-1 text-xs font-semibold py-1.5 rounded-md transition-all duration-150',
            ]"
            :style="filterTabStyle(store.sidebarFilter === 'favorites', true)"
            @click="store.sidebarFilter = 'favorites'"
          >
            {{ t('sidebar.favorites') }}
          </button>
        </div>

        <input
          v-model="convSearch"
          :placeholder="t('sidebar.searchPlaceholder')"
          :class="['input-field text-sm mb-3', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-5' : '', !appReady ? 'opacity-0' : '']"
          :style="inputSurfaceStyle"
        >

        <div :class="['flex-1 overflow-auto', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-6' : '', !appReady ? 'opacity-0' : '']">
          <p v-if="filteredConversations.length === 0" class="text-xs text-neutral-500 text-center py-4">
            {{ store.sidebarFilter === 'favorites' ? t('sidebar.noFavorites') : t('sidebar.noConversations') }}
          </p>
          <ul class="space-y-px">
            <li
              v-for="c in filteredConversations"
              :key="c.id"
              :class="[
                'flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer group',
                'transition-colors duration-150',
                store.conversationId === c.id
                  ? 'themed-active-item text-white'
                  : 'hover:bg-white/5 text-neutral-300',
              ]"
              :title="`${c.title}\nUpdated ${new Date(c.updatedAt).toLocaleString()}${c.messageCount ? ` • ${c.messageCount} messages` : ''}`"
              @click="store.selectConversation(c.id)"
            >
              <span
                v-if="c.favorited"
                class="text-amber-400 text-[11px] leading-none shrink-0"
                title="Favorite"
              >★</span>
              <div class="flex-1 min-w-0 flex items-baseline gap-1.5 overflow-hidden">
                <span class="text-[13px] font-medium truncate">{{ c.title }}</span>
                <span class="text-[10px] text-neutral-500 shrink-0 tabular-nums">{{ relativeTime(c.updatedAt) }}</span>
              </div>
              <div class="flex gap-0.5 shrink-0 items-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <button
                  :class="[
                    'text-[11px] leading-none px-1 transition-colors',
                    c.favorited ? 'text-amber-400' : 'text-neutral-400 hover:text-amber-300',
                  ]"
                  title="Toggle favorite"
                  @click.stop="store.toggleFavorite(c.id)"
                >
                  {{ c.favorited ? '★' : '☆' }}
                </button>
                <button
                  class="text-[11px] leading-none px-1 text-neutral-400 hover:text-red-400 transition-colors"
                  title="Delete"
                  @click.stop="store.deleteConversation(c.id)"
                >
                  ✕
                </button>
              </div>
            </li>
          </ul>
        </div>

        <div :class="['mt-3', !startupAnimDone && appReady ? 'sidebar-item sidebar-item-7' : '', !appReady ? 'opacity-0' : '']">
          <button class="btn-ghost w-full text-sm" :style="ghostButtonStyle" @click="sidebarOpen = false">
            {{ t('sidebar.collapse') }}
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
          'glass-surface border-b',
          'flex items-center justify-between',
          !startupAnimDone && appReady ? 'app-slide-in-top' : '',
          !appReady ? 'opacity-0' : '',
        ]"
        :style="secondaryPanelStyle"
      >
        <div class="flex items-center gap-3 min-w-0">
          <button class="btn-ghost p-2" @click="sidebarOpen = !sidebarOpen">
            {{ sidebarOpen ? '←' : '☰' }}
          </button>
          <div class="flex items-center gap-4 min-w-0">
            <div class="min-w-0">
              <div class="text-lg font-semibold truncate">
                {{ store.isGroupChat ? store.activeWaifus.map(w => w.displayName).join(' & ') : store.selectedWaifu?.displayName }}
              </div>
              <div class="text-xs text-neutral-400 truncate">
                {{ store.isGroupChat ? t('sidebar.groupChat') : store.selectedWaifu?.backstory?.slice(0, 60) }}
              </div>
            </div>
            <div :class="[affectionMeterClass, 'shrink-0 rounded-xl border px-3 py-2']" :style="affectionBoxStyle">
              <div class="flex items-center justify-between text-[11px] uppercase tracking-[0.18em]">
                <span>{{ t('header.affection') }}</span>
                <span>{{ store.affection }} / 100({{ affectionTier }})</span>
              </div>
              <div class="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800/90">
                <div class="h-full rounded-full transition-all duration-500 ease-out" :style="affectionFillStyle" />
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button
            class="btn-ghost p-2"
            :style="ghostButtonStyle"
            :title="t('sidebar.agent')"
            @click="showAgent = true"
          >
            🤖
          </button>
          <button
            class="btn-ghost p-2"
            :style="ghostButtonStyle"
            title="AI Memory"
            @click="showMemory = true"
          >
            🧠
          </button>
          <button
            class="btn-ghost p-2"
            :style="ghostButtonStyle"
            :title="t('sidebar.settings')"
            @click="showSettings = true"
          >
            ⚙️
          </button>
        </div>
      </div>

      <!-- Usage + todo status strip (only when there's something to show) -->
      <div
        v-if="store.usageTotals.turns > 0 || store.activeTodoList.length > 0 || (contextWindowSize > 0 && store.messages.length > 0)"
        class="px-4 py-2 border-b border-white/5 flex items-center gap-4 text-[11px] text-neutral-400"
      >
        <div v-if="store.usageTotals.turns > 0" class="flex items-center gap-3 font-mono">
          <span :title="t('usage.promptTokens')">
            ↑ {{ store.usageTotals.promptTokens.toLocaleString(bcp47Locale(locale)) }}
          </span>
          <span :title="t('usage.completionTokens')">
            ↓ {{ store.usageTotals.completionTokens.toLocaleString(bcp47Locale(locale)) }}
          </span>
          <span :title="t('usage.estCost', { currency: currencyCodeForLocale(locale) })">
            ≈ {{ formatLocalizedCost(store.usageTotals.costUsd, locale) }}
          </span>
        </div>
        <div
          v-if="contextWindowSize > 0 && store.messages.length > 0"
          class="flex items-center gap-2 ml-auto"
          :title="`~${estimatedTokensUsed.toLocaleString()} / ${contextWindowSize.toLocaleString()} tokens (estimated)`"
        >
          <span class="font-mono">ctx</span>
          <div class="w-24 h-1.5 rounded-full bg-neutral-700/50 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="contextUsagePercent >= 90 ? 'bg-red-400' : contextUsagePercent >= 70 ? 'bg-amber-400' : 'bg-emerald-500/70'"
              :style="{ width: contextUsagePercent + '%' }"
            />
          </div>
          <span :class="contextUsagePercent >= 90 ? 'text-red-400' : contextUsagePercent >= 70 ? 'text-amber-400' : ''">
            {{ contextUsagePercent }}%
          </span>
        </div>
        <div v-if="store.activeTodoList.length > 0" class="flex-1 flex flex-wrap gap-x-3 gap-y-1">
          <span
            v-for="item in store.activeTodoList"
            :key="item.id"
            :class="[
              'flex items-center gap-1',
              item.status === 'done' ? 'text-emerald-300 line-through opacity-75' :
              item.status === 'in_progress' ? 'text-primary-300 font-semibold' :
              'text-neutral-400',
            ]"
          >
            <span>{{ item.status === 'done' ? '☑' : item.status === 'in_progress' ? '▸' : '☐' }}</span>
            <span>{{ item.text }}</span>
          </span>
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
            {{ store.isGroupChat
              ? t('chat.emptyTitleGroup', { names: store.activeWaifus.map(w => w.displayName).join(', ') })
              : t('chat.emptyTitle', { name: store.selectedWaifu?.displayName || '' })
            }}
          </h3>
          <p class="text-sm" :style="emptyStateGlowStyle">
            {{ t('chat.emptySubtitle') }}
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
              'group flex',
              msg.role === 'user' ? 'justify-end items-end' : 'justify-start items-start',
            ]"
          >
            <div v-if="msg.role !== 'user'" class="mr-3 shrink-0 relative">
              <div
                class="themed-assistant-avatar w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                :title="msg.waifuDisplayName || store.selectedWaifu?.displayName"
              >
                {{ msg.waifuDisplayName?.[0] || store.selectedWaifu?.displayName?.[0] || 'A' }}
              </div>
              <span
                v-if="msg.sentiment && msg.sentiment.expression !== 'neutral'"
                class="absolute -bottom-1 -right-1 text-[11px] leading-none select-none pointer-events-none transition-all duration-300"
                :style="{ transform: `scale(${0.85 + (msg.sentiment.intensity ?? 0) * 0.35})` }"
                :aria-label="`Mood: ${msg.sentiment.expression}`"
              >
                {{ sentimentEmoji(msg.sentiment.expression) }}
              </span>
            </div>

            <div :class="msg.role !== 'user' ? 'flex flex-col' : ''">
              <span
                v-if="msg.role !== 'user' && store.isGroupChat && msg.waifuDisplayName"
                class="text-[11px] text-neutral-400 mb-0.5 ml-1 font-semibold"
              >
                {{ msg.waifuDisplayName }}
              </span>
              <ChatBubble
                :role="msg.role"
                :content="msg.content"
                :timestamp="msg.timestamp"
                :recent="msg.id === store.recentMessageId"
                :show-copy="msg.role === 'assistant'"
              />
              <div
                v-if="msg.attachments && msg.attachments.length > 0"
                :class="['flex flex-wrap gap-2 mt-1.5', msg.role === 'user' ? 'justify-end' : 'justify-start']"
              >
                <img
                  v-for="att in msg.attachments"
                  :key="att.id"
                  :src="att.url"
                  :alt="att.name"
                  :title="att.name"
                  class="max-h-40 max-w-[240px] rounded-lg border border-white/10 object-cover"
                />
              </div>
              <div
                v-if="msg.role === 'assistant' && !msg.id.startsWith('tool-')"
                class="flex gap-2 mt-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              >
                <button
                  class="text-[11px] text-neutral-500 hover:text-primary-300 transition-colors"
                  :title="t('message.regenerateTitle')"
                  @click="store.regenerateFromMessage(msg.id)"
                >
                  {{ t('message.regenerate') }}
                </button>
                <button
                  class="text-[11px] text-neutral-500 hover:text-red-400 transition-colors"
                  :title="t('message.deleteTitle')"
                  @click="store.deleteMessage(msg.id)"
                >
                  {{ t('message.delete') }}
                </button>
              </div>
            </div>

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
      <div
        :class="['glass-surface border-t p-4 relative', !startupAnimDone && appReady ? 'app-slide-in-bottom' : '', !appReady ? 'opacity-0' : '']"
        :style="secondaryPanelStyle"
        @dragover.prevent="isDraggingFiles = true"
        @dragleave.prevent="isDraggingFiles = false"
        @drop.prevent="handleFileDrop"
      >
        <div
          v-if="isDraggingFiles"
          class="absolute inset-0 rounded-xl bg-primary-500/15 border-2 border-dashed border-primary-400/60 flex items-center justify-center text-sm text-primary-100 font-semibold pointer-events-none z-10"
        >
          {{ t('input.dropHint') }}
        </div>

        <!-- Pending-attachment thumbnail row -->
        <div v-if="store.pendingAttachments.length > 0" class="flex flex-wrap gap-2 mb-2">
          <div
            v-for="att in store.pendingAttachments"
            :key="att.id"
            class="relative group rounded-lg overflow-hidden border border-white/10 bg-black/30"
            :title="att.name"
          >
            <img :src="att.url" :alt="att.name" class="h-16 w-16 object-cover" />
            <button
              class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              :title="t('input.removeAttachment', { name: att.name })"
              @click="store.removeAttachment(att.id)"
            >
              ×
            </button>
          </div>
        </div>

        <div class="flex gap-3 items-end">
          <input
            ref="fileInputRef"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            class="hidden"
            @change="handleFilePick"
          />
          <button
            class="btn-ghost min-w-fit !px-2"
            :title="t('input.attachImage')"
            :disabled="store.isLoading"
            @click="fileInputRef?.click()"
          >
            📎
          </button>
          <textarea
            ref="inputRef"
            v-model="store.inputValue"
            :placeholder="t('chat.inputPlaceholder')"
            :disabled="store.isLoading"
            rows="1"
            :class="[
              'input-field flex-1 resize-none',
              'disabled:opacity-50',
            ]"
            style="max-height: 100px"
            :style="inputSurfaceStyle"
            @input="adjustInputHeight"
            @keydown="handleKeyDown"
            @paste="handlePaste"
          />
          <button
            class="btn-primary themed-btn-primary min-w-fit flex items-center justify-center gap-2"
            :style="primaryButtonStyle"
            :disabled="(!store.inputValue.trim() && store.pendingAttachments.length === 0) || store.isLoading"
            @click="store.sendMessage(store.inputValue)"
          >
            {{ store.isLoading ? t('chat.sending') : t('chat.send') }}
          </button>
        </div>
        <p class="text-xs text-neutral-500 mt-2">
          {{ t('chat.inputHint') }}
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
