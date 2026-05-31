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
import { loadPluginTools } from './agent-tools'
import ChatBubble from './components/ChatBubble.vue'
import SubagentPanel from './components/SubagentPanel.vue'
import AppAvatar from './components/AppAvatar.vue'
import Live2DAvatar from './components/Live2DAvatar.vue'
import TypingDots from './components/TypingDots.vue'
import MessageSkeleton from './components/MessageSkeleton.vue'
import QrPairModal from './components/QrPairModal.vue'
import RepositoryPickerModal from './components/RepositoryPickerModal.vue'
import SakuraPetals from './components/SakuraPetals.vue'
import type { ActiveCodingRepo } from './types/coding-session'

const store = useChatStore()
const { invoke, on } = useIpc()
const { theme, currentRainbowHue, hslToHex, resetTheme, setColor, setRainbow, setUI, DEFAULT_THEME } = useTheme()
const { t, locale, setLocale, localeOptions } = useI18n()
const voice = useVoice()

/**
 * Message windowing: long conversations (1000+ turns) were rendering every
 * bubble as its own DOM subtree, including sentiment pips and action
 * buttons. Instead of pulling in vue-virtual-scroller and rewriting the
 * TransitionGroup, cap the default visible window at the tail of the
 * conversation and expose an "Show older" button to page further back.
 * Covers >95% of real sessions with zero new deps.
 */
const MESSAGE_WINDOW_INITIAL = 200
const MESSAGE_WINDOW_PAGE = 100
const visibleMessageCount = ref(MESSAGE_WINDOW_INITIAL)

const windowedMessages = computed(() => {
  const list = store.messages
  if (list.length <= visibleMessageCount.value) return list
  return list.slice(list.length - visibleMessageCount.value)
})

function revealOlderMessages() {
  visibleMessageCount.value = Math.min(
    visibleMessageCount.value + MESSAGE_WINDOW_PAGE,
    store.messages.length,
  )
}

const showRenameConversationModal = ref(false)
const renameConversationId = ref<string | null>(null)
const renameConversationValue = ref('')
const renameConversationInputRef = ref<HTMLInputElement | null>(null)

function renameConversationPrompt(conversation: { id: string; title?: string }) {
  renameConversationId.value = conversation.id
  renameConversationValue.value = String(conversation.title || '').trim()
  showRenameConversationModal.value = true

  void nextTick(() => {
    renameConversationInputRef.value?.focus()
    renameConversationInputRef.value?.select()
  })
}

function closeRenameConversationModal() {
  showRenameConversationModal.value = false
  renameConversationId.value = null
  renameConversationValue.value = ''
}

async function submitRenameConversation() {
  const conversationId = renameConversationId.value
  const trimmedTitle = renameConversationValue.value.trim()
  const currentConversation = store.conversations.find((conversation: any) => conversation.id === conversationId)
  const currentTitle = String(currentConversation?.title || '').trim()

  if (!conversationId || !trimmedTitle || trimmedTitle === currentTitle) {
    closeRenameConversationModal()
    return
  }

  await store.renameConversation(conversationId, trimmedTitle)
  closeRenameConversationModal()
}

// Reset the window whenever the user switches conversations so opening an
// old thread starts at the tail, not wherever they paged to in another chat.
watch(
  () => store.conversationId,
  () => {
    visibleMessageCount.value = MESSAGE_WINDOW_INITIAL
  },
)

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
type SettingsTabId = 'general' | 'ai' | 'data' | 'metrics' | 'theme' | 'interface' | 'plugins' | 'skills' | 'waifus' | 'live2d' | 'mobile' | 'wechat'
const settingsTab = ref<SettingsTabId>('general')
const settingsTabs: Array<{ id: SettingsTabId; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: '⚙️' },
  { id: 'ai', label: 'AI', icon: '🤖' },
  { id: 'data', label: 'Data', icon: '💾' },
  { id: 'metrics', label: 'Metrics', icon: '📊' },
  { id: 'theme', label: 'Theme', icon: '🎨' },
  { id: 'interface', label: 'Interface', icon: '✨' },
  { id: 'plugins', label: 'Plugins', icon: '🧩' },
  { id: 'skills', label: 'Skills', icon: '📘' },
  { id: 'waifus', label: 'Waifus', icon: '💗' },
  { id: 'live2d', label: 'Live2D', icon: '🎭' },
  { id: 'mobile', label: 'Mobile', icon: '📱' },
  { id: 'wechat', label: 'WeChat', icon: '💬' },
]

// Ollama base URL (per-provider preference)
const ollamaBaseUrl = ref('')

// ── WeChat settings tab state ───────────────────────────────────────────────
const wechatQrDataUrl = ref<string | null>(null)
const wechatPairingError = ref<string | null>(null)
const wechatPairingBusy = ref(false)

async function startWeChatPairing() {
  wechatPairingError.value = null
  wechatPairingBusy.value = true
  wechatQrDataUrl.value = null
  try {
    const res = await invoke('wechat:startPairing')
    if (!res?.success) {
      wechatPairingError.value = res?.error ?? 'Failed to start pairing'
      return
    }
    wechatQrDataUrl.value = res.qrDataUrl ?? null
  } catch (err: any) {
    wechatPairingError.value = err?.message ?? String(err)
  } finally {
    wechatPairingBusy.value = false
  }
}

async function cancelWeChatPairing() {
  try { await invoke('wechat:cancelPairing') } catch { /* ignore */ }
  wechatQrDataUrl.value = null
  wechatPairingError.value = null
}

async function disconnectWeChat() {
  try {
    const res = await invoke('wechat:disconnect')
    if (!res?.success) {
      showToast(res?.error || 'Disconnect failed', 'error')
      return
    }
    wechatQrDataUrl.value = null
    wechatPairingError.value = null
  } catch (err: any) {
    showToast(err?.message || String(err), 'error')
  }
}

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

// Plugins tab state — discovery + enable/disable for tool plugins on disk.
interface DesktopPluginEntry {
  name: string
  version: string
  description?: string
  main: string
  enabled: boolean
  directory: string
  error?: string
  disabled?: boolean
}
const pluginsList = ref<DesktopPluginEntry[]>([])
const pluginsDirectory = ref<string>('')
const pluginsLoading = ref(false)
const pluginsError = ref<string>('')

// Pending plugins — AI-authored tool proposals waiting for user approval.
// Lives on the same tab as active plugins so users see both in one place.
interface PendingPluginEntry {
  slug: string
  name: string
  version: string
  description?: string
  manifest: any
  code: string
  createdAt: string
}
const pendingPlugins = ref<PendingPluginEntry[]>([])
const pendingExpanded = ref<Set<string>>(new Set())

async function refreshPendingPlugins() {
  try {
    const result = await invoke('pending-plugins:list')
    if (result?.success && Array.isArray(result.pending)) {
      pendingPlugins.value = result.pending
    }
  } catch { /* optional */ }
}

function togglePendingExpanded(slug: string) {
  const next = new Set(pendingExpanded.value)
  if (next.has(slug)) next.delete(slug)
  else next.add(slug)
  pendingExpanded.value = next
}

async function approvePending(slug: string) {
  const result = await invoke('pending-plugins:approve', slug)
  if (result?.success) {
    pendingPlugins.value = pendingPlugins.value.filter((p) => p.slug !== slug)
    showToast(`Approved "${slug}" — restart to load the new tool`, 'success')
    refreshPlugins()
  } else {
    showToast(result?.error || 'Approve failed', 'error')
  }
}

async function rejectPending(slug: string) {
  const result = await invoke('pending-plugins:reject', slug)
  if (result?.success) {
    pendingPlugins.value = pendingPlugins.value.filter((p) => p.slug !== slug)
    showToast(`Rejected "${slug}"`, 'success')
  } else {
    showToast(result?.error || 'Reject failed', 'error')
  }
}

// Skills tab state — user-facing view over <userData>/skills/*.
interface SkillTabEntry { slug: string; name: string; description: string; body?: string }
const skillsList = ref<SkillTabEntry[]>([])
const skillsLoading = ref(false)
const skillsError = ref<string>('')
const skillsExpanded = ref<Set<string>>(new Set())

async function refreshSkillsTab() {
  skillsLoading.value = true
  skillsError.value = ''
  try {
    const result = await invoke('skills:list')
    if (result?.success) {
      skillsList.value = Array.isArray(result.skills) ? result.skills : []
    } else {
      skillsError.value = result?.error || 'Failed to list skills'
    }
  } catch (err: any) {
    skillsError.value = err?.message || String(err)
  } finally {
    skillsLoading.value = false
  }
}

async function toggleSkillExpanded(slug: string) {
  const next = new Set(skillsExpanded.value)
  if (next.has(slug)) {
    next.delete(slug)
    skillsExpanded.value = next
    return
  }
  const current = skillsList.value.find((s) => s.slug === slug)
  if (current && !current.body) {
    try {
      const result = await invoke('skills:read', slug)
      if (result?.success && result.skill?.body) {
        current.body = result.skill.body
      }
    } catch { /* non-fatal */ }
  }
  next.add(slug)
  skillsExpanded.value = next
}

async function deleteSkill(slug: string) {
  const result = await invoke('skills:delete', slug)
  if (result?.success) {
    skillsList.value = skillsList.value.filter((s) => s.slug !== slug)
    store.refreshAvailableSkills()
    showToast(`Removed skill "${slug}"`, 'success')
  } else {
    showToast(result?.error || 'Delete failed', 'error')
  }
}

async function refreshPlugins() {
  pluginsLoading.value = true
  pluginsError.value = ''
  try {
    const result = await invoke('plugins:list')
    if (result?.success) {
      pluginsList.value = Array.isArray(result.plugins) ? result.plugins : []
      pluginsDirectory.value = result.pluginDir || ''
    } else {
      pluginsError.value = result?.error || 'Failed to list plugins'
    }
  } catch (err: any) {
    pluginsError.value = err?.message || String(err)
  } finally {
    pluginsLoading.value = false
  }
}

async function togglePluginDisabled(plugin: DesktopPluginEntry) {
  const next = !plugin.disabled
  try {
    const result = await invoke('plugins:setDisabled', plugin.name, next)
    if (result?.success) {
      plugin.disabled = next
      showToast(`${plugin.name} ${next ? 'disabled' : 'enabled'} — restart to apply`, 'success')
    } else {
      showToast(result?.error || 'Failed to toggle plugin', 'error')
    }
  } catch (err: any) {
    showToast(err?.message || String(err), 'error')
  }
}

// Custom waifu tab state — list, import, delete user-authored waifus.
interface CustomWaifuEntry {
  id: string
  name: string
  displayName: string
  backstory?: string
  avatar?: {
    expressions?: Partial<Record<string, { uri?: string }>>
    idleAnimation?: string
  }
  tags?: string[]
  isBuiltIn?: boolean
}
const customWaifus = ref<CustomWaifuEntry[]>([])
const customWaifusDirectory = ref<string>('')
const customWaifusLoading = ref(false)
const customWaifusError = ref<string>('')

// ── Custom waifu creation form state ──
const showWaifuCreator = ref(false)
const newWaifuName = ref('')
const newWaifuDisplayName = ref('')
const newWaifuBackstory = ref('')
const newWaifuTags = ref('')
const newWaifuEmojis = ref('✨')
const newWaifuCatchphrases = ref('')
const newWaifuGreeting = ref('')
const newWaifuAffirmation = ref('')
const newWaifuDeflection = ref('')
const newWaifuPersonalityWarmth = ref(60)
const newWaifuPersonalityFormality = ref(50)
const newWaifuPersonalityEnthusiasm = ref(50)
const newWaifuPersonalityTeasing = ref(40)
const newWaifuPersonalityVerbosity = ref(50)
const newWaifuPersonalityHumor = ref(50)
const newWaifuAvatarNeutral = ref('')
const newWaifuAvatarHappy = ref('')
const newWaifuAvatarExcited = ref('')
const newWaifuAvatarThinking = ref('')
const newWaifuAvatarIdle = ref('')
// Live2D
const newWaifuLive2DModelPath = ref('')
const newWaifuLive2DModelName = ref('')
const newWaifuLive2DImporting = ref(false)
const newWaifuCreating = ref(false)
const newWaifuError = ref('')
const aiEnhancing = ref<'grammar' | 'personality' | null>(null)
const aiEnhanceError = ref('')

function resetWaifuForm() {
  newWaifuName.value = ''
  newWaifuDisplayName.value = ''
  newWaifuBackstory.value = ''
  newWaifuTags.value = ''
  newWaifuEmojis.value = '✨'
  newWaifuCatchphrases.value = ''
  newWaifuGreeting.value = ''
  newWaifuAffirmation.value = ''
  newWaifuDeflection.value = ''
  newWaifuPersonalityWarmth.value = 60
  newWaifuPersonalityFormality.value = 50
  newWaifuPersonalityEnthusiasm.value = 50
  newWaifuPersonalityTeasing.value = 40
  newWaifuPersonalityVerbosity.value = 50
  newWaifuPersonalityHumor.value = 50
  newWaifuAvatarNeutral.value = ''
  newWaifuAvatarHappy.value = ''
  newWaifuAvatarExcited.value = ''
  newWaifuAvatarThinking.value = ''
  newWaifuAvatarIdle.value = ''
  newWaifuLive2DModelPath.value = ''
  newWaifuLive2DModelName.value = ''
  newWaifuError.value = ''
  aiEnhanceError.value = ''
  aiEnhancing.value = null
}

function inferAvatarAssetType(uri: string): 'lottie' | 'png' | 'svg' {
  const normalizedUri = uri.trim().toLowerCase()
  if (normalizedUri.endsWith('.json') || normalizedUri.endsWith('.lottie')) return 'lottie'
  if (normalizedUri.endsWith('.svg')) return 'svg'
  return 'png'
}

function buildAvatarAsset(uri: string, fallbackUri: string) {
  const resolvedUri = uri.trim() || fallbackUri
  return {
    type: inferAvatarAssetType(resolvedUri),
    uri: resolvedUri,
  }
}

function getCustomWaifuThumbnail(waifu: CustomWaifuEntry) {
  return waifu.avatar?.expressions?.neutral?.uri
    || waifu.avatar?.expressions?.happy?.uri
    || waifu.avatar?.expressions?.excited?.uri
    || waifu.avatar?.expressions?.thinking?.uri
    || ''
}

async function pickCustomWaifuAvatar(target: 'neutral' | 'happy' | 'excited' | 'thinking' | 'idle') {
  try {
    const result = await invoke('export:openAsset', {
      title: target === 'idle' ? 'Select local idle animation' : 'Select local avatar image',
      buttonLabel: 'Use file',
      includeAnimation: target === 'idle',
    })

    if (!result?.success) {
      if (!result?.canceled) showToast(result?.error || 'Could not select asset', 'error')
      return
    }

    const selectedUri = result.fileUrl || result.filePath || ''
    if (!selectedUri) return

    if (target === 'neutral') newWaifuAvatarNeutral.value = selectedUri
    else if (target === 'happy') newWaifuAvatarHappy.value = selectedUri
    else if (target === 'excited') newWaifuAvatarExcited.value = selectedUri
    else if (target === 'thinking') newWaifuAvatarThinking.value = selectedUri
    else newWaifuAvatarIdle.value = selectedUri
  } catch (err: any) {
    showToast(err?.message || String(err), 'error')
  }
}

async function importLive2DModel() {
  newWaifuLive2DImporting.value = true
  try {
    const result = await invoke('waifus:importLive2DModel')
    if (result?.success) {
      newWaifuLive2DModelPath.value = result.modelJsonPath
      newWaifuLive2DModelName.value = result.displayName
      showToast(`Live2D model "${result.displayName}" imported!`, 'success')
    } else if (!result?.canceled) {
      showToast(result?.error || 'Could not import model', 'error')
    }
  } catch (err: any) {
    showToast(err?.message || String(err), 'error')
  } finally {
    newWaifuLive2DImporting.value = false
  }
}

async function fixGrammarAI() {
  const text = newWaifuBackstory.value.trim()
  if (!text) {
    aiEnhanceError.value = 'Write a backstory first before fixing grammar!'
    return
  }
  if (!store.apiKey && store.selectedProvider !== 'lmstudio') {
    aiEnhanceError.value = 'Configure an API key in Settings → AI first!'
    return
  }
  aiEnhanceError.value = ''
  aiEnhancing.value = 'grammar'
  try {
    const result = await invoke('ai:enhanceText', {
      provider: store.selectedProvider,
      apiKey: store.apiKey,
      text,
      mode: 'grammar',
    })
    if (result?.success && result.text) {
      newWaifuBackstory.value = result.text
      showToast('Grammar & typos fixed! ✨', 'success')
    } else {
      aiEnhanceError.value = result?.error || 'Failed to fix grammar'
    }
  } catch (err: any) {
    aiEnhanceError.value = err?.message || String(err)
  } finally {
    aiEnhancing.value = null
  }
}

async function enhancePersonalityAI() {
  const text = newWaifuBackstory.value.trim()
  if (!text) {
    aiEnhanceError.value = 'Write a backstory first before enhancing!'
    return
  }
  if (!store.apiKey && store.selectedProvider !== 'lmstudio') {
    aiEnhanceError.value = 'Configure an API key in Settings → AI first!'
    return
  }
  aiEnhanceError.value = ''
  aiEnhancing.value = 'personality'
  try {
    const result = await invoke('ai:enhanceText', {
      provider: store.selectedProvider,
      apiKey: store.apiKey,
      text,
      mode: 'personality',
      personalityTraits: {
        warmth: newWaifuPersonalityWarmth.value,
        formality: newWaifuPersonalityFormality.value,
        enthusiasm: newWaifuPersonalityEnthusiasm.value,
        teasing: newWaifuPersonalityTeasing.value,
        verbosity: newWaifuPersonalityVerbosity.value,
        humor: newWaifuPersonalityHumor.value,
      },
    })
    if (result?.success && result.text) {
      newWaifuBackstory.value = result.text
      showToast('Personality enhanced! 🌟', 'success')
    } else {
      aiEnhanceError.value = result?.error || 'Failed to enhance personality'
    }
  } catch (err: any) {
    aiEnhanceError.value = err?.message || String(err)
  } finally {
    aiEnhancing.value = null
  }
}

async function createCustomWaifu() {
  newWaifuError.value = ''
  const name = newWaifuName.value.trim()
  const displayName = newWaifuDisplayName.value.trim()
  const backstory = newWaifuBackstory.value.trim()
  if (!name || !displayName || !backstory) {
    newWaifuError.value = 'Name, Display Name, and Backstory are required!'
    return
  }
  const id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_|_$/g, '')
  if (!id) {
    newWaifuError.value = 'Name must contain at least one letter or number'
    return
  }
  const tags = newWaifuTags.value.split(',').map(t => t.trim()).filter(Boolean)
  const catchphrases = newWaifuCatchphrases.value.split('\n').map(c => c.trim()).filter(Boolean)
  const emojis = newWaifuEmojis.value.split(/\s+/).filter(Boolean)
  const neutralAvatarUri = newWaifuAvatarNeutral.value.trim() || '/assets/waifus/default/neutral.png'
  const happyAvatarUri = newWaifuAvatarHappy.value.trim() || neutralAvatarUri || '/assets/waifus/default/happy.png'
  const excitedAvatarUri = newWaifuAvatarExcited.value.trim() || happyAvatarUri || neutralAvatarUri || '/assets/waifus/default/excited.png'
  const thinkingAvatarUri = newWaifuAvatarThinking.value.trim() || neutralAvatarUri || '/assets/waifus/default/thinking.png'
  const idleAvatarUri = newWaifuAvatarIdle.value.trim() || '/assets/waifus/default/idle.json'

  newWaifuCreating.value = true
  try {
    const waifuPayload = {
      id,
      name: id,
      displayName,
      sourceAnime: 'Original',
      backstory,
      personalityTraits: {
        warmth: newWaifuPersonalityWarmth.value,
        formality: newWaifuPersonalityFormality.value,
        enthusiasm: newWaifuPersonalityEnthusiasm.value,
        teasing: newWaifuPersonalityTeasing.value,
        verbosity: newWaifuPersonalityVerbosity.value,
        humor: newWaifuPersonalityHumor.value,
      },
      communicationStyle: {
        greetingPrefix: newWaifuGreeting.value || `Hey there~`,
        affirmationPhrase: newWaifuAffirmation.value || `I've got this!`,
        deflectionPhrase: newWaifuDeflection.value || `It's nothing...`,
        signatureEmojis: emojis.length > 0 ? emojis : ['✨'],
        speaksIn3rdPerson: false,
        usesHonorificSelf: 'watashi',
      },
      avatar: {
        expressions: {
          neutral: buildAvatarAsset(neutralAvatarUri, '/assets/waifus/default/neutral.png'),
          happy: buildAvatarAsset(happyAvatarUri, '/assets/waifus/default/happy.png'),
          excited: buildAvatarAsset(excitedAvatarUri, '/assets/waifus/default/excited.png'),
          thinking: buildAvatarAsset(thinkingAvatarUri, '/assets/waifus/default/thinking.png'),
          confused: buildAvatarAsset(thinkingAvatarUri, '/assets/waifus/default/confused.png'),
          embarrassed: buildAvatarAsset(happyAvatarUri, '/assets/waifus/default/embarrassed.png'),
          determined: buildAvatarAsset(excitedAvatarUri, '/assets/waifus/default/determined.png'),
          sad: buildAvatarAsset(neutralAvatarUri, '/assets/waifus/default/sad.png'),
        },
        idleAnimation: idleAvatarUri,
        ...(newWaifuLive2DModelPath.value ? {
          live2dModel: {
            modelJsonPath: newWaifuLive2DModelPath.value,
            displayName: newWaifuLive2DModelName.value,
          },
        } : {}),
      },
      capabilities: {
        fileSystem: false,
        shellExecution: false,
        webSearch: true,
        codeExecution: false,
        remoteDesktopControl: false,
      },
      systemPromptTemplate: `You are {{displayName}}, a custom waifu. ${backstory.slice(0, 100)}

IMPORTANT - You must ALWAYS talk in your unique character. Use your emojis (${emojis.join('')}) and stay in character.
- Be engaging and helpful while maintaining your personality
- Use your signature phrases naturally
- NEVER sound like a generic AI assistant. You are a waifu who cares about the user.
Example: "${displayName} is here to help~"`,
      preferredAIProvider: 'anthropic',
      preferredModel: 'claude-3-5-sonnet-20241022',
      createdAt: new Date().toISOString(),
      isBuiltIn: false,
      tags,
      catchphrases,
    }
    const result = await invoke('waifus:write', waifuPayload)
    if (result?.success) {
      showToast(`Created waifu "${displayName}"!`, 'success')
      resetWaifuForm()
      showWaifuCreator.value = false
      await refreshCustomWaifus()
      await store.refreshCustomWaifus()
    } else {
      newWaifuError.value = result?.error || 'Failed to save waifu'
    }
  } catch (err: any) {
    newWaifuError.value = err?.message || String(err)
  } finally {
    newWaifuCreating.value = false
  }
}

async function refreshCustomWaifus() {
  customWaifusLoading.value = true
  customWaifusError.value = ''
  try {
    const result = await invoke('waifus:list')
    if (result?.success) {
      customWaifus.value = Array.isArray(result.waifus) ? result.waifus : []
      customWaifusDirectory.value = result.directory || ''
    } else {
      customWaifusError.value = result?.error || 'Failed to list custom waifus'
    }
  } catch (err: any) {
    customWaifusError.value = err?.message || String(err)
  } finally {
    customWaifusLoading.value = false
  }
}

async function importCustomWaifu() {
  try {
    const result = await invoke('export:openJson')
    if (!result?.success) {
      if (!result?.canceled) showToast(result?.error || 'Import failed', 'error')
      return
    }
    const raw = result.payload
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') {
      showToast('Selected file does not look like a waifu (missing id).', 'error')
      return
    }
    const write = await invoke('waifus:write', raw)
    if (!write?.success) {
      showToast(write?.error || 'Could not save waifu', 'error')
      return
    }
    showToast(`Imported "${raw.displayName || raw.id}"`, 'success')
    await refreshCustomWaifus()
    // Also refresh the store-level copy so the waifu appears in pickers
    // (sidebar / single-select / group-chat toggles) without restart.
    await store.refreshCustomWaifus()
  } catch (err: any) {
    showToast(err?.message || String(err), 'error')
  }
}

async function deleteCustomWaifu(id: string) {
  try {
    const result = await invoke('waifus:delete', id)
    if (result?.success) {
      customWaifus.value = customWaifus.value.filter((w) => w.id !== id)
      showToast(`Removed "${id}"`, 'success')
      // Drop it from the store-level list so pickers update immediately.
      await store.refreshCustomWaifus()
      // If the deleted waifu was active, fall back to the first built-in.
      if (store.selectedWaifuId === id) {
        const fallback = builtInWaifus[0]?.id
        if (fallback) store.selectedWaifuId = fallback
      }
    } else {
      showToast(result?.error || 'Delete failed', 'error')
    }
  } catch (err: any) {
    showToast(err?.message || String(err), 'error')
  }
}

// Strict-mode state: toggle for the allowlist sandbox. The allowlist itself
// is already managed by the existing agent:* IPC and its UI in the AI tab.
interface StrictModeState {
  enabled: boolean
  auditLog: string
}
const strictMode = ref<StrictModeState>({ enabled: false, auditLog: '' })
const overlayWindow = ref<{ enabled: boolean }>({ enabled: false })
const fullscreenWindow = ref<{ enabled: boolean }>({ enabled: false })
const currentWindowBounds = ref<{ width: number; height: number } | null>(null)
const showCompactHeaderMenu = ref(false)
const showCompactStatusDetails = ref(false)
const compactHeaderMenuRef = ref<HTMLElement | null>(null)
const windowResolutionOptions = [
  { value: '800x600', label: '800 × 600' },
  { value: '1024x768', label: '1024 × 768' },
  { value: '1200x800', label: '1200 × 800' },
  { value: '1280x720', label: '1280 × 720' },
  { value: '1366x768', label: '1366 × 768' },
  { value: '1440x900', label: '1440 × 900' },
  { value: '1600x900', label: '1600 × 900' },
  { value: '1920x1080', label: '1920 × 1080' },
]
const selectedWindowResolution = computed(() => {
  const bounds = currentWindowBounds.value
  if (!bounds) return ''
  const exact = `${bounds.width}x${bounds.height}`
  return windowResolutionOptions.some((option) => option.value === exact) ? exact : 'custom'
})
const currentWindowResolutionLabel = computed(() => {
  const bounds = currentWindowBounds.value
  return bounds ? `${bounds.width} × ${bounds.height}` : 'Current window size'
})

async function refreshStrictMode() {
  try {
    const result = await invoke('strictMode:get')
    if (result?.success) {
      strictMode.value = {
        enabled: !!result.enabled,
        auditLog: result.auditLog || '',
      }
    }
  } catch {
    /* ignore */
  }
}

function applyWindowPresentationState(result: any) {
  overlayWindow.value.enabled = !!result?.overlayEnabled
  fullscreenWindow.value.enabled = !!result?.fullscreenEnabled
  if (result?.bounds && typeof result.bounds.width === 'number' && typeof result.bounds.height === 'number') {
    currentWindowBounds.value = {
      width: Math.round(result.bounds.width),
      height: Math.round(result.bounds.height),
    }
  }
  if (overlayWindow.value.enabled) sidebarOpen.value = false
  if (!overlayWindow.value.enabled) {
    showCompactHeaderMenu.value = false
    showCompactStatusDetails.value = false
  }
}

async function refreshOverlayWindowMode() {
  try {
    const result = await invoke('window:getViewState')
    if (result?.success) {
      applyWindowPresentationState(result)
    }
  } catch {
    /* ignore */
  }
}

async function toggleStrictMode() {
  const next = !strictMode.value.enabled
  const result = await invoke('strictMode:set', next)
  if (result?.success) {
    strictMode.value.enabled = !!result.enabled
    showToast(`Strict mode ${next ? 'enabled' : 'disabled'}`, 'success')
  } else {
    showToast(result?.error || 'Failed to toggle strict mode', 'error')
  }
}

async function toggleOverlayWindowMode() {
  const next = !overlayWindow.value.enabled
  const result = await invoke('window:setDisplayMode', next ? 'overlay' : 'normal')
  if (result?.success) {
    applyWindowPresentationState(result)
    showToast(next ? t('toast.overlayWindowEnabled') : t('toast.overlayWindowDisabled'), 'success')
  } else {
    showToast(result?.error || t('toast.overlayWindowFailed'), 'error')
  }
}

async function toggleFullscreenWindowMode() {
  const next = !fullscreenWindow.value.enabled
  const result = await invoke('window:setDisplayMode', next ? 'fullscreen' : 'normal')
  if (result?.success) {
    applyWindowPresentationState(result)
    showToast(next ? t('toast.fullscreenEnabled') : t('toast.fullscreenDisabled'), 'success')
  } else {
    showToast(result?.error || t('toast.fullscreenFailed'), 'error')
  }
}

async function applyWindowResolution(value: string) {
  if (!value || value === 'custom') return
  const [width, height] = value.split('x').map((part) => Number(part))
  if (!Number.isFinite(width) || !Number.isFinite(height)) return
  const result = await invoke('window:setResolution', { width, height })
  if (result?.success) {
    applyWindowPresentationState(result)
    showToast(`Window resolution set to ${Math.round(width)} × ${Math.round(height)}`, 'success')
  } else {
    showToast(result?.error || 'Failed to update window resolution', 'error')
  }
}

async function openAuditLog() {
  const result = await invoke('strictMode:openAuditLog')
  if (!result?.success) showToast(result?.error || 'Failed to open audit log', 'error')
}

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

function onRepoSelected(repo: ActiveCodingRepo) {
  store.activeCodingRepo = repo
  store.showCodeModal = false
}

function openCodingPickerFromPill() {
  store.codeModalMode = store.activeCodingRepo ? 'switch' : 'initial'
  store.showCodeModal = true
}

function exitCodingMode() {
  store.activeCodingRepo = null
}
const providerOrder = [
  'anthropic',
  'openai',
  'ollama',
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
    id: 'ollama',
    displayName: 'Ollama (Local)',
    models: [{ id: 'ollama-local', displayName: 'Detected Ollama Model' }],
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
const showLive2DPanel = ref(false)

const currentWaifuLive2D = computed(() => (store.selectedWaifu?.avatar as any)?.live2dModel ?? null)

// ── Floating Live2D panel placement ─────────────────────────────────────────
const LIVE2D_PANEL_STORAGE_KEY = 'syntax-senpai-live2d-panel'
const LIVE2D_PANEL_BASE_WIDTH = 280
const LIVE2D_PANEL_BASE_HEIGHT = 380
const LIVE2D_PANEL_MIN_WIDTH = 180
const LIVE2D_PANEL_MIN_HEIGHT = 240
const LIVE2D_PANEL_MAX_WIDTH = 760
const LIVE2D_PANEL_MAX_HEIGHT = 920
const LIVE2D_CHARACTER_MIN_SCALE = 0.35
const LIVE2D_CHARACTER_MAX_SCALE = 2.8
const LIVE2D_PANEL_MARGIN = 12
const LIVE2D_RENDER_SCALE_MIN = 1
const LIVE2D_RENDER_SCALE_MAX = 4
const LIVE2D_RENDER_SCALE_STEP = 0.5
const LIVE2D_RENDER_SCALE_DEFAULT = Math.min(
  LIVE2D_RENDER_SCALE_MAX,
  Math.max(
    LIVE2D_RENDER_SCALE_MIN,
    Math.round((typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) / LIVE2D_RENDER_SCALE_STEP) * LIVE2D_RENDER_SCALE_STEP,
  ),
)

const live2dPanelPosition = ref({ x: 0, y: 0 })
const live2dPanelSize = ref({ width: LIVE2D_PANEL_BASE_WIDTH, height: LIVE2D_PANEL_BASE_HEIGHT })
const live2dCharacterScale = ref(1)
const live2dCharacterOffset = ref({ x: 0, y: 0 })
const live2dRenderScale = ref(LIVE2D_RENDER_SCALE_DEFAULT)
const live2dPanelDragging = ref(false)
const live2dPanelResizing = ref(false)
const live2dCharacterDragging = ref(false)
let live2dPanelPointerStart = {
  pointerId: 0,
  clientX: 0,
  clientY: 0,
  x: 0,
  y: 0,
  width: LIVE2D_PANEL_BASE_WIDTH,
  height: LIVE2D_PANEL_BASE_HEIGHT,
  characterX: 0,
  characterY: 0,
  resizeEdge: '' as Live2DResizeEdge,
}

type Live2DResizeEdge = '' | 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const live2dResolutionOptions = [
  { value: '180x240', label: '180 × 240' },
  { value: '240x320', label: '240 × 320' },
  { value: '280x380', label: '280 × 380' },
  { value: '360x480', label: '360 × 480' },
  { value: '420x620', label: '420 × 620' },
  { value: '540x720', label: '540 × 720' },
  { value: '720x920', label: '720 × 920' },
]

const live2dRenderScaleOptions = [
  { value: 1,   label: '1× — Standard (lightest GPU)' },
  { value: 1.5, label: '1.5× — Slightly sharper' },
  { value: 2,   label: '2× — Sharp (Recommended for HiDPI)' },
  { value: 2.5, label: '2.5× — Very sharp' },
  { value: 3,   label: '3× — Ultra sharp (heavy GPU)' },
  { value: 4,   label: '4× — Maximum (very heavy GPU)' },
]

function clampLive2DRenderScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return LIVE2D_RENDER_SCALE_DEFAULT
  return Math.min(Math.max(value, LIVE2D_RENDER_SCALE_MIN), LIVE2D_RENDER_SCALE_MAX)
}
const live2dPanelWidth = computed(() => Math.round(live2dPanelSize.value.width))
const live2dPanelHeight = computed(() => Math.round(live2dPanelSize.value.height))
const selectedLive2DResolution = computed(() => {
  const exact = `${live2dPanelWidth.value}x${live2dPanelHeight.value}`
  return live2dResolutionOptions.some((option) => option.value === exact) ? exact : 'custom'
})
const currentLive2DResolutionLabel = computed(() => `${live2dPanelWidth.value} × ${live2dPanelHeight.value}`)
const live2dCharacterScalePercent = computed(() => Math.round(live2dCharacterScale.value * 100))
const live2dDevicePixelRatio = computed(() => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1))
const live2dBackingCanvasLabel = computed(
  () => `${Math.round(live2dPanelWidth.value * live2dRenderScale.value)} × ${Math.round(live2dPanelHeight.value * live2dRenderScale.value)}`,
)
const live2dPanelStyle = computed(() => ({
  width: `${live2dPanelWidth.value}px`,
  height: `${live2dPanelHeight.value}px`,
  left: `${live2dPanelPosition.value.x}px`,
  top: `${live2dPanelPosition.value.y}px`,
}))

function clampLive2DPanelPosition(x = live2dPanelPosition.value.x, y = live2dPanelPosition.value.y) {
  const maxX = Math.max(LIVE2D_PANEL_MARGIN, window.innerWidth - live2dPanelWidth.value - LIVE2D_PANEL_MARGIN)
  const maxY = Math.max(LIVE2D_PANEL_MARGIN, window.innerHeight - live2dPanelHeight.value - LIVE2D_PANEL_MARGIN)
  live2dPanelPosition.value = {
    x: Math.min(Math.max(x, LIVE2D_PANEL_MARGIN), maxX),
    y: Math.min(Math.max(y, LIVE2D_PANEL_MARGIN), maxY),
  }
}

function saveLive2DPanelLayout() {
  try {
    localStorage.setItem(LIVE2D_PANEL_STORAGE_KEY, JSON.stringify({
      x: live2dPanelPosition.value.x,
      y: live2dPanelPosition.value.y,
      width: live2dPanelSize.value.width,
      height: live2dPanelSize.value.height,
      characterScale: live2dCharacterScale.value,
      characterOffsetX: live2dCharacterOffset.value.x,
      characterOffsetY: live2dCharacterOffset.value.y,
      renderScale: live2dRenderScale.value,
    }))
  } catch {
    /* localStorage may be unavailable; placement can remain session-only. */
  }
}

function loadLive2DPanelLayout() {
  const fallbackX = window.innerWidth - LIVE2D_PANEL_BASE_WIDTH - 16
  const fallbackY = window.innerHeight - LIVE2D_PANEL_BASE_HEIGHT - 80
  try {
    const raw = localStorage.getItem(LIVE2D_PANEL_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const legacyScale = typeof parsed.scale === 'number' ? parsed.scale : 1
      live2dPanelSize.value = {
        width: Math.min(Math.max(
          typeof parsed.width === 'number' ? parsed.width : LIVE2D_PANEL_BASE_WIDTH * legacyScale,
          LIVE2D_PANEL_MIN_WIDTH,
        ), LIVE2D_PANEL_MAX_WIDTH),
        height: Math.min(Math.max(
          typeof parsed.height === 'number' ? parsed.height : LIVE2D_PANEL_BASE_HEIGHT * legacyScale,
          LIVE2D_PANEL_MIN_HEIGHT,
        ), LIVE2D_PANEL_MAX_HEIGHT),
      }
      live2dCharacterScale.value = Math.min(Math.max(
        typeof parsed.characterScale === 'number' ? parsed.characterScale : 1,
        LIVE2D_CHARACTER_MIN_SCALE,
      ), LIVE2D_CHARACTER_MAX_SCALE)
      live2dCharacterOffset.value = {
        x: typeof parsed.characterOffsetX === 'number' ? parsed.characterOffsetX : 0,
        y: typeof parsed.characterOffsetY === 'number' ? parsed.characterOffsetY : 0,
      }
      live2dRenderScale.value = clampLive2DRenderScale(
        typeof parsed.renderScale === 'number' ? parsed.renderScale : LIVE2D_RENDER_SCALE_DEFAULT,
      )
      clampLive2DPanelPosition(
        typeof parsed.x === 'number' ? parsed.x : fallbackX,
        typeof parsed.y === 'number' ? parsed.y : fallbackY,
      )
      return
    }
  } catch {
    /* Fall through to default placement. */
  }
  clampLive2DPanelPosition(fallbackX, fallbackY)
}

function resetLive2DPanelLayout() {
  live2dPanelSize.value = { width: LIVE2D_PANEL_BASE_WIDTH, height: LIVE2D_PANEL_BASE_HEIGHT }
  live2dCharacterScale.value = 1
  live2dCharacterOffset.value = { x: 0, y: 0 }
  live2dRenderScale.value = LIVE2D_RENDER_SCALE_DEFAULT
  clampLive2DPanelPosition(
    window.innerWidth - LIVE2D_PANEL_BASE_WIDTH - 16,
    window.innerHeight - LIVE2D_PANEL_BASE_HEIGHT - 80,
  )
  saveLive2DPanelLayout()
}

function applyLive2DRenderScale(rawValue: string | number) {
  const value = typeof rawValue === 'string' ? Number(rawValue) : rawValue
  const next = clampLive2DRenderScale(value)
  if (live2dRenderScale.value === next) return
  live2dRenderScale.value = next
  saveLive2DPanelLayout()
  showToast(`Live2D render quality set to ${next}×`, 'success')
}

function applyLive2DResolution(value: string) {
  if (!value || value === 'custom') return
  const [rawWidth, rawHeight] = value.split('x').map((part) => Number(part))
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight)) return
  live2dPanelSize.value = {
    width: Math.min(Math.max(rawWidth, LIVE2D_PANEL_MIN_WIDTH), LIVE2D_PANEL_MAX_WIDTH),
    height: Math.min(Math.max(rawHeight, LIVE2D_PANEL_MIN_HEIGHT), LIVE2D_PANEL_MAX_HEIGHT),
  }
  clampLive2DPanelPosition()
  saveLive2DPanelLayout()
  showToast(`Live2D resolution set to ${live2dPanelWidth.value} × ${live2dPanelHeight.value}`, 'success')
}

function beginLive2DPanelDrag(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-live2d-panel-control]')) return
  live2dPanelDragging.value = true
  live2dPanelPointerStart = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    x: live2dPanelPosition.value.x,
    y: live2dPanelPosition.value.y,
    width: live2dPanelSize.value.width,
    height: live2dPanelSize.value.height,
    characterX: live2dCharacterOffset.value.x,
    characterY: live2dCharacterOffset.value.y,
    resizeEdge: '',
  }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function beginLive2DPanelResize(event: PointerEvent, resizeEdge: Live2DResizeEdge) {
  if (event.button !== 0) return
  live2dPanelResizing.value = true
  live2dPanelPointerStart = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    x: live2dPanelPosition.value.x,
    y: live2dPanelPosition.value.y,
    width: live2dPanelSize.value.width,
    height: live2dPanelSize.value.height,
    characterX: live2dCharacterOffset.value.x,
    characterY: live2dCharacterOffset.value.y,
    resizeEdge,
  }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  event.preventDefault()
  event.stopPropagation()
}

function beginLive2DCharacterDrag(event: PointerEvent) {
  if (event.button !== 0) return
  live2dCharacterDragging.value = true
  live2dPanelPointerStart = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    x: live2dPanelPosition.value.x,
    y: live2dPanelPosition.value.y,
    width: live2dPanelSize.value.width,
    height: live2dPanelSize.value.height,
    characterX: live2dCharacterOffset.value.x,
    characterY: live2dCharacterOffset.value.y,
    resizeEdge: '',
  }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  event.preventDefault()
  event.stopPropagation()
}

function resizeLive2DPanel(event: PointerEvent) {
  const dx = event.clientX - live2dPanelPointerStart.clientX
  const dy = event.clientY - live2dPanelPointerStart.clientY
  const edge = live2dPanelPointerStart.resizeEdge
  let nextX = live2dPanelPointerStart.x
  let nextY = live2dPanelPointerStart.y
  let nextWidth = live2dPanelPointerStart.width
  let nextHeight = live2dPanelPointerStart.height

  if (edge.includes('e')) nextWidth = live2dPanelPointerStart.width + dx
  if (edge.includes('s')) nextHeight = live2dPanelPointerStart.height + dy
  if (edge.includes('w')) {
    nextWidth = live2dPanelPointerStart.width - dx
    nextX = live2dPanelPointerStart.x + dx
  }
  if (edge.includes('n')) {
    nextHeight = live2dPanelPointerStart.height - dy
    nextY = live2dPanelPointerStart.y + dy
  }

  const clampedWidth = Math.min(Math.max(nextWidth, LIVE2D_PANEL_MIN_WIDTH), Math.min(LIVE2D_PANEL_MAX_WIDTH, window.innerWidth - LIVE2D_PANEL_MARGIN * 2))
  const clampedHeight = Math.min(Math.max(nextHeight, LIVE2D_PANEL_MIN_HEIGHT), Math.min(LIVE2D_PANEL_MAX_HEIGHT, window.innerHeight - LIVE2D_PANEL_MARGIN * 2))
  if (edge.includes('w')) nextX += nextWidth - clampedWidth
  if (edge.includes('n')) nextY += nextHeight - clampedHeight
  live2dPanelSize.value = { width: clampedWidth, height: clampedHeight }
  clampLive2DPanelPosition(nextX, nextY)
}

function updateLive2DPanelPointer(event: PointerEvent) {
  if (!live2dPanelDragging.value && !live2dPanelResizing.value && !live2dCharacterDragging.value) return
  if (event.pointerId !== live2dPanelPointerStart.pointerId) return
  if (live2dPanelDragging.value) {
    clampLive2DPanelPosition(
      live2dPanelPointerStart.x + event.clientX - live2dPanelPointerStart.clientX,
      live2dPanelPointerStart.y + event.clientY - live2dPanelPointerStart.clientY,
    )
    return
  }
  if (live2dPanelResizing.value) {
    resizeLive2DPanel(event)
    return
  }
  if (live2dCharacterDragging.value) {
    live2dCharacterOffset.value = {
      x: live2dPanelPointerStart.characterX + event.clientX - live2dPanelPointerStart.clientX,
      y: live2dPanelPointerStart.characterY + event.clientY - live2dPanelPointerStart.clientY,
    }
  }
}

function endLive2DPanelPointer(event: PointerEvent) {
  if (event.pointerId !== live2dPanelPointerStart.pointerId) return
  if (!live2dPanelDragging.value && !live2dPanelResizing.value && !live2dCharacterDragging.value) return
  live2dPanelDragging.value = false
  live2dPanelResizing.value = false
  live2dCharacterDragging.value = false
  saveLive2DPanelLayout()
}

function handleLive2DPanelViewportResize() {
  clampLive2DPanelPosition()
}

function handleLive2DCharacterWheel(event: WheelEvent) {
  event.preventDefault()
  const direction = event.deltaY < 0 ? 1 : -1
  const step = event.altKey ? 0.03 : 0.08
  live2dCharacterScale.value = Math.min(
    Math.max(live2dCharacterScale.value + direction * step, LIVE2D_CHARACTER_MIN_SCALE),
    LIVE2D_CHARACTER_MAX_SCALE,
  )
  saveLive2DPanelLayout()
}

// ── Live2D import tab state ─────────────────────────────────────────────────
const live2dImporting = ref(false)
const live2dImportedPath = ref('')
const live2dImportedName = ref('')

// ── Cubism Core SDK state ───────────────────────────────────────────────────
type CubismCoreStatus = {
  installed: boolean
  path: string
  size: number | null
  installedAt: string | null
}
const cubismCoreStatus = ref<CubismCoreStatus | null>(null)
const cubismCoreInstalling = ref(false)
const cubismCoreError = ref('')

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} bytes`
}

async function refreshCubismCoreStatus() {
  try {
    const result = await invoke('waifus:getCubismCoreStatus')
    if (result?.success) {
      cubismCoreStatus.value = {
        installed: !!result.installed,
        path: String(result.path || ''),
        size: typeof result.size === 'number' ? result.size : null,
        installedAt: result.installedAt ?? null,
      }
    }
  } catch {
    /* non-fatal; tab will just show unknown */
  }
}

async function installCubismCore(force = false) {
  cubismCoreInstalling.value = true
  cubismCoreError.value = ''
  try {
    const result = await invoke('waifus:installCubismCore', { force })
    if (result?.success) {
      const verb = result.fromCache ? 'already installed' : 'installed'
      showToast(`Cubism Core SDK ${verb} (${formatBytes(result.size)})`, 'success')
      await refreshCubismCoreStatus()
    } else {
      cubismCoreError.value = result?.error || 'Failed to install Cubism Core SDK'
      showToast(cubismCoreError.value, 'error')
    }
  } catch (err: any) {
    cubismCoreError.value = err?.message || String(err)
    showToast(cubismCoreError.value, 'error')
  } finally {
    cubismCoreInstalling.value = false
  }
}

async function importLive2DModelForCurrentWaifu() {
  live2dImporting.value = true
  try {
    const result = await invoke('waifus:importLive2DModel')
    if (result?.success) {
      live2dImportedPath.value = result.modelJsonPath
      live2dImportedName.value = result.displayName
      showToast(`Live2D model "${result.displayName}" imported!`, 'success')
    } else if (!result?.canceled) {
      showToast(result?.error || 'Could not import model', 'error')
    }
  } catch (err: any) {
    showToast(err?.message || String(err), 'error')
  } finally {
    live2dImporting.value = false
  }
}

async function assignLive2DToCurrentWaifu() {
  if (!live2dImportedPath.value || !store.selectedWaifu) return
  try {
    const result = await invoke('waifus:update', {
      id: store.selectedWaifu.id,
      avatar: {
        ...(store.selectedWaifu.avatar ?? {}),
        live2dModel: {
          modelJsonPath: live2dImportedPath.value,
          displayName: live2dImportedName.value,
        },
      },
    })
    if (!result?.success) {
      showToast(result?.error || 'Failed to assign Live2D model', 'error')
      return
    }
    await store.refreshCustomWaifus()
    showToast(`Live2D model assigned to ${store.selectedWaifu.name}!`, 'success')
    live2dImportedPath.value = ''
    live2dImportedName.value = ''
  } catch (err: any) {
    showToast(err?.message || String(err), 'error')
  }
}

async function removeLive2DFromCurrentWaifu() {
  if (!store.selectedWaifu) return
  try {
    const result = await invoke('waifus:update', {
      id: store.selectedWaifu.id,
      avatar: {
        ...(store.selectedWaifu.avatar ?? {}),
        live2dModel: null,
      },
    })
    if (!result?.success) {
      showToast(result?.error || 'Failed to remove Live2D model', 'error')
      return
    }
    await store.refreshCustomWaifus()
    showToast('Live2D model removed.', 'success')
  } catch (err: any) {
    showToast(err?.message || String(err), 'error')
  }
}
const latestSentimentExpression = computed(() => {
  for (let i = store.messages.length - 1; i >= 0; i--) {
    const m = (store.messages as any[])[i]
    if (m.role === 'assistant' && m.sentiment?.expression) return m.sentiment.expression
  }
  return 'neutral'
})

// Lazy-refresh plugin and custom-waifu lists when their tabs become visible,
// so Settings stays fast to open and data is fresh when the user gets there.
watch(
  () => [showSettings.value, settingsTab.value] as const,
  ([open, tab]) => {
    if (!open) return
    if (tab === 'plugins') {
      if (pluginsList.value.length === 0 && !pluginsLoading.value) refreshPlugins()
      // Pending proposals are cheap to list — always refresh so a new
      // propose_tool call mid-session shows up without a reload.
      refreshPendingPlugins()
    }
    if (tab === 'skills' && skillsList.value.length === 0 && !skillsLoading.value) {
      refreshSkillsTab()
    }
    if (tab === 'waifus' && customWaifus.value.length === 0 && !customWaifusLoading.value) {
      refreshCustomWaifus()
    }
    if (tab === 'general') {
      refreshStrictMode()
      refreshOverlayWindowMode()
    }
  },
)
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
let removeWechatInboundListener: (() => void) | null = null
let removeWechatStatusListener: (() => void) | null = null
let removeTrayNewChatListener: (() => void) | null = null
const wechatStatus = ref<{ connected: boolean; account: { userId: string; displayName: string | null } | null; lastError: string | null; pairing?: boolean }>({ connected: false, account: null, lastError: null })
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
  overlayWindow.value.enabled
    ? (locale.value === 'en' ? 'w-38' : 'w-34')
    : (locale.value === 'en' ? 'w-70' : 'w-52'),
)

const compactChatLayout = computed(() => overlayWindow.value.enabled)
const hasStatusStrip = computed(() =>
  store.usageTotals.turns > 0 || store.activeTodoList.length > 0 || (contextWindowSize.value > 0 && store.messages.length > 0),
)
const compactStatusSummary = computed(() => {
  const parts: string[] = []
  if (store.usageTotals.turns > 0) parts.push(`${store.usageTotals.turns} turns`)
  if (contextWindowSize.value > 0 && store.messages.length > 0) parts.push(`ctx ${contextUsagePercent.value}%`)
  if (store.activeTodoList.length > 0) parts.push(`${store.activeTodoList.length} todo`)
  return parts.join(' · ')
})

function toggleCompactHeaderMenu() {
  showCompactHeaderMenu.value = !showCompactHeaderMenu.value
}

function toggleCompactStatusDetails() {
  showCompactStatusDetails.value = !showCompactStatusDetails.value
}

function openAgentPanel() {
  showCompactHeaderMenu.value = false
  showAgent.value = true
}

function openMemoryPanel() {
  showCompactHeaderMenu.value = false
  showMemory.value = true
}

function openSettingsPanel() {
  showCompactHeaderMenu.value = false
  showSettings.value = true
}

function onGlobalPointerDown(e: PointerEvent) {
  if (!showCompactHeaderMenu.value) return
  const target = e.target as Node | null
  if (compactHeaderMenuRef.value && target && !compactHeaderMenuRef.value.contains(target)) {
    showCompactHeaderMenu.value = false
  }
}

const appShellStyle = computed(() => ({
  background: overlayWindow.value.enabled
    ? 'transparent'
    : `linear-gradient(135deg, ${theme.value.colors.bg}, ${theme.value.colors.surface})`,
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
function onAppMilestone(e: Event) {
  const detail = (e as CustomEvent).detail
  if (typeof detail === 'string' && detail) showToast(detail, 'success')
}
function onAppMemoryUpdated(e: Event) {
  const detail = (e as CustomEvent).detail as {
    added?: Array<{ key: string; value: string }>
    deleted?: string[]
  } | undefined
  const added = Array.isArray(detail?.added) ? detail.added : []
  const deleted = Array.isArray(detail?.deleted) ? detail.deleted : []
  const previews: string[] = []

  if (added.length > 0) {
    const addedPreview = added.slice(0, 2).map((entry) => `${entry.key}: ${entry.value}`).join(' · ')
    const suffix = added.length > 2 ? ` +${added.length - 2}` : ''
    previews.push(t('toast.memorySavedWithDetails', { items: `${addedPreview}${suffix}` }))
  }

  if (deleted.length > 0) {
    const deletedPreview = deleted.slice(0, 3).join(' · ')
    const suffix = deleted.length > 3 ? ` +${deleted.length - 3}` : ''
    previews.push(t('toast.memoryDeletedWithDetails', { items: `${deletedPreview}${suffix}` }))
  }

  if (previews.length > 0) showToast(previews.join(' / '), 'success')
}
function onAppSkillCreated(e: Event) {
  const detail: any = (e as CustomEvent).detail
  // Refresh store + Settings-tab views so the new skill is immediately
  // in the system prompt and visible in the UI.
  store.refreshAvailableSkills()
  refreshSkillsTab()
  if (detail?.slug) showToast(`Skill "${detail.slug}" saved`, 'success')
}
function onAppToolProposed(e: Event) {
  const detail: any = (e as CustomEvent).detail
  refreshPendingPlugins()
  const name = detail?.name || detail?.slug || 'a new tool'
  showToast(`${name} proposed — review it in Settings → Plugins → Pending`, 'success')
}

function onGlobalKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  const target = e.target as HTMLElement | null
  const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

  // Esc closes the topmost modal.
  if (e.key === 'Escape') {
    if (showCompactHeaderMenu.value) { showCompactHeaderMenu.value = false; e.preventDefault(); return }
    if (showCompactStatusDetails.value) { showCompactStatusDetails.value = false; e.preventDefault(); return }
    if (showRenameConversationModal.value) { closeRenameConversationModal(); e.preventDefault(); return }
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
  loadLive2DPanelLayout()
  ;(async () => {
    store.loadSetup()
    await store.hydrateProviderConfig()
    await loadProviderModels(store.selectedProvider, store.apiKey)
    await refreshOverlayWindowMode()
    // Hydrate user-authored waifus so they appear in pickers from the
    // first paint, not just after someone opens Settings → Waifus.
    store.refreshCustomWaifus()
    // Ask main for the enabled plugins' tool definitions. Idempotent —
    // cached after first call — so getToolsForMode() can stay synchronous.
    loadPluginTools()
    // Load waifu-authored skills so the first system prompt already
    // lists what's available.
    store.refreshAvailableSkills()
    // Refresh Cubism Core install status so the Live2D tab can show it
    // immediately without a round-trip when first opened.
    refreshCubismCoreStatus()
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

  removeWechatInboundListener = on('wechat:inbound', async (payload: any) => {
    try {
      await store.handleWeChatInbound(payload)
    } catch (err) {
      console.warn('wechat:inbound handler failed', err)
    }
  })

  removeWechatStatusListener = on('wechat:status-changed', (payload: any) => {
    wechatStatus.value = {
      connected: !!payload?.connected,
      account: payload?.account ?? null,
      lastError: payload?.lastError ?? null,
    }
  })

  // Hydrate WeChat status on boot — surfaces auto-resumed sessions in the UI.
  ;(async () => {
    try {
      const res = await invoke('wechat:getStatus')
      if (res?.success) {
        wechatStatus.value = {
          connected: !!res.connected,
          account: res.account ?? null,
          lastError: res.lastError ?? null,
          pairing: !!res.pairing,
        }
      }
    } catch { /* optional */ }
  })()

  removeTrayNewChatListener = on('tray:new-chat', () => {
    store.newChat()
  })

  window.addEventListener('app:error', onAppError as EventListener)
  window.addEventListener('app:retry', onAppRetry as EventListener)
  window.addEventListener('app:milestone', onAppMilestone as EventListener)
  window.addEventListener('app:memory-updated', onAppMemoryUpdated as EventListener)
  window.addEventListener('app:skill-created', onAppSkillCreated as EventListener)
  window.addEventListener('app:tool-proposed', onAppToolProposed as EventListener)
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('pointerdown', onGlobalPointerDown)
  window.addEventListener('pointermove', updateLive2DPanelPointer)
  window.addEventListener('pointerup', endLive2DPanelPointer)
  window.addEventListener('pointercancel', endLive2DPanelPointer)
  window.addEventListener('resize', handleLive2DPanelViewportResize)

  startupSplashTimer = window.setTimeout(() => {
    showStartupSplash.value = false
    nextTick(() => { appReady.value = true })
    // Clear startup animation classes after they finish so they don't conflict with toggle transitions
    window.setTimeout(() => { startupAnimDone.value = true }, 2500)
  }, 1200)
})

onUnmounted(() => {
  removeMobileChatListener?.()
  removeWechatInboundListener?.()
  removeWechatStatusListener?.()
  removeTrayNewChatListener?.()
  window.removeEventListener('app:error', onAppError as EventListener)
  window.removeEventListener('app:retry', onAppRetry as EventListener)
  window.removeEventListener('app:milestone', onAppMilestone as EventListener)
  window.removeEventListener('app:memory-updated', onAppMemoryUpdated as EventListener)
  window.removeEventListener('app:skill-created', onAppSkillCreated as EventListener)
  window.removeEventListener('app:tool-proposed', onAppToolProposed as EventListener)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('pointerdown', onGlobalPointerDown)
  window.removeEventListener('pointermove', updateLive2DPanelPointer)
  window.removeEventListener('pointerup', endLive2DPanelPointer)
  window.removeEventListener('pointercancel', endLive2DPanelPointer)
  window.removeEventListener('resize', handleLive2DPanelViewportResize)
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
  // Load provider preferences (baseUrl for Ollama) before fetching models
  try {
    const prefs = JSON.parse(localStorage.getItem('syntax-senpai-provider-preferences') || '{}')
    const p = prefs[provider] || {}
    if (provider === 'ollama') {
      ollamaBaseUrl.value = p.baseUrl || (import.meta.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434')
    }
  } catch {
    if (provider === 'ollama') ollamaBaseUrl.value = import.meta.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434'
  }
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

// Auto-relay the final assistant message back to WeChat when the active
// conversation is bound to a WeChat peer. Fires on the isLoading true→false
// transition so we catch the post-tool-loop finalization regardless of which
// code path produced the message.
watch(() => store.isLoading, (now, prev) => {
  if (!(prev === true && now === false)) return
  const binding = store.currentWeChatBinding
  if (!binding) return
  const convId = store.conversationId
  if (!convId) return
  const last = store.messages[store.messages.length - 1]
  if (!last || last.role !== 'assistant') return
  const content = (last.content ?? '').toString()
  if (!content.trim()) return
  // Skip echoing back error bubbles produced by the chat store's catch block.
  if (content.startsWith('Error: ')) return
  store.relayAssistantToWeChat(convId, content).catch(() => { /* best effort */ })
})

watch(() => store.apiTelemetryAlert, (alert, previous) => {
  if (!alert.active) return
  if (previous?.triggeredAt === alert.triggeredAt) return
  showToast(alert.message, 'error')
}, { deep: true })

async function loadProviderModels(provider: string, apiKeyValue: string) {
  const baseUrlArg = provider === 'ollama' ? (ollamaBaseUrl.value || import.meta.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434') : ''
  const res = await (window as any).electron?.ipcRenderer?.invoke('provider:listModels', provider, apiKeyValue || '', baseUrlArg)
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
    const baseUrlArg = store.selectedProvider === 'ollama' ? (ollamaBaseUrl.value || import.meta.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434') : ''
    const validation = await (window as any).electron?.ipcRenderer?.invoke(
      'provider:validateKey',
      store.selectedProvider,
      trimmedKey,
      baseUrlArg,
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
    // Save baseUrl for Ollama in provider preferences
    try {
      if (store.selectedProvider === 'ollama') {
        const prefs = JSON.parse(localStorage.getItem('syntax-senpai-provider-preferences') || '{}')
        prefs[store.selectedProvider] = { ...(prefs[store.selectedProvider] || {}), baseUrl: ollamaBaseUrl.value }
        localStorage.setItem('syntax-senpai-provider-preferences', JSON.stringify(prefs))
      }
    } catch {
      /* best effort */
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
        webSearchEnabled: store.webSearchEnabled,
        overlayWindowEnabled: overlayWindow.value.enabled,
        proactiveChatEnabled: store.proactiveChatEnabled,
        proactiveChatIdleFollowUpEnabled: store.proactiveChatIdleFollowUpEnabled,
        proactiveChatOnlineGreetingEnabled: store.proactiveChatOnlineGreetingEnabled,
        proactiveChatWorkHoursEnabled: store.proactiveChatWorkHoursEnabled,
        proactiveChatWorkHoursStart: store.proactiveChatWorkHoursStart,
        proactiveChatWorkHoursEnd: store.proactiveChatWorkHoursEnd,
        proactiveChatDoNotDisturbEnabled: store.proactiveChatDoNotDisturbEnabled,
        proactiveChatDoNotDisturbStart: store.proactiveChatDoNotDisturbStart,
        proactiveChatDoNotDisturbEnd: store.proactiveChatDoNotDisturbEnd,
        proactiveChatIntervalMinutes: store.proactiveChatIntervalMinutes,
        proactiveChatTemperature: store.proactiveChatTemperature,
        proactiveChatLongGapHours: store.proactiveChatLongGapHours,
        affection: readLocalStorageJson('syntax-senpai-affection'),
        apiTelemetryHistory: readLocalStorageJson(API_TELEMETRY_HISTORY_STORAGE_KEY),
        enableTimeoutsAndIterationCaps: store.enableTimeoutsAndIterationCaps,
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
    if (typeof payload?.settings?.webSearchEnabled === 'boolean') {
      store.setWebSearchEnabled(payload.settings.webSearchEnabled)
    }
    if (typeof payload?.settings?.overlayWindowEnabled === 'boolean') {
      const overlayResult = await invoke('window:setOverlayMode', payload.settings.overlayWindowEnabled)
      if (overlayResult?.success) {
        overlayWindow.value.enabled = !!overlayResult.enabled
      }
    }
    if (typeof payload?.settings?.proactiveChatEnabled === 'boolean') {
      store.setProactiveChatEnabled(payload.settings.proactiveChatEnabled)
    }
    if (typeof payload?.settings?.proactiveChatIdleFollowUpEnabled === 'boolean') {
      store.setProactiveChatIdleFollowUpEnabled(payload.settings.proactiveChatIdleFollowUpEnabled)
    }
    if (typeof payload?.settings?.proactiveChatOnlineGreetingEnabled === 'boolean') {
      store.setProactiveChatOnlineGreetingEnabled(payload.settings.proactiveChatOnlineGreetingEnabled)
    }
    if (typeof payload?.settings?.proactiveChatWorkHoursEnabled === 'boolean') {
      store.setProactiveChatWorkHoursEnabled(payload.settings.proactiveChatWorkHoursEnabled)
    }
    if (typeof payload?.settings?.proactiveChatWorkHoursStart === 'string') {
      store.setProactiveChatWorkHoursStart(payload.settings.proactiveChatWorkHoursStart)
    }
    if (typeof payload?.settings?.proactiveChatWorkHoursEnd === 'string') {
      store.setProactiveChatWorkHoursEnd(payload.settings.proactiveChatWorkHoursEnd)
    }
    if (typeof payload?.settings?.proactiveChatDoNotDisturbEnabled === 'boolean') {
      store.setProactiveChatDoNotDisturbEnabled(payload.settings.proactiveChatDoNotDisturbEnabled)
    }
    if (typeof payload?.settings?.proactiveChatDoNotDisturbStart === 'string') {
      store.setProactiveChatDoNotDisturbStart(payload.settings.proactiveChatDoNotDisturbStart)
    }
    if (typeof payload?.settings?.proactiveChatDoNotDisturbEnd === 'string') {
      store.setProactiveChatDoNotDisturbEnd(payload.settings.proactiveChatDoNotDisturbEnd)
    }
    if (typeof payload?.settings?.proactiveChatIntervalMinutes === 'number') {
      store.setProactiveChatIntervalMinutes(payload.settings.proactiveChatIntervalMinutes)
    }
    if (typeof payload?.settings?.proactiveChatTemperature === 'number') {
      store.setProactiveChatTemperature(payload.settings.proactiveChatTemperature)
    }
    if (typeof payload?.settings?.proactiveChatLongGapHours === 'number') {
      store.setProactiveChatLongGapHours(payload.settings.proactiveChatLongGapHours)
    }
    if (typeof payload?.settings?.enableTimeoutsAndIterationCaps === 'boolean') {
      store.setEnableTimeoutsAndIterationCaps(payload.settings.enableTimeoutsAndIterationCaps)
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
  <!-- Skip link: first focusable element so keyboard users can jump past the
       sidebar / header directly to the message input. -->
  <a href="#chat-input" class="skip-link">Skip to chat input</a>

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

  <Teleport to="body">
    <Transition name="modal-backdrop">
      <div
        v-if="showRenameConversationModal"
        class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[90]"
        @click.self="closeRenameConversationModal()"
      >
        <div class="modal-glass rounded-t-3xl sm:rounded-2xl p-6 max-w-md w-full mx-0 sm:mx-4">
          <h2 class="text-xl font-bold text-white mb-2">
            {{ t('conversation.renameTitle') }}
          </h2>
          <p class="text-sm text-neutral-400 mb-5">
            {{ t('conversation.renamePrompt') }}
          </p>

          <input
            ref="renameConversationInputRef"
            v-model="renameConversationValue"
            class="input-field mb-6"
            maxlength="120"
            @keydown.enter.prevent="submitRenameConversation()"
          >

          <div class="flex gap-2">
            <button class="btn-secondary flex-1" @click="closeRenameConversationModal()">
              {{ t('settings.cancel') }}
            </button>
            <button class="btn-primary flex-1" @click="submitRenameConversation()">
              {{ t('settings.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
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
        :class="[
          'fixed inset-0 z-[-1] flex items-center justify-center overflow-hidden',
          compactChatLayout ? 'bg-transparent' : 'bg-neutral-950',
        ]"
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        @click.self="showSettings = false"
      >
          <div
            class="settings-glass relative rounded-t-3xl sm:rounded-3xl max-w-6xl w-full mx-0 sm:mx-4 max-h-[92vh] overflow-hidden flex"
          >
            <h2 id="settings-dialog-title" class="sr-only">Settings</h2>
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
                  @click="settingsTab = tab.id; if (tab.id === 'mobile') checkMobilePairingStatus(); if (tab.id === 'live2d') refreshCubismCoreStatus()"
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
                <option v-for="w in store.allWaifus" :key="w.id" :value="w.id">
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
                    v-for="w in store.allWaifus"
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

            <div class="settings-card mt-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="text-sm font-semibold text-neutral-200">{{ t('settings.overlayWindow') }}</div>
                  <p class="mt-1 text-xs text-neutral-400">
                    {{ t('settings.overlayWindowDescription') }}
                  </p>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-all duration-300 cursor-pointer shrink-0"
                  :style="{ background: overlayWindow.enabled ? 'linear-gradient(90deg,#22c55e,#06b6d4)' : '#404040' }"
                  :aria-label="`${overlayWindow.enabled ? 'Disable' : 'Enable'} overlay window`"
                  @click="toggleOverlayWindowMode"
                >
                  <span
                    class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                    :style="{ transform: overlayWindow.enabled ? 'translateX(20px)' : 'translateX(0)' }"
                  />
                </button>
              </div>
              <p class="mt-4 text-[11px] text-neutral-500">
                {{ t('settings.overlayWindowHint') }}
              </p>
            </div>

            <div class="settings-card mt-4">
              <div class="mb-3">
                <div class="text-sm font-semibold text-neutral-200">Window resolution</div>
                <p class="mt-1 text-xs text-neutral-400">
                  Pick a saved app window size. Selecting a resolution centers the window and stores it for the current display mode.
                </p>
              </div>
              <select
                :value="selectedWindowResolution"
                class="input-field"
                @change="applyWindowResolution(($event.target as HTMLSelectElement).value)"
              >
                <option value="custom">{{ currentWindowResolutionLabel }}</option>
                <option
                  v-for="option in windowResolutionOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
              <p v-if="fullscreenWindow.enabled" class="mt-2 text-[11px] text-amber-300">
                Choosing a resolution exits fullscreen and applies the selected window size.
              </p>
            </div>

            <div class="settings-card mt-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="text-sm font-semibold text-neutral-200">{{ t('settings.proactiveChat') }}</div>
                  <p class="mt-1 text-xs text-neutral-400">
                    {{ t('settings.proactiveChatDescription') }}
                  </p>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-all duration-300 cursor-pointer shrink-0"
                  :style="{ background: store.proactiveChatEnabled ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : '#404040' }"
                  :aria-label="`${store.proactiveChatEnabled ? 'Disable' : 'Enable'} proactive chat`"
                  @click="store.setProactiveChatEnabled(!store.proactiveChatEnabled)"
                >
                  <span
                    class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                    :style="{ transform: store.proactiveChatEnabled ? 'translateX(20px)' : 'translateX(0)' }"
                  />
                </button>
              </div>

              <div class="mt-4">
                <div class="flex items-center justify-between gap-4 rounded-2xl border border-neutral-800/70 bg-neutral-950/35 px-4 py-3">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                      {{ t('settings.proactiveChatIdleFollowUp') }}
                    </div>
                    <p class="mt-1 text-[11px] text-neutral-500">
                      {{ t('settings.proactiveChatIdleFollowUpHint') }}
                    </p>
                  </div>
                  <button
                    class="relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 cursor-pointer"
                    :disabled="!store.proactiveChatEnabled"
                    :style="{ background: store.proactiveChatEnabled && store.proactiveChatIdleFollowUpEnabled ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : '#404040', opacity: store.proactiveChatEnabled ? 1 : 0.5 }"
                    :aria-label="`${store.proactiveChatIdleFollowUpEnabled ? 'Disable' : 'Enable'} idle proactive follow-up`"
                    @click="store.setProactiveChatIdleFollowUpEnabled(!store.proactiveChatIdleFollowUpEnabled)"
                  >
                    <span
                      class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                      :style="{ transform: store.proactiveChatIdleFollowUpEnabled ? 'translateX(20px)' : 'translateX(0)' }"
                    />
                  </button>
                </div>

                <div class="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-neutral-800/70 bg-neutral-950/35 px-4 py-3">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                      {{ t('settings.proactiveChatOnlineGreeting') }}
                    </div>
                    <p class="mt-1 text-[11px] text-neutral-500">
                      {{ t('settings.proactiveChatOnlineGreetingHint') }}
                    </p>
                  </div>
                  <button
                    class="relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 cursor-pointer"
                    :disabled="!store.proactiveChatEnabled"
                    :style="{ background: store.proactiveChatEnabled && store.proactiveChatOnlineGreetingEnabled ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : '#404040', opacity: store.proactiveChatEnabled ? 1 : 0.5 }"
                    :aria-label="`${store.proactiveChatOnlineGreetingEnabled ? 'Disable' : 'Enable'} online proactive greeting`"
                    @click="store.setProactiveChatOnlineGreetingEnabled(!store.proactiveChatOnlineGreetingEnabled)"
                  >
                    <span
                      class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                      :style="{ transform: store.proactiveChatOnlineGreetingEnabled ? 'translateX(20px)' : 'translateX(0)' }"
                    />
                  </button>
                </div>

                <div class="mt-3 rounded-2xl border border-neutral-800/70 bg-neutral-950/35 px-4 py-3">
                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                        {{ t('settings.proactiveChatWorkHours') }}
                      </div>
                      <p class="mt-1 text-[11px] text-neutral-500">
                        {{ t('settings.proactiveChatWorkHoursHint', { start: store.proactiveChatWorkHoursStart, end: store.proactiveChatWorkHoursEnd }) }}
                      </p>
                    </div>
                    <button
                      class="relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 cursor-pointer"
                      :disabled="!store.proactiveChatEnabled"
                      :style="{ background: store.proactiveChatEnabled && store.proactiveChatWorkHoursEnabled ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : '#404040', opacity: store.proactiveChatEnabled ? 1 : 0.5 }"
                      :aria-label="`${store.proactiveChatWorkHoursEnabled ? 'Disable' : 'Enable'} proactive work hours`"
                      @click="store.setProactiveChatWorkHoursEnabled(!store.proactiveChatWorkHoursEnabled)"
                    >
                      <span
                        class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                        :style="{ transform: store.proactiveChatWorkHoursEnabled ? 'translateX(20px)' : 'translateX(0)' }"
                      />
                    </button>
                  </div>
                  <div class="mt-3 grid gap-3 md:grid-cols-2">
                    <label class="block">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{{ t('settings.proactiveChatStartTime') }}</div>
                      <input
                        class="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-200"
                        type="time"
                        :disabled="!store.proactiveChatEnabled || !store.proactiveChatWorkHoursEnabled"
                        :value="store.proactiveChatWorkHoursStart"
                        @input="store.setProactiveChatWorkHoursStart(($event.target as HTMLInputElement).value)"
                      >
                    </label>
                    <label class="block">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{{ t('settings.proactiveChatEndTime') }}</div>
                      <input
                        class="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-200"
                        type="time"
                        :disabled="!store.proactiveChatEnabled || !store.proactiveChatWorkHoursEnabled"
                        :value="store.proactiveChatWorkHoursEnd"
                        @input="store.setProactiveChatWorkHoursEnd(($event.target as HTMLInputElement).value)"
                      >
                    </label>
                  </div>
                </div>

                <div class="mt-3 rounded-2xl border border-neutral-800/70 bg-neutral-950/35 px-4 py-3">
                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                        {{ t('settings.proactiveChatDoNotDisturb') }}
                      </div>
                      <p class="mt-1 text-[11px] text-neutral-500">
                        {{ t('settings.proactiveChatDoNotDisturbHint', { start: store.proactiveChatDoNotDisturbStart, end: store.proactiveChatDoNotDisturbEnd }) }}
                      </p>
                    </div>
                    <button
                      class="relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 cursor-pointer"
                      :disabled="!store.proactiveChatEnabled"
                      :style="{ background: store.proactiveChatEnabled && store.proactiveChatDoNotDisturbEnabled ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : '#404040', opacity: store.proactiveChatEnabled ? 1 : 0.5 }"
                      :aria-label="`${store.proactiveChatDoNotDisturbEnabled ? 'Disable' : 'Enable'} do not disturb hours`"
                      @click="store.setProactiveChatDoNotDisturbEnabled(!store.proactiveChatDoNotDisturbEnabled)"
                    >
                      <span
                        class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                        :style="{ transform: store.proactiveChatDoNotDisturbEnabled ? 'translateX(20px)' : 'translateX(0)' }"
                      />
                    </button>
                  </div>
                  <div class="mt-3 grid gap-3 md:grid-cols-2">
                    <label class="block">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{{ t('settings.proactiveChatStartTime') }}</div>
                      <input
                        class="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-200"
                        type="time"
                        :disabled="!store.proactiveChatEnabled || !store.proactiveChatDoNotDisturbEnabled"
                        :value="store.proactiveChatDoNotDisturbStart"
                        @input="store.setProactiveChatDoNotDisturbStart(($event.target as HTMLInputElement).value)"
                      >
                    </label>
                    <label class="block">
                      <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{{ t('settings.proactiveChatEndTime') }}</div>
                      <input
                        class="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950/80 px-3 py-2 text-sm text-neutral-200"
                        type="time"
                        :disabled="!store.proactiveChatEnabled || !store.proactiveChatDoNotDisturbEnabled"
                        :value="store.proactiveChatDoNotDisturbEnd"
                        @input="store.setProactiveChatDoNotDisturbEnd(($event.target as HTMLInputElement).value)"
                      >
                    </label>
                  </div>
                </div>

                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                      {{ t('settings.proactiveChatInterval') }}
                    </div>
                    <p class="mt-1 text-[11px] text-neutral-500">
                      {{ t('settings.proactiveChatIntervalHint', { minutes: store.proactiveChatIntervalMinutes }) }}
                    </p>
                  </div>
                  <div class="rounded-full border border-neutral-700/60 bg-neutral-900/60 px-3 py-1 text-sm font-semibold text-neutral-200">
                    {{ store.proactiveChatIntervalMinutes }} min
                  </div>
                </div>
                <input
                  class="mt-3 w-full accent-amber-500"
                  type="range"
                  min="1"
                  max="60"
                  step="1"
                  :disabled="!store.proactiveChatEnabled || !store.proactiveChatIdleFollowUpEnabled"
                  :value="store.proactiveChatIntervalMinutes"
                  @input="store.setProactiveChatIntervalMinutes(Number(($event.target as HTMLInputElement).value))"
                >
                <p class="mt-2 text-[11px] text-neutral-500">
                  {{ t('settings.proactiveChatGroupChatNote') }}
                </p>
              </div>

              <div class="mt-4 border-t border-neutral-800/70 pt-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                      {{ t('settings.proactiveChatLongGap') }}
                    </div>
                    <p class="mt-1 text-[11px] text-neutral-500">
                      {{ t('settings.proactiveChatLongGapHint', { hours: store.proactiveChatLongGapHours }) }}
                    </p>
                  </div>
                  <div class="rounded-full border border-neutral-700/60 bg-neutral-900/60 px-3 py-1 text-sm font-semibold text-neutral-200">
                    {{ store.proactiveChatLongGapHours }} h
                  </div>
                </div>
                <input
                  class="mt-3 w-full accent-sky-500"
                  type="range"
                  min="1"
                  max="72"
                  step="1"
                  :disabled="!store.proactiveChatEnabled"
                  :value="store.proactiveChatLongGapHours"
                  @input="store.setProactiveChatLongGapHours(Number(($event.target as HTMLInputElement).value))"
                >
              </div>

              <div class="mt-4 border-t border-neutral-800/70 pt-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                      {{ t('settings.proactiveChatTemperature') }}
                    </div>
                    <p class="mt-1 text-[11px] text-neutral-500">
                      {{ t('settings.proactiveChatTemperatureHint', {
                        temperature: store.proactiveChatTemperature.toFixed(2),
                        mode: t(
                          store.proactiveChatTemperature <= 0.4
                            ? 'settings.proactiveChatModeConservative'
                            : store.proactiveChatTemperature >= 1
                              ? 'settings.proactiveChatModeActive'
                              : 'settings.proactiveChatModeBalanced',
                        ),
                      }) }}
                    </p>
                  </div>
                  <div class="rounded-full border border-neutral-700/60 bg-neutral-900/60 px-3 py-1 text-sm font-semibold text-neutral-200">
                    {{ store.proactiveChatTemperature.toFixed(2) }}
                  </div>
                </div>
                <input
                  class="mt-3 w-full accent-rose-500"
                  type="range"
                  min="0"
                  max="1.4"
                  step="0.05"
                  :disabled="!store.proactiveChatEnabled"
                  :value="store.proactiveChatTemperature"
                  @input="store.setProactiveChatTemperature(Number(($event.target as HTMLInputElement).value))"
                >
              </div>
            </div>

            <div class="settings-card">
              <div class="flex items-start justify-between gap-4 mb-2">
                <div>
                  <div class="text-sm font-semibold text-neutral-200">Strict mode (agent sandbox)</div>
                  <p class="mt-1 text-xs text-neutral-400">
                    Run every agent shell command against a user-managed allowlist and write a JSONL audit trail. Blocks anything not explicitly allowed.
                  </p>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-all duration-300 cursor-pointer shrink-0"
                  :style="{ background: strictMode.enabled ? 'linear-gradient(90deg,#ef4444,#f97316)' : '#404040' }"
                  :aria-label="`${strictMode.enabled ? 'Disable' : 'Enable'} strict mode`"
                  @click="toggleStrictMode"
                >
                  <span
                    class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                    :style="{ transform: strictMode.enabled ? 'translateX(20px)' : 'translateX(0)' }"
                  />
                </button>
              </div>

              <div v-if="strictMode.enabled" class="mt-2 flex items-center justify-between gap-2">
                <p class="text-[11px] text-neutral-500">
                  Manage the allowlist on the AI tab. Audit log:
                  <span class="font-mono text-neutral-400 break-all">{{ strictMode.auditLog }}</span>
                </p>
                <button class="btn-secondary text-xs shrink-0" aria-label="Open audit log file" @click="openAuditLog">
                  View log
                </button>
              </div>
            </div>
          </div>

          <!-- AI Tab: provider, API key -->
          <div v-if="settingsTab === 'ai'">
            <div class="settings-card mb-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="text-sm font-semibold text-neutral-200">Web search</div>
                  <p class="mt-1 text-xs text-neutral-400">
                    Disabled by default. When enabled, the agent can fetch DuckDuckGo result links/snippets only; it should not use web search as realtime data.
                  </p>
                </div>
                <button
                  class="relative w-11 h-6 rounded-full transition-all duration-300 cursor-pointer shrink-0"
                  :style="{ background: store.webSearchEnabled ? 'linear-gradient(90deg,#22c55e,#14b8a6)' : '#404040' }"
                  :aria-label="`${store.webSearchEnabled ? 'Disable' : 'Enable'} web search`"
                  @click="store.setWebSearchEnabled(!store.webSearchEnabled)"
                >
                  <span
                    class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                    :style="{ transform: store.webSearchEnabled ? 'translateX(20px)' : 'translateX(0)' }"
                  />
                </button>
              </div>
            </div>

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

            <div v-if="store.selectedProvider === 'ollama'" class="mb-6">
              <label class="block text-sm font-semibold text-neutral-200 mb-2">Ollama API Base URL</label>
              <input
                v-model="ollamaBaseUrl"
                type="text"
                placeholder="http://localhost:11434"
                class="input-field"
              >
              <p class="mt-1 text-xs text-neutral-400">
                Local Ollama server address used when refreshing the model list and validating the connection.
              </p>
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

              <div class="mb-4 rounded-xl border border-neutral-800/60 bg-neutral-900/55 p-3">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="font-semibold text-neutral-200">Enable timeouts and iterations cap</div>
                    <div class="mt-1 text-xs text-neutral-500">
                      Off by default. When enabled, retries on timeout/network failures, response-time alerts, and tool/subagent iteration caps are enforced.
                    </div>
                  </div>
                  <button
                    class="relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-all duration-300"
                    :style="{ background: store.enableTimeoutsAndIterationCaps ? 'linear-gradient(90deg,#22c55e,#06b6d4)' : '#404040' }"
                    :aria-label="`${store.enableTimeoutsAndIterationCaps ? 'Disable' : 'Enable'} timeouts and iterations cap`"
                    @click="store.setEnableTimeoutsAndIterationCaps(!store.enableTimeoutsAndIterationCaps)"
                  >
                    <span
                      class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                      :style="{ transform: store.enableTimeoutsAndIterationCaps ? 'translateX(20px)' : 'translateX(0)' }"
                    />
                  </button>
                </div>
              </div>

              <div class="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label class="rounded-xl bg-neutral-900/55 p-3 text-sm">
                  <div class="font-semibold text-neutral-200">{{ t('settings.maxIterations') }}</div>
                  <div class="mt-1 text-xs text-neutral-500">
                    {{ t('settings.maxIterationsDescription') }}
                    <span v-if="!store.enableTimeoutsAndIterationCaps" class="text-amber-300"> Disabled until caps are enabled.</span>
                  </div>
                  <input
                    class="input-field mt-3"
                    type="number"
                    min="1"
                    max="24"
                    :disabled="!store.enableTimeoutsAndIterationCaps"
                    :value="store.maxToolIterations"
                    @change="store.setMaxToolIterations(Number(($event.target as HTMLInputElement).value))"
                  >
                </label>
                <label class="rounded-xl bg-neutral-900/55 p-3 text-sm">
                  <div class="font-semibold text-neutral-200">{{ t('settings.responseThreshold') }}</div>
                  <div class="mt-1 text-xs text-neutral-500">
                    {{ t('settings.responseThresholdDescription') }}
                    <span v-if="!store.enableTimeoutsAndIterationCaps" class="text-amber-300"> Disabled until caps are enabled.</span>
                  </div>
                  <input
                    class="input-field mt-3"
                    type="number"
                    min="250"
                    max="60000"
                    step="250"
                    :disabled="!store.enableTimeoutsAndIterationCaps"
                    :value="store.apiSpikeThresholdMs"
                    @change="store.setApiSpikeThresholdMs(Number(($event.target as HTMLInputElement).value))"
                  >
                </label>
                <label class="rounded-xl bg-neutral-900/55 p-3 text-sm">
                  <div class="font-semibold text-neutral-200">Subagent iteration cap</div>
                  <div class="mt-1 text-xs text-neutral-500">
                    Max iterations each dispatched subagent gets before it must stop. Lower = cheaper, higher = more thorough. Default 6.
                    <span v-if="!store.enableTimeoutsAndIterationCaps" class="text-amber-300"> Disabled until caps are enabled.</span>
                  </div>
                  <input
                    class="input-field mt-3"
                    type="number"
                    min="3"
                    max="12"
                    :disabled="!store.enableTimeoutsAndIterationCaps"
                    :value="store.subagentMaxIterations"
                    @change="store.setSubagentMaxIterations(Number(($event.target as HTMLInputElement).value))"
                  >
                </label>
                <label class="rounded-xl bg-neutral-900/55 p-3 text-sm">
                  <div class="font-semibold text-neutral-200">Subagent concurrency</div>
                  <div class="mt-1 text-xs text-neutral-500">How many subagents run in parallel per dispatch. Lower = friendlier to rate limits. Default 4.</div>
                  <input
                    class="input-field mt-3"
                    type="number"
                    min="1"
                    max="8"
                    :value="store.subagentConcurrency"
                    @change="store.setSubagentConcurrency(Number(($event.target as HTMLInputElement).value))"
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

            <div class="settings-card">
              <div class="mb-1">
                <h3 class="text-sm font-bold text-white">{{ t('interface.motion') }}</h3>
                <p class="text-xs text-neutral-400">{{ t('interface.motionDesc') }}</p>
              </div>
              <div class="flex gap-2 mt-3">
                <button
                  v-for="opt in [
                    { value: 'auto', label: t('interface.motionAuto') },
                    { value: 'full', label: t('interface.motionFull') },
                    { value: 'reduced', label: t('interface.motionReduced') },
                  ]"
                  :key="opt.value"
                  class="flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors duration-200"
                  :class="
                    theme.ui.motion === opt.value
                      ? 'bg-primary-500/20 border-primary-500/40 text-white'
                      : 'bg-neutral-800/40 border-neutral-700/40 text-neutral-300 hover:bg-neutral-800/60'
                  "
                  :aria-pressed="theme.ui.motion === opt.value"
                  @click="setUI({ motion: opt.value as any })"
                >
                  {{ opt.label }}
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

          <!-- Plugins Tab -->
          <div v-if="settingsTab === 'plugins'">
            <div class="settings-card">
              <div class="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 class="text-sm font-bold text-white">Installed plugins</h3>
                  <p class="text-xs text-neutral-400">
                    Tool plugins extend the waifu agent. Restart SyntaxSenpai after enabling or disabling a plugin.
                  </p>
                  <p v-if="pluginsDirectory" class="text-[11px] text-neutral-500 font-mono mt-1 break-all">{{ pluginsDirectory }}</p>
                </div>
                <button
                  class="btn-secondary shrink-0"
                  :disabled="pluginsLoading"
                  aria-label="Refresh plugin list"
                  @click="refreshPlugins"
                >
                  {{ pluginsLoading ? 'Loading…' : 'Refresh' }}
                </button>
              </div>

              <p v-if="pluginsError" class="text-xs text-red-400 mb-2">{{ pluginsError }}</p>

              <p v-if="!pluginsLoading && pluginsList.length === 0 && !pluginsError" class="text-xs text-neutral-500 py-2">
                No plugins found. Drop a plugin.json under the directory above and hit Refresh.
              </p>

              <ul class="flex flex-col gap-2">
                <li
                  v-for="plugin in pluginsList"
                  :key="plugin.name"
                  class="flex items-start justify-between gap-3 rounded-lg border border-neutral-800/60 bg-neutral-900/50 p-3"
                >
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-white">{{ plugin.name }}</span>
                      <span class="text-[11px] text-neutral-500 font-mono">v{{ plugin.version }}</span>
                      <span
                        v-if="plugin.error"
                        class="text-[10px] uppercase tracking-wide text-amber-400 border border-amber-400/40 rounded px-1.5 py-0.5"
                      >error</span>
                      <span
                        v-else-if="plugin.disabled"
                        class="text-[10px] uppercase tracking-wide text-neutral-500 border border-neutral-600/40 rounded px-1.5 py-0.5"
                      >disabled</span>
                      <span
                        v-else
                        class="text-[10px] uppercase tracking-wide text-emerald-400 border border-emerald-400/40 rounded px-1.5 py-0.5"
                      >enabled</span>
                    </div>
                    <p v-if="plugin.description" class="text-xs text-neutral-400 mt-1">{{ plugin.description }}</p>
                    <p v-if="plugin.error" class="text-xs text-red-400 mt-1 font-mono">{{ plugin.error }}</p>
                  </div>
                  <button
                    class="relative w-11 h-6 rounded-full transition-all duration-300 cursor-pointer shrink-0"
                    :style="{ background: !plugin.disabled ? 'linear-gradient(90deg,#60a5fa,#a78bfa)' : '#404040' }"
                    :aria-label="`${plugin.disabled ? 'Enable' : 'Disable'} plugin ${plugin.name}`"
                    @click="togglePluginDisabled(plugin)"
                  >
                    <span
                      class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ease-in-out"
                      :style="{ transform: !plugin.disabled ? 'translateX(20px)' : 'translateX(0)' }"
                    />
                  </button>
                </li>
              </ul>
            </div>

            <div v-if="pendingPlugins.length > 0" class="settings-card">
              <div class="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 class="text-sm font-bold text-white">Pending — AI-authored tools</h3>
                  <p class="text-xs text-neutral-400">
                    Your waifu has proposed these tools. Review the code before approving — once approved + restarted, plugins run with full Node privileges.
                  </p>
                </div>
              </div>

              <ul class="flex flex-col gap-2">
                <li
                  v-for="plugin in pendingPlugins"
                  :key="plugin.slug"
                  class="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-semibold text-white">{{ plugin.name }}</span>
                        <span class="text-[11px] text-neutral-500 font-mono">{{ plugin.slug }} v{{ plugin.version }}</span>
                        <span class="text-[10px] uppercase tracking-wide text-amber-300 border border-amber-300/40 rounded px-1.5 py-0.5">pending</span>
                      </div>
                      <p v-if="plugin.description" class="text-xs text-neutral-400 mt-1">{{ plugin.description }}</p>
                    </div>
                    <div class="flex gap-2 shrink-0">
                      <button
                        class="btn-ghost text-xs"
                        :aria-label="`Review code for ${plugin.slug}`"
                        @click="togglePendingExpanded(plugin.slug)"
                      >
                        {{ pendingExpanded.has(plugin.slug) ? 'Hide code' : 'View code' }}
                      </button>
                      <button
                        class="btn-secondary text-xs text-red-400"
                        :aria-label="`Reject ${plugin.slug}`"
                        @click="rejectPending(plugin.slug)"
                      >
                        Reject
                      </button>
                      <button
                        class="btn-primary text-xs"
                        :aria-label="`Approve ${plugin.slug}`"
                        @click="approvePending(plugin.slug)"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                  <pre
                    v-if="pendingExpanded.has(plugin.slug)"
                    class="mt-3 max-h-72 overflow-auto rounded bg-neutral-950/70 p-2 text-[11px] text-neutral-300 font-mono whitespace-pre-wrap break-all"
                  >{{ plugin.code }}</pre>
                </li>
              </ul>
            </div>
          </div>

          <!-- Skills Tab -->
          <div v-if="settingsTab === 'skills'">
            <div class="settings-card">
              <div class="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 class="text-sm font-bold text-white">Waifu-authored skills</h3>
                  <p class="text-xs text-neutral-400">
                    Reusable knowledge packs the waifu saves with <code class="font-mono text-neutral-300">create_skill</code>. Each SKILL.md lives under your user-data folder and is included as a short summary in every system prompt; the waifu pulls the full body in with <code class="font-mono text-neutral-300">use_skill</code>.
                  </p>
                </div>
                <button
                  class="btn-secondary shrink-0"
                  :disabled="skillsLoading"
                  aria-label="Refresh skill list"
                  @click="refreshSkillsTab"
                >
                  {{ skillsLoading ? 'Loading…' : 'Refresh' }}
                </button>
              </div>

              <p v-if="skillsError" class="text-xs text-red-400 mb-2">{{ skillsError }}</p>

              <p v-if="!skillsLoading && skillsList.length === 0 && !skillsError" class="text-xs text-neutral-500 py-2">
                No skills yet. Ask the waifu to save one: "remember this recipe as a skill."
              </p>

              <ul class="flex flex-col gap-2">
                <li
                  v-for="skill in skillsList"
                  :key="skill.slug"
                  class="rounded-lg border border-neutral-800/60 bg-neutral-900/50 p-3"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-semibold text-white truncate">{{ skill.name }}</div>
                      <div class="text-[11px] text-neutral-500 font-mono truncate">{{ skill.slug }}</div>
                      <p class="text-xs text-neutral-400 mt-1">{{ skill.description }}</p>
                    </div>
                    <div class="flex gap-2 shrink-0">
                      <button
                        class="btn-ghost text-xs"
                        :aria-label="`View body for ${skill.slug}`"
                        @click="toggleSkillExpanded(skill.slug)"
                      >
                        {{ skillsExpanded.has(skill.slug) ? 'Hide' : 'View' }}
                      </button>
                      <button
                        class="btn-secondary text-xs text-red-400"
                        :aria-label="`Delete skill ${skill.slug}`"
                        @click="deleteSkill(skill.slug)"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <pre
                    v-if="skillsExpanded.has(skill.slug)"
                    class="mt-3 max-h-80 overflow-auto rounded bg-neutral-950/70 p-2 text-[11px] text-neutral-200 font-mono whitespace-pre-wrap"
                  >{{ skill.body || '(loading…)' }}</pre>
                </li>
              </ul>
            </div>
          </div>

          <!-- Waifus Tab -->
          <div v-if="settingsTab === 'waifus'">
            <!-- Create new waifu button / form -->
            <div class="settings-card">
              <div class="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 class="text-sm font-bold text-white">Create a waifu</h3>
                  <p class="text-xs text-neutral-400">
                    Design your own waifu by typing in her personality, backstory, and traits.
                  </p>
                </div>
                <button
                  class="btn-primary shrink-0"
                  @click="showWaifuCreator = !showWaifuCreator; if (showWaifuCreator) resetWaifuForm()"
                >
                  {{ showWaifuCreator ? 'Cancel' : '✏️ Create New' }}
                </button>
              </div>

              <Transition
                enter-active-class="transition-all duration-200"
                leave-active-class="transition-all duration-150"
                enter-from-class="opacity-0 -translate-y-2 max-h-0"
                leave-to-class="opacity-0 -translate-y-2 max-h-0"
              >
                <div v-if="showWaifuCreator" class="space-y-4 pt-3 border-t border-white/10">
                  <!-- Name + Display Name -->
                  <div class="grid grid-cols-2 gap-3">
                    <label class="block">
                      <span class="text-xs font-semibold text-neutral-300 mb-1 block">Name *</span>
                      <input v-model="newWaifuName" placeholder="e.g. yuki" class="input-field text-sm" />
                      <span class="text-[10px] text-neutral-500 mt-0.5 block">Used for ID: yuki → yuki.json</span>
                    </label>
                    <label class="block">
                      <span class="text-xs font-semibold text-neutral-300 mb-1 block">Display Name *</span>
                      <input v-model="newWaifuDisplayName" placeholder="e.g. Yuki ❄️" class="input-field text-sm" />
                    </label>
                  </div>

                  <!-- Backstory -->
                  <label class="block">
                    <span class="text-xs font-semibold text-neutral-300 mb-1 block">Backstory *</span>
                    <textarea
                      v-model="newWaifuBackstory"
                      placeholder="Tell her story — her personality, history, quirks..."
                      class="input-field text-sm min-h-[100px] resize-y"
                    />
                  </label>

                  <!-- AI Enhancement Buttons -->
                  <div class="flex gap-2 -mt-1">
                    <button
                      class="btn-ghost text-xs flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all duration-150"
                      :class="aiEnhancing === 'grammar' ? 'opacity-50 pointer-events-none' : 'hover:bg-emerald-500/10 hover:text-emerald-300'"
                      :style="ghostButtonStyle"
                      :disabled="aiEnhancing !== null"
                      @click="fixGrammarAI"
                    >
                      <span v-if="aiEnhancing === 'grammar'" class="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      <span v-else>🔍</span>
                      <span>{{ aiEnhancing === 'grammar' ? 'Fixing…' : 'Fix Grammar & Typos' }}</span>
                    </button>
                    <button
                      class="btn-ghost text-xs flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all duration-150"
                      :class="aiEnhancing === 'personality' ? 'opacity-50 pointer-events-none' : 'hover:bg-violet-500/10 hover:text-violet-300'"
                      :style="ghostButtonStyle"
                      :disabled="aiEnhancing !== null"
                      @click="enhancePersonalityAI"
                    >
                      <span v-if="aiEnhancing === 'personality'" class="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      <span v-else>✨</span>
                      <span>{{ aiEnhancing === 'personality' ? 'Enhancing…' : 'Enhance Personality' }}</span>
                    </button>
                  </div>
                  <p v-if="aiEnhanceError" class="text-xs text-red-400">{{ aiEnhanceError }}</p>

                  <!-- Tags + Emojis -->
                  <div class="grid grid-cols-2 gap-3">
                    <label class="block">
                      <span class="text-xs font-semibold text-neutral-300 mb-1 block">Tags</span>
                      <input v-model="newWaifuTags" placeholder="tsundere, kuudere, hacker..." class="input-field text-sm" />
                      <span class="text-[10px] text-neutral-500 mt-0.5 block">Comma-separated</span>
                    </label>
                    <label class="block">
                      <span class="text-xs font-semibold text-neutral-300 mb-1 block">Emojis</span>
                      <input v-model="newWaifuEmojis" placeholder="✨ 💻 🌸" class="input-field text-sm" />
                    </label>
                  </div>

                  <!-- Catchphrases -->
                  <label class="block">
                    <span class="text-xs font-semibold text-neutral-300 mb-1 block">Catchphrases (one per line)</span>
                    <textarea
                      v-model="newWaifuCatchphrases"
                      placeholder="I'll handle this!&#10;Don't underestimate me!&#10;Hmph!"
                      class="input-field text-sm min-h-[60px] resize-y"
                    />
                  </label>

                  <!-- Communication style -->
                  <div class="rounded-lg bg-neutral-800/40 border border-neutral-700/40 p-3">
                    <p class="text-xs font-semibold text-neutral-300 mb-2">Communication style</p>
                    <div class="grid grid-cols-3 gap-2">
                      <label class="block">
                        <span class="text-[10px] text-neutral-400 block">Greeting</span>
                        <input v-model="newWaifuGreeting" placeholder="Hey there~" class="input-field text-xs" />
                      </label>
                      <label class="block">
                        <span class="text-[10px] text-neutral-400 block">Affirmation</span>
                        <input v-model="newWaifuAffirmation" placeholder="I've got this!" class="input-field text-xs" />
                      </label>
                      <label class="block">
                        <span class="text-[10px] text-neutral-400 block">Deflection</span>
                        <input v-model="newWaifuDeflection" placeholder="It's nothing..." class="input-field text-xs" />
                      </label>
                    </div>
                  </div>

                  <div class="rounded-lg bg-neutral-800/40 border border-neutral-700/40 p-3">
                    <p class="text-xs font-semibold text-neutral-300 mb-2">Avatar assets</p>
                    <div class="grid grid-cols-2 gap-2">
                      <label class="block">
                        <span class="text-[10px] text-neutral-400 block">Neutral avatar URI</span>
                        <div class="flex gap-2">
                          <input v-model="newWaifuAvatarNeutral" placeholder="/assets/waifus/yuki/neutral.png" class="input-field text-xs flex-1" />
                          <button type="button" class="btn-secondary text-xs shrink-0" @click="pickCustomWaifuAvatar('neutral')">Browse</button>
                        </div>
                      </label>
                      <label class="block">
                        <span class="text-[10px] text-neutral-400 block">Happy avatar URI</span>
                        <div class="flex gap-2">
                          <input v-model="newWaifuAvatarHappy" placeholder="/assets/waifus/yuki/happy.png" class="input-field text-xs flex-1" />
                          <button type="button" class="btn-secondary text-xs shrink-0" @click="pickCustomWaifuAvatar('happy')">Browse</button>
                        </div>
                      </label>
                      <label class="block">
                        <span class="text-[10px] text-neutral-400 block">Excited avatar URI</span>
                        <div class="flex gap-2">
                          <input v-model="newWaifuAvatarExcited" placeholder="/assets/waifus/yuki/excited.png" class="input-field text-xs flex-1" />
                          <button type="button" class="btn-secondary text-xs shrink-0" @click="pickCustomWaifuAvatar('excited')">Browse</button>
                        </div>
                      </label>
                      <label class="block">
                        <span class="text-[10px] text-neutral-400 block">Thinking avatar URI</span>
                        <div class="flex gap-2">
                          <input v-model="newWaifuAvatarThinking" placeholder="/assets/waifus/yuki/thinking.png" class="input-field text-xs flex-1" />
                          <button type="button" class="btn-secondary text-xs shrink-0" @click="pickCustomWaifuAvatar('thinking')">Browse</button>
                        </div>
                      </label>
                      <label class="block col-span-2">
                        <span class="text-[10px] text-neutral-400 block">Idle animation URI</span>
                        <div class="flex gap-2">
                          <input v-model="newWaifuAvatarIdle" placeholder="/assets/waifus/yuki/idle.json" class="input-field text-xs flex-1" />
                          <button type="button" class="btn-secondary text-xs shrink-0" @click="pickCustomWaifuAvatar('idle')">Browse</button>
                        </div>
                        <span class="text-[10px] text-neutral-500 mt-0.5 block">Supports png, svg, and json/lottie. Blank fields fall back to the default assets or your neutral avatar.</span>
                      </label>
                    </div>
                  </div>

                  <!-- Live2D model -->
                  <div class="rounded-lg bg-neutral-800/40 border border-neutral-700/40 p-3">
                    <p class="text-xs font-semibold text-neutral-300 mb-1">Live2D model <span class="text-[10px] text-neutral-500 font-normal">(optional — overrides static images)</span></p>
                    <p class="text-[10px] text-neutral-500 mb-2 leading-snug">
                      Import a Cubism 2 (<code class="bg-neutral-700/60 px-0.5 rounded">.model.json</code>) or Cubism 4
                      (<code class="bg-neutral-700/60 px-0.5 rounded">.model3.json</code>) model — pick the JSON file
                      directly, or import a <code class="bg-neutral-700/60 px-0.5 rounded">.zip</code> of the model
                      folder. For Cubism 4, include <code class="bg-neutral-700/60 px-0.5 rounded">live2dcubismcore.min.js</code>
                      next to the model JSON.
                    </p>
                    <div v-if="newWaifuLive2DModelPath" class="flex items-center gap-2 mb-2 rounded bg-neutral-700/40 px-2 py-1.5">
                      <span class="text-[11px] text-green-400 font-semibold truncate flex-1">{{ newWaifuLive2DModelName || newWaifuLive2DModelPath }}</span>
                      <button
                        type="button"
                        class="text-[10px] text-red-400 hover:text-red-300 shrink-0"
                        title="Remove Live2D model"
                        @click="newWaifuLive2DModelPath = ''; newWaifuLive2DModelName = ''"
                      >Remove</button>
                    </div>
                    <button
                      type="button"
                      :disabled="newWaifuLive2DImporting"
                      class="btn-secondary text-xs"
                      @click="importLive2DModel()"
                    >
                      {{ newWaifuLive2DImporting ? 'Importing…' : 'Import model (.model3.json or .zip)…' }}
                    </button>
                  </div>

                  <!-- Personality sliders -->
                  <div class="rounded-lg bg-neutral-800/40 border border-neutral-700/40 p-3">
                    <p class="text-xs font-semibold text-neutral-300 mb-2">Personality traits</p>
                    <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                      <label class="flex items-center gap-2">
                        <span class="text-[10px] text-neutral-400 w-20 shrink-0">Warmth</span>
                        <input type="range" min="0" max="100" v-model.number="newWaifuPersonalityWarmth" class="w-full accent-primary-500" />
                        <span class="text-[10px] text-neutral-500 font-mono w-6 text-right">{{ newWaifuPersonalityWarmth }}</span>
                      </label>
                      <label class="flex items-center gap-2">
                        <span class="text-[10px] text-neutral-400 w-20 shrink-0">Formality</span>
                        <input type="range" min="0" max="100" v-model.number="newWaifuPersonalityFormality" class="w-full accent-primary-500" />
                        <span class="text-[10px] text-neutral-500 font-mono w-6 text-right">{{ newWaifuPersonalityFormality }}</span>
                      </label>
                      <label class="flex items-center gap-2">
                        <span class="text-[10px] text-neutral-400 w-20 shrink-0">Enthusiasm</span>
                        <input type="range" min="0" max="100" v-model.number="newWaifuPersonalityEnthusiasm" class="w-full accent-primary-500" />
                        <span class="text-[10px] text-neutral-500 font-mono w-6 text-right">{{ newWaifuPersonalityEnthusiasm }}</span>
                      </label>
                      <label class="flex items-center gap-2">
                        <span class="text-[10px] text-neutral-400 w-20 shrink-0">Teasing</span>
                        <input type="range" min="0" max="100" v-model.number="newWaifuPersonalityTeasing" class="w-full accent-primary-500" />
                        <span class="text-[10px] text-neutral-500 font-mono w-6 text-right">{{ newWaifuPersonalityTeasing }}</span>
                      </label>
                      <label class="flex items-center gap-2">
                        <span class="text-[10px] text-neutral-400 w-20 shrink-0">Verbosity</span>
                        <input type="range" min="0" max="100" v-model.number="newWaifuPersonalityVerbosity" class="w-full accent-primary-500" />
                        <span class="text-[10px] text-neutral-500 font-mono w-6 text-right">{{ newWaifuPersonalityVerbosity }}</span>
                      </label>
                      <label class="flex items-center gap-2">
                        <span class="text-[10px] text-neutral-400 w-20 shrink-0">Humor</span>
                        <input type="range" min="0" max="100" v-model.number="newWaifuPersonalityHumor" class="w-full accent-primary-500" />
                        <span class="text-[10px] text-neutral-500 font-mono w-6 text-right">{{ newWaifuPersonalityHumor }}</span>
                      </label>
                    </div>
                  </div>

                  <!-- Preview card -->
                  <div class="rounded-lg bg-neutral-800/20 border border-neutral-700/30 p-3">
                    <p class="text-xs font-semibold text-neutral-400 mb-2">Preview</p>
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-sm font-bold text-white shrink-0">
                        <img v-if="newWaifuAvatarNeutral" :src="newWaifuAvatarNeutral" alt="Waifu preview avatar" class="w-full h-full object-cover" />
                        <span v-else>{{ (newWaifuDisplayName || '?')[0] }}</span>
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-semibold text-white">{{ newWaifuDisplayName || '(no name)' }}</div>
                        <div class="text-[11px] text-neutral-400 line-clamp-1">{{ newWaifuBackstory ? newWaifuBackstory.slice(0, 80) + '…' : '(no backstory)' }}</div>
                        <div class="flex gap-1 mt-1 flex-wrap">
                          <span v-for="tag in newWaifuTags.split(',').map(t => t.trim()).filter(Boolean)" :key="tag" class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-500/15 text-primary-300 border border-primary-500/20">
                            {{ tag }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Error + submit -->
                  <p v-if="newWaifuError" class="text-xs text-red-400">{{ newWaifuError }}</p>
                  <div class="flex gap-2">
                    <button class="btn-secondary flex-1" @click="showWaifuCreator = false; resetWaifuForm()">
                      Cancel
                    </button>
                    <button
                      class="btn-primary flex-1"
                      :disabled="newWaifuCreating || !newWaifuName.trim() || !newWaifuDisplayName.trim() || !newWaifuBackstory.trim()"
                      @click="createCustomWaifu"
                    >
                      {{ newWaifuCreating ? 'Creating…' : '💗 Create Waifu' }}
                    </button>
                  </div>
                </div>
              </Transition>
            </div>

            <!-- Existing custom waifus list -->
            <div class="settings-card">
              <div class="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 class="text-sm font-bold text-white">Custom waifus</h3>
                  <p class="text-xs text-neutral-400">
                    Drop user-authored waifu JSON files in the folder below, or import one here. Restart to load new entries.
                  </p>
                  <p v-if="customWaifusDirectory" class="text-[11px] text-neutral-500 font-mono mt-1 break-all">{{ customWaifusDirectory }}</p>
                </div>
                <div class="flex flex-col gap-2 shrink-0">
                  <button class="btn-secondary" aria-label="Import a waifu from JSON" @click="importCustomWaifu">
                    Import JSON
                  </button>
                  <button
                    class="btn-secondary"
                    :disabled="customWaifusLoading"
                    aria-label="Refresh custom waifu list"
                    @click="refreshCustomWaifus"
                  >
                    {{ customWaifusLoading ? 'Loading…' : 'Refresh' }}
                  </button>
                </div>
              </div>

              <p v-if="customWaifusError" class="text-xs text-red-400 mb-2">{{ customWaifusError }}</p>

              <p v-if="!customWaifusLoading && customWaifus.length === 0 && !customWaifusError" class="text-xs text-neutral-500 py-2">
                No custom waifus yet. Use the form above to create one, or Import JSON.
              </p>

              <ul class="flex flex-col gap-2">
                <li
                  v-for="waifu in customWaifus"
                  :key="waifu.id"
                  class="flex items-start justify-between gap-3 rounded-lg border border-neutral-800/60 bg-neutral-900/50 p-3"
                >
                  <div class="min-w-0 flex items-start gap-3 flex-1">
                    <div class="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-primary-500/50 to-accent-500/40 flex items-center justify-center text-sm font-bold text-white shrink-0">
                      <img v-if="getCustomWaifuThumbnail(waifu)" :src="getCustomWaifuThumbnail(waifu)" :alt="`${waifu.displayName || waifu.name || waifu.id} avatar`" class="w-full h-full object-cover" />
                      <span v-else>{{ (waifu.displayName || waifu.name || waifu.id || '?')[0] }}</span>
                    </div>
                    <div class="min-w-0">
                      <div class="text-sm font-semibold text-white truncate">{{ waifu.displayName || waifu.name || waifu.id }}</div>
                      <div class="text-[11px] text-neutral-500 font-mono truncate">{{ waifu.id }}</div>
                      <p v-if="waifu.backstory" class="text-xs text-neutral-400 mt-1 line-clamp-2">{{ waifu.backstory }}</p>
                    </div>
                  </div>
                  <button
                    class="btn-secondary text-xs shrink-0"
                    :aria-label="`Remove custom waifu ${waifu.id}`"
                    @click="deleteCustomWaifu(waifu.id)"
                  >
                    Remove
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <!-- Live2D Import Tab -->
          <div v-if="settingsTab === 'live2d'">
            <div class="settings-card mb-3">
              <div class="mb-3">
                <h3 class="text-sm font-bold text-white">Live2D resolution</h3>
                <p class="text-xs text-neutral-400">
                  Choose the floating avatar window size. This changes the Live2D canvas resolution; character scale and position stay separate.
                </p>
              </div>
              <select
                :value="selectedLive2DResolution"
                class="input-field"
                @change="applyLive2DResolution(($event.target as HTMLSelectElement).value)"
              >
                <option value="custom">Custom: {{ currentLive2DResolutionLabel }}</option>
                <option
                  v-for="option in live2dResolutionOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
              <div class="mt-3 flex gap-2">
                <button class="btn-secondary flex-1 text-xs" @click="resetLive2DPanelLayout">
                  Reset Live2D layout
                </button>
                <button class="btn-secondary flex-1 text-xs" @click="showLive2DPanel = true">
                  Show avatar panel
                </button>
              </div>
            </div>

            <div class="settings-card mb-3">
              <div class="mb-3">
                <h3 class="text-sm font-bold text-white">Render quality</h3>
                <p class="text-xs text-neutral-400">
                  Supersample the Live2D canvas for a sharper, less pixelated model. Higher values
                  render at more pixels per CSS pixel (HiDPI / Retina trick) but cost more GPU.
                </p>
              </div>
              <select
                :value="String(live2dRenderScale)"
                class="input-field"
                @change="applyLive2DRenderScale(($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="option in live2dRenderScaleOptions"
                  :key="option.value"
                  :value="String(option.value)"
                >
                  {{ option.label }}
                </option>
              </select>
              <p class="text-[11px] text-neutral-500 mt-2">
                Current: <span class="text-neutral-300">{{ live2dRenderScale }}×</span>
                · Backing canvas: <span class="text-neutral-300">{{ live2dBackingCanvasLabel }}</span>
                · Display DPR: <span class="text-neutral-300">{{ live2dDevicePixelRatio.toFixed(2) }}</span>
              </p>
            </div>

            <div class="settings-card mb-3">
              <h3 class="text-sm font-bold text-white mb-1">🎭 Import Live2D Model</h3>
              <p class="text-xs text-neutral-400 mb-4">
                Import a Live2D Cubism 4 model to use as your waifu's avatar. Pick the
                <code class="bg-neutral-700/60 px-0.5 rounded">.model3.json</code> directly,
                or import a <code class="bg-neutral-700/60 px-0.5 rounded">.zip</code> of the model folder
                — the importer will find the <code class="bg-neutral-700/60 px-0.5 rounded">.model3.json</code> inside.
                Don't forget <code class="bg-neutral-700/60 px-0.5 rounded">live2dcubismcore.min.js</code>.
              </p>

              <!-- Current waifu info -->
              <div class="flex items-center gap-2 mb-4 rounded bg-neutral-700/40 px-3 py-2">
                <span class="text-lg">{{ currentWaifuLive2D ? '🎭' : '💗' }}</span>
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-semibold text-white truncate">{{ store.selectedWaifu?.name ?? 'No waifu selected' }}</p>
                  <p class="text-[10px] text-neutral-400 truncate">
                    {{ currentWaifuLive2D ? `Live2D: ${currentWaifuLive2D.displayName || currentWaifuLive2D.modelJsonPath}` : 'No Live2D model assigned' }}
                  </p>
                </div>
                <button
                  v-if="currentWaifuLive2D"
                  class="btn-secondary text-xs px-2 py-1 text-rose-400 hover:text-rose-300"
                  title="Remove Live2D model from this waifu"
                  @click="removeLive2DFromCurrentWaifu()"
                >
                  Remove
                </button>
              </div>

              <!-- Import area -->
              <div class="flex flex-col gap-3">
                <div v-if="live2dImportedPath" class="flex items-center gap-2 rounded bg-emerald-900/30 border border-emerald-700/40 px-3 py-2">
                  <span class="text-emerald-400 text-sm">✓</span>
                  <span class="text-[11px] text-emerald-300 font-semibold truncate flex-1">{{ live2dImportedName || live2dImportedPath }}</span>
                  <button
                    class="text-neutral-500 hover:text-neutral-300 text-xs"
                    @click="live2dImportedPath = ''; live2dImportedName = ''"
                  >✕</button>
                </div>

                <button
                  class="btn-secondary w-full"
                  :disabled="live2dImporting"
                  @click="importLive2DModelForCurrentWaifu()"
                >
                  {{ live2dImporting ? 'Importing…' : live2dImportedPath ? 'Import different model…' : 'Import model (.model3.json or .zip)…' }}
                </button>

                <button
                  v-if="live2dImportedPath && store.selectedWaifu"
                  class="btn-primary w-full"
                  @click="assignLive2DToCurrentWaifu()"
                >
                  Assign to {{ store.selectedWaifu.name }}
                </button>
              </div>
            </div>

            <!-- Cubism Core SDK card -->
            <div class="settings-card mb-3">
              <div class="flex items-center justify-between gap-2 mb-1">
                <h4 class="text-sm font-bold text-white">Cubism Core SDK</h4>
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                  :class="cubismCoreStatus?.installed
                    ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/40'
                    : 'bg-amber-900/40 text-amber-300 border border-amber-700/40'"
                >
                  {{ cubismCoreStatus?.installed ? 'Installed' : 'Not installed' }}
                </span>
              </div>
              <p class="text-[11px] text-neutral-400 mb-3 leading-snug">
                Cubism Core is the runtime that animates Live2D Cubism 4 models. The app downloads it
                from Live2D's official CDN
                (<code class="bg-neutral-700/60 px-0.5 rounded">cubism.live2d.com</code>)
                the first time you import a model. You can also install or refresh it manually here.
              </p>
              <div v-if="cubismCoreStatus?.installed" class="text-[10px] text-neutral-500 mb-3 font-mono break-all">
                {{ cubismCoreStatus.path }}
                <span v-if="cubismCoreStatus.size" class="ml-1 text-neutral-400">({{ formatBytes(cubismCoreStatus.size) }})</span>
              </div>
              <div v-if="cubismCoreError" class="mb-2 rounded bg-rose-900/30 border border-rose-700/40 px-2 py-1.5 text-[11px] text-rose-300 leading-snug">
                {{ cubismCoreError }}
              </div>
              <div class="flex gap-2">
                <button
                  class="btn-primary flex-1"
                  :disabled="cubismCoreInstalling"
                  @click="installCubismCore(false)"
                >
                  {{ cubismCoreInstalling
                    ? 'Installing…'
                    : cubismCoreStatus?.installed ? 'Verify install' : 'Install Cubism Core SDK' }}
                </button>
                <button
                  v-if="cubismCoreStatus?.installed"
                  class="btn-secondary"
                  :disabled="cubismCoreInstalling"
                  title="Re-download from the Live2D CDN"
                  @click="installCubismCore(true)"
                >
                  Re-install
                </button>
              </div>
            </div>

            <!-- Tips card -->
            <div class="settings-card">
              <h4 class="text-xs font-bold text-neutral-300 mb-2">Tips</h4>
              <ul class="text-[11px] text-neutral-400 space-y-1 list-disc list-inside">
                <li>Supported format: Live2D Cubism 4 (<code class="bg-neutral-700/60 px-0.5 rounded">.model3.json</code>)</li>
                <li>You can import either the <code class="bg-neutral-700/60 px-0.5 rounded">.model3.json</code> file directly or a <code class="bg-neutral-700/60 px-0.5 rounded">.zip</code> archive of the model folder.</li>
                <li>The model contents are copied into the app's data directory.</li>
                <li>The Cubism Core SDK is auto-installed when you import the first model — no extra setup needed.</li>
                <li>After assigning, toggle the avatar panel with the 🎭 button in the toolbar.</li>
                <li>To switch waifus, go to <strong class="text-neutral-300">Settings → General</strong> first, then come back here.</li>
              </ul>
            </div>

            <div class="flex gap-2 mt-3">
              <button class="btn-primary flex-1" @click="showSettings = false">Done</button>
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

          <!-- WeChat Tab -->
          <div v-if="settingsTab === 'wechat'">
            <div class="settings-card">
              <h3 class="text-sm font-bold text-white mb-1">WeChat (iLink)</h3>
              <p class="text-xs text-neutral-400 mb-4">
                Pair the desktop app with your personal WeChat via Tencent's official OpenClaw iLink protocol.
                Once paired, the waifu can read and reply to incoming WeChat messages and your agent can send
                text or images to contacts using the <code>wechat_send</code> tool.
              </p>

              <div class="flex items-center gap-2 mb-4">
                <div
                  class="w-2.5 h-2.5 rounded-full"
                  :class="wechatStatus.connected ? 'bg-emerald-400' : 'bg-neutral-600'"
                />
                <span class="text-sm text-neutral-300">
                  <template v-if="wechatStatus.connected">
                    Connected as
                    <span class="text-white font-medium">{{ wechatStatus.account?.displayName || wechatStatus.account?.userId || 'unknown' }}</span>
                  </template>
                  <template v-else-if="wechatPairingBusy || wechatQrDataUrl">
                    Waiting for QR scan…
                  </template>
                  <template v-else>
                    Not paired
                  </template>
                </span>
              </div>

              <div v-if="wechatStatus.lastError" class="text-xs text-rose-400 mb-3">
                Last error: {{ wechatStatus.lastError }}
              </div>

              <!-- Pairing flow -->
              <div v-if="!wechatStatus.connected" class="flex flex-col items-stretch gap-3">
                <div v-if="wechatQrDataUrl" class="flex flex-col items-center bg-white rounded p-3 mb-2">
                  <img :src="wechatQrDataUrl" alt="WeChat pairing QR" class="w-48 h-48" />
                  <p class="text-xs text-neutral-700 mt-2 text-center">
                    A browser window has been opened. Scan the QR code with your WeChat app, then confirm the login on your phone.
                  </p>
                </div>
                <div v-if="wechatPairingError" class="text-xs text-rose-400">
                  {{ wechatPairingError }}
                </div>
                <div class="flex gap-2">
                  <button
                    v-if="!wechatQrDataUrl"
                    class="btn-primary flex-1"
                    :disabled="wechatPairingBusy"
                    @click="startWeChatPairing()"
                  >
                    {{ wechatPairingBusy ? 'Requesting QR…' : 'Pair WeChat' }}
                  </button>
                  <button
                    v-else
                    class="btn-secondary flex-1"
                    @click="cancelWeChatPairing()"
                  >
                    Cancel pairing
                  </button>
                </div>
              </div>

              <!-- Connected state -->
              <div v-else class="flex gap-2">
                <button class="btn-secondary flex-1" @click="disconnectWeChat()">
                  Unpair WeChat
                </button>
              </div>
            </div>

            <div class="settings-card">
              <h4 class="text-xs font-bold text-neutral-300 mb-2">How it works</h4>
              <ul class="text-xs text-neutral-400 list-disc pl-5 space-y-1">
                <li>Inbound WeChat DMs land as new conversations tagged <span class="text-white">💬 WeChat · &lt;name&gt;</span>.</li>
                <li>The waifu's reply is auto-relayed back to the WeChat peer.</li>
                <li>For tables, comparisons or long code: the waifu calls <code>wechat_send</code> with <code>as_image: true</code>; the panel is rendered to a PNG and sent as a WeChat image.</li>
                <li>Credentials are stored in your OS keychain under <code>syntax-senpai-wechat</code>.</li>
              </ul>
            </div>

            <div class="flex gap-2">
              <button class="btn-primary flex-1" @click="showSettings = false">Done</button>
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

  <!-- Repository Picker Modal (/code) -->
  <RepositoryPickerModal
    :visible="store.showCodeModal"
    :mode="store.codeModalMode"
    :current-repo="store.activeCodingRepo"
    @close="store.showCodeModal = false"
    @selected="onRepoSelected"
    @keep-current="store.showCodeModal = false"
  />

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
      'relative flex h-screen w-screen',
      compactChatLayout ? 'compact-chat-shell overlay-window-shell overflow-visible p-2.5' : 'overflow-hidden',
    ]"
    :style="appShellStyle"
  >
    <!-- Ambient background -->
    <div v-if="!compactChatLayout" class="absolute inset-0 pointer-events-none -z-10 opacity-60">
      <div
        class="absolute inset-0"
        :style="{ background: `radial-gradient(circle at 10% 10%, rgba(var(--primary-rgb),0.12), transparent 8%), radial-gradient(circle at 90% 90%, rgba(var(--accent-rgb),0.08), transparent 18%)`, filter: 'blur(40px)' }"
      />
    </div>

    <!-- Sidebar -->
    <div
      v-if="!compactChatLayout"
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
              v-for="w in store.allWaifus"
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
                  class="text-[11px] leading-none px-1 text-neutral-400 hover:text-cyan-300 transition-colors"
                  :title="t('conversation.renameTitle')"
                  @click.stop="renameConversationPrompt(c)"
                >
                  &#9998;
                </button>
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
    <div :class="['flex-1 flex flex-col min-w-0', compactChatLayout ? 'overlay-main-pane' : '']">
      <!-- Header -->
      <div
        :class="[
          compactChatLayout ? 'sticky top-0 z-20 px-3 py-2.5' : 'sticky top-0 z-20 px-6 py-3',
          'glass-surface border-b',
          'flex items-center justify-between',
          compactChatLayout ? 'overlay-drag-region' : '',
          !startupAnimDone && appReady ? 'app-slide-in-top' : '',
          !appReady ? 'opacity-0' : '',
        ]"
        :style="secondaryPanelStyle"
      >
        <div :class="['flex items-center min-w-0', compactChatLayout ? 'gap-2' : 'gap-3']">
          <button
            v-if="!compactChatLayout"
            class="btn-ghost p-2"
            :aria-label="sidebarOpen ? 'Close sidebar' : 'Open sidebar'"
            :aria-expanded="sidebarOpen"
            @click="sidebarOpen = !sidebarOpen"
          >
            {{ sidebarOpen ? '←' : '☰' }}
          </button>
          <div :class="['flex items-center min-w-0', compactChatLayout ? 'gap-2.5' : 'gap-4']">
            <div class="min-w-0">
              <div :class="[compactChatLayout ? 'compact-chat-title text-base font-semibold truncate' : 'text-lg font-semibold truncate']">
                {{ store.isGroupChat ? store.activeWaifus.map(w => w.displayName).join(' & ') : store.selectedWaifu?.displayName }}
              </div>
              <div v-if="!compactChatLayout" class="text-xs text-neutral-400 truncate">
                {{ store.isGroupChat ? t('sidebar.groupChat') : store.selectedWaifu?.backstory?.slice(0, 60) }}
              </div>
            </div>
            <div v-if="!compactChatLayout" :class="[affectionMeterClass, 'shrink-0 rounded-xl border px-3 py-2']" :style="affectionBoxStyle">
              <div :class="['flex items-center justify-between uppercase', compactChatLayout ? 'text-[10px] tracking-[0.14em]' : 'text-[11px] tracking-[0.18em]']">
                <span>{{ t('header.affection') }}</span>
                <span>{{ compactChatLayout ? `${store.affection}/100` : `${store.affection} / 100(${affectionTier})` }}</span>
              </div>
              <div :class="[compactChatLayout ? 'mt-1.5 h-1.5' : 'mt-2 h-2', 'overflow-hidden rounded-full bg-neutral-800/90']">
                <div class="h-full rounded-full transition-all duration-500 ease-out" :style="affectionFillStyle" />
              </div>
            </div>
          </div>
        </div>
        <div ref="compactHeaderMenuRef" :class="['flex items-center relative', compactChatLayout ? 'gap-1.5 overlay-no-drag' : 'gap-1']">
          <button
            :class="['window-mode-btn', compactChatLayout ? 'overlay-no-drag' : '', overlayWindow.enabled ? 'window-mode-btn-active' : '']"
            :style="overlayWindow.enabled ? primaryButtonStyle : ghostButtonStyle"
            :title="t('settings.overlayWindow')"
            :aria-label="t('settings.overlayWindow')"
            @click="toggleOverlayWindowMode"
          >
            浮
          </button>
          <button
            :class="['window-mode-btn', compactChatLayout ? 'overlay-no-drag' : '', fullscreenWindow.enabled ? 'window-mode-btn-active' : '']"
            :style="fullscreenWindow.enabled ? primaryButtonStyle : ghostButtonStyle"
            title="Fullscreen"
            aria-label="Toggle fullscreen"
            @click="toggleFullscreenWindowMode"
          >
            满
          </button>
          <template v-if="!compactChatLayout">
          <button
            v-if="currentWaifuLive2D"
            class="btn-ghost p-2"
            :style="ghostButtonStyle"
            :title="showLive2DPanel ? 'Hide avatar' : 'Show Live2D avatar'"
            :aria-label="showLive2DPanel ? 'Hide avatar' : 'Show Live2D avatar'"
            @click="showLive2DPanel = !showLive2DPanel"
          >
            🪆
          </button>
          <button
            class="btn-ghost p-2"
            :style="ghostButtonStyle"
            :title="t('sidebar.agent')"
            :aria-label="t('sidebar.agent')"
            @click="openAgentPanel"
          >
            🤖
          </button>
          <button
            class="btn-ghost p-2"
            :style="ghostButtonStyle"
            title="AI Memory"
            aria-label="Open AI memory"
            @click="openMemoryPanel"
          >
            🧠
          </button>
          <button
            class="btn-ghost p-2"
            :style="ghostButtonStyle"
            :title="t('sidebar.settings')"
            :aria-label="t('sidebar.settings')"
            @click="openSettingsPanel"
          >
            ⚙️
          </button>
          </template>
        </div>
      </div>

      <!-- Usage + todo status strip (only when there's something to show) -->
      <div
        v-if="hasStatusStrip && !compactChatLayout"
        :class="[
          compactChatLayout
            ? 'px-3 py-1.5 border-b border-white/5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-400'
            : 'px-4 py-2 border-b border-white/5 flex items-center gap-4 text-[11px] text-neutral-400',
        ]"
      >
        <template v-if="compactChatLayout && !showCompactStatusDetails">
          <button
            class="compact-status-pill"
            :title="compactStatusSummary"
            @click="toggleCompactStatusDetails"
          >
            <span class="font-semibold text-neutral-200">Status</span>
            <span class="truncate">{{ compactStatusSummary }}</span>
            <span class="text-neutral-500">▾</span>
          </button>
        </template>
        <template v-else>
        <div v-if="store.usageTotals.turns > 0" :class="['font-mono', compactChatLayout ? 'flex items-center gap-2' : 'flex items-center gap-3']">
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
          :class="['flex items-center gap-2', compactChatLayout ? '' : 'ml-auto']"
          :title="`~${estimatedTokensUsed.toLocaleString()} / ${contextWindowSize.toLocaleString()} tokens (estimated)`"
        >
          <span class="font-mono">ctx</span>
          <div :class="[compactChatLayout ? 'w-18 h-1.5' : 'w-24 h-1.5', 'rounded-full bg-neutral-700/50 overflow-hidden']">
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
        <div v-if="store.activeTodoList.length > 0" :class="[compactChatLayout ? 'w-full flex flex-wrap gap-x-2 gap-y-1' : 'flex-1 flex flex-wrap gap-x-3 gap-y-1']">
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
        <button
          v-if="compactChatLayout"
          class="compact-status-collapse-btn"
          aria-label="Collapse compact status details"
          @click="toggleCompactStatusDetails"
        >
          ✕
        </button>
        </template>
      </div>

      <!-- Messages -->
      <div :class="[
        'flex-1 overflow-y-auto',
        compactChatLayout ? 'p-2.5 space-y-3' : 'p-4 space-y-4',
        !startupAnimDone && appReady ? 'app-fade-in-scale' : '',
        !appReady ? 'opacity-0' : '',
      ]">
        <div
          v-if="store.messages.length === 0"
          :class="['flex flex-col items-center justify-center h-full text-center text-neutral-400', compactChatLayout ? 'px-4' : '']"
        >
          <div :class="[compactChatLayout ? 'text-3xl mb-3' : 'text-4xl mb-4']" :style="emptyStateGlowStyle">
            💬
          </div>
          <h3 :class="[compactChatLayout ? 'compact-chat-empty-title text-base font-semibold text-white mb-1.5 font-display' : 'text-lg font-semibold text-white mb-2 font-display']" :style="emptyStateGlowStyle">
            {{ store.isGroupChat
              ? t('chat.emptyTitleGroup', { names: store.activeWaifus.map(w => w.displayName).join(', ') })
              : t('chat.emptyTitle', { name: store.selectedWaifu?.displayName || '' })
            }}
          </h3>
          <p :class="[compactChatLayout ? 'compact-chat-empty-subtitle text-xs' : 'text-sm']" :style="emptyStateGlowStyle">
            {{ t('chat.emptySubtitle') }}
          </p>
        </div>

        <div
          v-if="store.messages.length > visibleMessageCount"
          :class="[compactChatLayout ? 'flex justify-center mb-1' : 'flex justify-center mb-2']"
        >
          <button
            :class="[compactChatLayout ? 'btn-ghost text-[10px] text-neutral-400 px-2 py-1' : 'btn-ghost text-xs text-neutral-400']"
            aria-label="Show older messages"
            @click="revealOlderMessages"
          >
            ↑ Show {{ Math.min(MESSAGE_WINDOW_PAGE, store.messages.length - visibleMessageCount) }} older
            ({{ store.messages.length - visibleMessageCount }} hidden)
          </button>
        </div>

        <TransitionGroup
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          leave-active-class="transition-all duration-200"
          leave-to-class="opacity-0 -translate-y-2"
        >
          <div
            v-for="msg in windowedMessages"
            :key="msg.id"
            :class="[
              compactChatLayout ? 'group flex gap-2' : 'group flex',
              msg.role === 'user' ? 'justify-end items-end' : 'justify-start items-start',
            ]"
          >
            <div v-if="msg.role !== 'user'" :class="[compactChatLayout ? 'mr-1.5 shrink-0 relative' : 'mr-3 shrink-0 relative']">
              <div
                :class="[compactChatLayout ? 'compact-chat-avatar themed-assistant-avatar w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white' : 'themed-assistant-avatar w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white']"
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

            <div :class="[
              (msg.role !== 'user' || msg.source === 'wechat') ? 'flex flex-col min-w-0' : 'min-w-0',
              compactChatLayout ? 'max-w-[calc(100%-2.25rem)]' : '',
            ]">
              <span
                v-if="msg.role !== 'user' && store.isGroupChat && msg.waifuDisplayName"
                :class="[compactChatLayout ? 'text-[10px] text-neutral-400 mb-0.5 ml-0.5 font-semibold' : 'text-[11px] text-neutral-400 mb-0.5 ml-1 font-semibold']"
              >
                {{ msg.waifuDisplayName }}
              </span>
              <span
                v-if="msg.role === 'user' && msg.source === 'wechat'"
                :class="[compactChatLayout ? 'text-[10px] text-emerald-400/80 mb-0.5 mr-0.5 font-semibold self-end flex items-center gap-1' : 'text-[11px] text-emerald-400/80 mb-0.5 mr-1 font-semibold self-end flex items-center gap-1']"
                :title="msg.sourceLabel ? `From WeChat contact: ${msg.sourceLabel}` : 'Received from WeChat'"
              >
                <span aria-hidden="true">💬</span>
                <span>via WeChat{{ msg.sourceLabel ? ` · ${msg.sourceLabel}` : '' }}</span>
              </span>
              <ChatBubble
                :role="msg.role"
                :content="msg.content"
                :timestamp="msg.timestamp"
                :recent="msg.id === store.recentMessageId"
                :show-copy="msg.role === 'assistant'"
              />
              <div
                v-if="msg.pendingApproval"
                :class="[
                  'mt-2 flex gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 p-2',
                  compactChatLayout ? 'max-w-[260px]' : 'max-w-md',
                ]"
              >
                <template v-if="msg.pendingApproval.status === 'pending'">
                  <button
                    class="btn-primary flex-1 text-xs"
                    @click="store.approveToolApproval(msg.pendingApproval.id)"
                  >
                    Approve
                  </button>
                  <button
                    class="btn-secondary flex-1 text-xs text-rose-300"
                    @click="store.denyToolApproval(msg.pendingApproval.id)"
                  >
                    Deny
                  </button>
                </template>
                <div
                  v-else
                  class="w-full text-center text-xs font-semibold"
                  :class="msg.pendingApproval.status === 'approved' ? 'text-emerald-300' : 'text-rose-300'"
                >
                  {{ msg.pendingApproval.status === 'approved' ? 'Approved' : 'Denied' }}
                </div>
              </div>
              <SubagentPanel
                v-if="msg.subagents && msg.subagents.length > 0"
                :subagents="msg.subagents"
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
                  :class="[compactChatLayout ? 'compact-chat-message-attachment max-h-28 max-w-[180px] rounded-lg border border-white/10 object-cover' : 'max-h-40 max-w-[240px] rounded-lg border border-white/10 object-cover']"
                />
              </div>
              <div
                v-if="msg.role === 'assistant' && !msg.id.startsWith('tool-')"
                :class="[
                  compactChatLayout
                    ? 'flex flex-wrap gap-1.5 mt-1 ml-0.5 opacity-100 transition-opacity duration-150'
                    : 'flex gap-2 mt-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150',
                ]"
              >
                <button
                  :class="[compactChatLayout ? 'text-[10px] text-neutral-500 hover:text-primary-300 transition-colors' : 'text-[11px] text-neutral-500 hover:text-primary-300 transition-colors']"
                  :title="t('message.regenerateTitle')"
                  :aria-label="t('message.regenerateTitle')"
                  @click="store.regenerateFromMessage(msg.id)"
                >
                  {{ t('message.regenerate') }}
                </button>
                <button
                  :class="[compactChatLayout ? 'text-[10px] text-neutral-500 hover:text-red-400 transition-colors' : 'text-[11px] text-neutral-500 hover:text-red-400 transition-colors']"
                  :title="t('message.deleteTitle')"
                  :aria-label="t('message.deleteTitle')"
                  @click="store.deleteMessage(msg.id)"
                >
                  {{ t('message.delete') }}
                </button>
              </div>
            </div>

            <div v-if="msg.role === 'user'" :class="[compactChatLayout ? 'ml-1.5 shrink-0' : 'ml-3 shrink-0']">
              <div :class="[compactChatLayout ? 'compact-chat-avatar themed-user-avatar w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white' : 'themed-user-avatar w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white']">
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
        :class="[
          'glass-surface border-t relative',
          compactChatLayout ? 'p-3' : 'p-4',
          !startupAnimDone && appReady ? 'app-slide-in-bottom' : '',
          !appReady ? 'opacity-0' : '',
        ]"
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

        <!-- Coding-mode pill -->
        <div v-if="store.activeCodingRepo && !compactChatLayout" :class="[compactChatLayout ? 'flex flex-wrap items-center gap-1.5 mb-2' : 'flex items-center gap-2 mb-2']">
          <button
            :class="[
              compactChatLayout
                ? 'flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] bg-primary-500/15 hover:bg-primary-500/25 ring-1 ring-primary-500/40 text-primary-100 transition-colors max-w-full'
                : 'flex items-center gap-2 px-2.5 py-1 rounded-full text-xs bg-primary-500/15 hover:bg-primary-500/25 ring-1 ring-primary-500/40 text-primary-100 transition-colors',
            ]"
            :title="store.activeCodingRepo.path"
            @click="openCodingPickerFromPill"
          >
            <span class="font-mono text-[10px] text-primary-300">◆</span>
            <span class="font-semibold">{{ store.activeCodingRepo.name }}</span>
            <span class="text-primary-200/70">·</span>
            <span class="font-mono text-primary-200/80">{{ store.activeCodingRepo.branch ?? 'HEAD' }}</span>
          </button>
          <button
            :class="[compactChatLayout ? 'text-[10px] px-1.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors' : 'text-[10px] px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors']"
            title="Exit coding mode"
            @click="exitCodingMode"
          >
            × exit
          </button>
        </div>

        <!-- Pending-attachment thumbnail row -->
        <div v-if="store.pendingAttachments.length > 0" :class="[compactChatLayout ? 'flex flex-wrap gap-1.5 mb-2' : 'flex flex-wrap gap-2 mb-2']">
          <div
            v-for="att in store.pendingAttachments"
            :key="att.id"
            class="relative group rounded-lg overflow-hidden border border-white/10 bg-black/30"
            :title="att.name"
          >
            <img :src="att.url" :alt="att.name" :class="[compactChatLayout ? 'compact-chat-pending-attachment h-12 w-12 object-cover' : 'h-16 w-16 object-cover']" />
            <button
              class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              :title="t('input.removeAttachment', { name: att.name })"
              @click="store.removeAttachment(att.id)"
            >
              ×
            </button>
          </div>
        </div>

        <div :class="[compactChatLayout ? 'flex flex-wrap gap-2 items-end' : 'flex gap-3 items-end']">
          <input
            ref="fileInputRef"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            class="hidden"
            @change="handleFilePick"
          />
          <button
            :class="[compactChatLayout ? 'compact-chat-icon-btn btn-ghost min-w-fit !px-2 h-10' : 'btn-ghost min-w-fit !px-2']"
            :title="t('input.attachImage')"
            :aria-label="t('input.attachImage')"
            :disabled="store.isLoading"
            @click="fileInputRef?.click()"
          >
            📎
          </button>
          <textarea
            id="chat-input"
            ref="inputRef"
            v-model="store.inputValue"
            :placeholder="t('chat.inputPlaceholder')"
            :aria-label="t('chat.inputPlaceholder')"
            :disabled="store.isLoading"
            rows="1"
            :class="[
              compactChatLayout ? 'compact-chat-input input-field flex-1 min-w-[12rem] resize-none text-sm leading-5 py-2.5' : 'input-field flex-1 resize-none',
              'disabled:opacity-50',
            ]"
            style="max-height: 100px"
            :style="inputSurfaceStyle"
            @input="adjustInputHeight"
            @keydown="handleKeyDown"
            @paste="handlePaste"
          />
          <button
            v-if="store.isLoading"
            :class="[
              compactChatLayout
                ? 'compact-chat-action-btn btn-primary w-full flex items-center justify-center gap-2 bg-rose-600/80 hover:bg-rose-600 border-rose-500/40 text-white'
                : 'btn-primary min-w-fit flex items-center justify-center gap-2 bg-rose-600/80 hover:bg-rose-600 border-rose-500/40 text-white',
            ]"
            :aria-label="t('chat.stop')"
            type="button"
            @click="store.stopStream()"
          >
            <span aria-hidden="true" class="inline-block w-2.5 h-2.5 bg-current rounded-sm" />
            {{ t('chat.stop') }}
          </button>
          <button
            v-else
            :class="[
              compactChatLayout
                ? 'compact-chat-action-btn btn-primary themed-btn-primary w-full flex items-center justify-center gap-2'
                : 'btn-primary themed-btn-primary min-w-fit flex items-center justify-center gap-2',
            ]"
            :style="primaryButtonStyle"
            :aria-label="t('chat.send')"
            :disabled="!store.inputValue.trim() && store.pendingAttachments.length === 0"
            @click="store.sendMessage(store.inputValue)"
          >
            {{ t('chat.send') }}
          </button>
        </div>
        <p v-if="!compactChatLayout" class="text-xs text-neutral-500 mt-2">
          {{ t('chat.inputHint') }}
        </p>
      </div>
    </div>

    <!-- Floating Live2D avatar panel -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="opacity-0 scale-90 translate-y-4"
        leave-active-class="transition-all duration-200 ease-in"
        leave-to-class="opacity-0 scale-90 translate-y-4"
      >
        <div
          v-if="showLive2DPanel && currentWaifuLive2D"
          class="live2d-panel fixed z-[60] rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-black/30 backdrop-blur-sm select-none touch-none"
          :class="[
            live2dPanelDragging || live2dCharacterDragging ? 'cursor-grabbing' : '',
            live2dPanelResizing ? 'ring-2 ring-cyan-300/50' : '',
          ]"
          :style="live2dPanelStyle"
        >
          <!-- Header bar -->
          <div
            class="absolute top-0 inset-x-0 z-10 flex cursor-grab items-center justify-between gap-2 px-3 py-1.5 bg-gradient-to-b from-black/70 to-transparent active:cursor-grabbing"
            @pointerdown="beginLive2DPanelDrag"
          >
            <span class="text-xs font-semibold text-white/80 truncate">{{ store.selectedWaifu?.displayName }}</span>
            <div class="flex items-center gap-1" data-live2d-panel-control>
              <button
                class="text-[11px] leading-none px-1.5 py-1 rounded text-white/60 hover:text-white/90 hover:bg-white/10"
                title="Reset avatar position and scale"
                @click.stop="resetLive2DPanelLayout"
              >Reset</button>
              <button
                class="text-white/60 hover:text-white/90 text-lg leading-none px-1"
                title="Close"
                @click.stop="showLive2DPanel = false"
              >×</button>
            </div>
          </div>
          <div
            class="absolute inset-0 cursor-grab active:cursor-grabbing"
            @pointerdown="beginLive2DCharacterDrag"
            @wheel="handleLive2DCharacterWheel"
          >
            <Live2DAvatar
              :model-path="currentWaifuLive2D.modelJsonPath"
              :expression="latestSentimentExpression"
              :motion-map="currentWaifuLive2D.expressionMotions"
              :width="live2dPanelWidth"
              :height="live2dPanelHeight"
              :model-scale="live2dCharacterScale"
              :offset-x="live2dCharacterOffset.x"
              :offset-y="live2dCharacterOffset.y"
              :render-scale="live2dRenderScale"
            />
          </div>
          <div
            class="live2d-scale-control absolute left-3 right-8 bottom-3 z-10 flex items-center gap-2 rounded-lg border border-white/10 bg-black/55 px-2.5 py-2 backdrop-blur-sm cursor-default"
            data-live2d-panel-control
            @pointerdown.stop
          >
            <span class="text-[10px] font-semibold text-white/70 w-9">Scale</span>
            <input
              v-model.number="live2dCharacterScale"
              type="range"
              :min="LIVE2D_CHARACTER_MIN_SCALE"
              :max="LIVE2D_CHARACTER_MAX_SCALE"
              step="0.05"
              class="w-full accent-primary-500"
              title="Scale character"
              @input="saveLive2DPanelLayout"
              @change="saveLive2DPanelLayout"
            />
            <span class="text-[10px] tabular-nums text-white/60 w-9 text-right">{{ live2dCharacterScalePercent }}%</span>
          </div>
          <div class="absolute inset-x-2 top-0 z-20 h-2 cursor-ns-resize" data-live2d-panel-control @pointerdown="beginLive2DPanelResize($event, 'n')" />
          <div class="absolute inset-x-2 bottom-0 z-20 h-2 cursor-ns-resize" data-live2d-panel-control @pointerdown="beginLive2DPanelResize($event, 's')" />
          <div class="absolute inset-y-2 left-0 z-20 w-2 cursor-ew-resize" data-live2d-panel-control @pointerdown="beginLive2DPanelResize($event, 'w')" />
          <div class="absolute inset-y-2 right-0 z-20 w-2 cursor-ew-resize" data-live2d-panel-control @pointerdown="beginLive2DPanelResize($event, 'e')" />
          <div class="absolute left-0 top-0 z-20 h-4 w-4 cursor-nwse-resize" data-live2d-panel-control @pointerdown="beginLive2DPanelResize($event, 'nw')" />
          <div class="absolute right-0 top-0 z-20 h-4 w-4 cursor-nesw-resize" data-live2d-panel-control @pointerdown="beginLive2DPanelResize($event, 'ne')" />
          <div class="absolute bottom-0 left-0 z-20 h-4 w-4 cursor-nesw-resize" data-live2d-panel-control @pointerdown="beginLive2DPanelResize($event, 'sw')" />
          <div class="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize" data-live2d-panel-control @pointerdown="beginLive2DPanelResize($event, 'se')" />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* Accessibility: visually-hidden text for screen readers. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Skip link: invisible until focused, then jumps to the main chat input. */
.skip-link {
  position: fixed;
  top: 8px;
  left: 8px;
  padding: 8px 14px;
  background: #111;
  color: #fff;
  border: 1px solid #60a5fa;
  border-radius: 8px;
  font-weight: 600;
  z-index: 100;
  transform: translateY(-200%);
  transition: transform 160ms ease;
}
.skip-link:focus {
  transform: translateY(0);
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}

.live2d-scale-control {
  opacity: 0;
  pointer-events: none;
  transform: translateY(6px);
  transition: opacity 160ms ease, transform 160ms ease;
}

.live2d-panel:hover .live2d-scale-control,
.live2d-panel:focus-within .live2d-scale-control {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

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

.compact-chat-shell .sidebar-open {
  width: 14rem;
}

.compact-chat-shell :deep(.chat-bubble-shell) {
  max-width: min(100%, var(--compact-bubble-max-width));
  padding: 0.7rem 0.8rem;
  border-radius: 1rem;
}

.compact-chat-shell :deep(.chat-bubble-content) {
  font-size: 0.875rem;
  line-height: 1.45;
}

.compact-chat-shell {
  --compact-base-font: clamp(11px, calc(8.8px + 0.7vw), 13px);
  --compact-title-font: clamp(12px, calc(9.6px + 0.75vw), 14px);
  --compact-empty-title-font: clamp(13px, calc(10.4px + 0.85vw), 15px);
  --compact-empty-subtitle-font: clamp(10px, calc(8.4px + 0.45vw), 12px);
  --overlay-shell-radius: clamp(1rem, calc(0.65rem + 1vw), 1.35rem);
  --overlay-shell-shadow: 0 18px 42px rgba(3, 6, 16, 0.42), 0 6px 18px rgba(15, 23, 42, 0.28);
  --overlay-shell-border: rgba(255, 255, 255, 0.1);
  --overlay-shell-background: linear-gradient(180deg, rgba(10, 12, 22, 0.72), rgba(8, 10, 18, 0.64));
  --compact-avatar-size: clamp(1.7rem, calc(1.35rem + 0.95vw), 2rem);
  --compact-avatar-font: clamp(10px, calc(8px + 0.45vw), 12px);
  --compact-bubble-font: clamp(11px, calc(8.8px + 0.62vw), 13px);
  --compact-bubble-max-width: clamp(14.5rem, calc(10.5rem + 22vw), 19rem);
  --compact-message-attachment-max-width: clamp(8.5rem, calc(5.5rem + 18vw), 11.25rem);
  --compact-message-attachment-max-height: clamp(5.75rem, calc(4.4rem + 8vw), 7rem);
  --compact-meta-font: clamp(9px, calc(7.5px + 0.35vw), 11px);
  --compact-input-font: clamp(11px, calc(8.8px + 0.62vw), 13px);
  --compact-mode-btn-font: clamp(9px, calc(7.6px + 0.32vw), 11px);
  --compact-mode-btn-size: clamp(1.7rem, calc(1.45rem + 0.45vw), 1.9rem);
  --compact-icon-btn-size: clamp(2rem, calc(1.55rem + 1.1vw), 2.4rem);
  --compact-action-btn-height: clamp(2.15rem, calc(1.75rem + 1vw), 2.7rem);
  --compact-action-btn-font: clamp(10px, calc(8.2px + 0.5vw), 12px);
  --compact-action-btn-padding-x: clamp(0.7rem, calc(0.45rem + 0.8vw), 1rem);
  --compact-pending-attachment-size: clamp(2.75rem, calc(2.1rem + 1.6vw), 3.4rem);
  font-size: var(--compact-base-font);
}

.compact-chat-shell.overlay-window-shell {
  box-sizing: border-box;
}

.compact-chat-shell .overlay-main-pane {
  position: relative;
  overflow: hidden;
  border-radius: var(--overlay-shell-radius);
  border: 1px solid var(--overlay-shell-border);
  background: var(--overlay-shell-background);
  box-shadow: var(--overlay-shell-shadow);
}

.compact-chat-shell .overlay-main-pane::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.compact-chat-shell .overlay-drag-region {
  -webkit-app-region: drag;
  user-select: none;
}

.compact-chat-shell .overlay-no-drag {
  -webkit-app-region: no-drag;
}

.compact-chat-shell .compact-chat-title {
  font-size: var(--compact-title-font);
  line-height: 1.15;
}

.compact-chat-shell .compact-chat-empty-title {
  font-size: var(--compact-empty-title-font);
}

.compact-chat-shell .compact-chat-empty-subtitle {
  font-size: var(--compact-empty-subtitle-font);
}

.compact-chat-shell :deep(.chat-bubble-content) {
  font-size: var(--compact-bubble-font);
  line-height: 1.4;
}

.compact-chat-shell :deep(.chat-bubble-meta) {
  font-size: var(--compact-meta-font);
}

.compact-chat-shell .compact-chat-input {
  font-size: var(--compact-input-font);
  line-height: 1.35;
}

.compact-chat-shell .compact-chat-avatar {
  width: var(--compact-avatar-size);
  height: var(--compact-avatar-size);
  font-size: var(--compact-avatar-font);
}

.compact-chat-shell .window-mode-btn {
  min-width: var(--compact-mode-btn-size);
  height: var(--compact-mode-btn-size);
  font-size: var(--compact-mode-btn-font);
}

.compact-chat-shell .compact-chat-icon-btn {
  min-width: var(--compact-icon-btn-size);
  height: var(--compact-icon-btn-size);
  padding-left: 0;
  padding-right: 0;
  font-size: var(--compact-action-btn-font);
}

.compact-chat-shell .compact-chat-action-btn {
  min-height: var(--compact-action-btn-height);
  padding-left: var(--compact-action-btn-padding-x);
  padding-right: var(--compact-action-btn-padding-x);
  font-size: var(--compact-action-btn-font);
  line-height: 1.2;
}

.compact-chat-shell .compact-chat-message-attachment {
  max-width: var(--compact-message-attachment-max-width);
  max-height: var(--compact-message-attachment-max-height);
}

.compact-chat-shell .compact-chat-pending-attachment {
  width: var(--compact-pending-attachment-size);
  height: var(--compact-pending-attachment-size);
}

.compact-chat-shell :deep(.chat-bubble-meta) {
  margin-top: 0.35rem;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.compact-chat-shell :deep(.markdown-content p) {
  margin-bottom: 0.5rem;
  line-height: 1.45;
}

.compact-chat-shell :deep(.markdown-content ul),
.compact-chat-shell :deep(.markdown-content ol) {
  margin-bottom: 0.6rem;
  padding-left: 1rem;
}

.compact-chat-shell :deep(.markdown-content pre) {
  padding: 0.65rem;
  font-size: 0.75rem;
}

.compact-header-menu-btn {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.55rem;
  border-radius: 0.8rem;
  padding: 0.55rem 0.7rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(229 229 229);
  transition: background-color 150ms ease, color 150ms ease;
}

.compact-header-menu-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.window-mode-btn {
  min-width: 2rem;
  height: 2rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.75rem;
  font-weight: 700;
  transition: transform 150ms ease, background-color 150ms ease, color 150ms ease;
}

.window-mode-btn:hover {
  transform: translateY(-1px);
}

.window-mode-btn-active {
  border-color: transparent;
}

.compact-status-pill {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.45rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(10, 10, 10, 0.32);
  padding: 0.35rem 0.65rem;
  min-width: 0;
}

.compact-status-collapse-btn {
  margin-left: auto;
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  color: rgb(163 163 163);
  transition: color 150ms ease, background-color 150ms ease;
}

.compact-status-collapse-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
</style>
