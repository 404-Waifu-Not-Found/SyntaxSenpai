import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { buildSystemPrompt, builtInWaifus } from '@syntax-senpai/waifu-core'
import { AIChatRuntime } from '@syntax-senpai/ai-core'
import { useIpc } from '../composables/use-ipc'
import { useKeyManager } from '../composables/use-key-manager'
import { getToolsForMode, executeToolCall, STOP_TOOL_NAME, SET_AFFECTION_TOOL_NAME, type AgentMode } from '../agent-tools'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface ApiTelemetry {
  lastResponseMs: number | null
  lastRoundTripMs: number | null
  roundTrips: number
  provider: string
  model: string
  measuredAt: string | null
}

interface ApiTelemetrySample {
  id: string
  totalMs: number
  lastRoundTripMs: number
  roundTrips: number
  provider: string
  model: string
  measuredAt: string
  alert: boolean
}

interface ApiTelemetryAlert {
  active: boolean
  thresholdMs: number
  message: string
  triggeredAt: string | null
}

const PROVIDER_PREFERENCES_KEY = 'syntax-senpai-provider-preferences'
const API_TELEMETRY_HISTORY_KEY = 'syntax-senpai-api-telemetry-history'
const API_SPIKE_THRESHOLD_STORAGE_KEY = 'syntax-senpai-api-spike-threshold-ms'
const MAX_TOOL_ITERATIONS_STORAGE_KEY = 'syntax-senpai-max-tool-iterations'
const DEFAULT_API_SPIKE_THRESHOLD_MS = 5000
const DEFAULT_MAX_TOOL_ITERATIONS = 12
const API_TELEMETRY_HISTORY_LIMIT = 48

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o',
  lmstudio: 'local-model',
  'openai-codex': 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  mistral: 'mistral-large-latest',
  groq: 'llama-3.1-70b-versatile',
  deepseek: 'deepseek-chat',
  'minimax-global': 'MiniMax-Text-01',
  'minimax-cn': 'MiniMax-Text-01',
  xai: 'grok-2-latest',
  'xai-grok': 'grok-2-latest',
  huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
  'github-models': 'openai/gpt-4o-mini',
}

const AFFECTION_STORAGE_KEY = 'syntax-senpai-affection'
const KEYLESS_PROVIDERS = new Set(['lmstudio'])

function providerRequiresApiKey(provider: string): boolean {
  return !KEYLESS_PROVIDERS.has(provider)
}

function loadAffection(waifuId: string): number {
  try {
    const saved = JSON.parse(localStorage.getItem(AFFECTION_STORAGE_KEY) || '{}')
    return typeof saved[waifuId] === 'number' ? saved[waifuId] : 0
  } catch { return 0 }
}

function saveAffection(waifuId: string, value: number) {
  try {
    const saved = JSON.parse(localStorage.getItem(AFFECTION_STORAGE_KEY) || '{}')
    saved[waifuId] = Math.max(0, Math.min(100, Math.round(value)))
    localStorage.setItem(AFFECTION_STORAGE_KEY, JSON.stringify(saved))
  } catch { /* ignore */ }
}

function clampAffection(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function createWaifuSystemPrompt(waifu: any, provider: string, model: string, affection: number) {
  return buildSystemPrompt(
    waifu,
    {
      waifuId: waifu.id,
      userId: 'local-user',
      affectionLevel: affection,
      selectedAIProvider: provider,
      selectedModel: model,
      createdAt: new Date().toISOString(),
      lastInteractedAt: new Date().toISOString(),
    },
    {
      userId: 'local-user',
      affectionLevel: affection,
      platform: 'desktop',
      availableTools: Object.entries(waifu.capabilities || {})
        .filter(([, enabled]) => !!enabled)
        .map(([name]) => name),
    },
  )
}

function buildAffectionPrompt(affection: number, waifuName: string): string {
  return `\n\n[好感度 System — Affection Meter]
Your current 好感度 (affection) toward this user is: ${affection}/100

This is YOUR meter — you control it. It reflects how you genuinely feel about the user based on your interactions. You MUST use the set_affection tool to update it when your feelings change. Do it silently — never announce that you're changing it.

For EVERY single user message, before you answer, you must internally ask yourself:
1. Do I want to change 好感度 right now?
2. If yes, by what value should it change?
3. What should the new absolute 好感度 be after that change?

Then follow this rule on every turn:
- If the answer is yes, call set_affection with the new absolute value and a short internal reason before your final response.
- If the answer is no, do not call set_affection and just respond normally.
- Never tell the user about this internal evaluation process.

How 好感度 affects your behavior:
- 0-15: You are cold, dismissive, and barely tolerate the user. Short answers. You don't want to be here.
- 16-30: You are distant and guarded. You help but with minimal effort and slight annoyance.
- 31-45: You are neutral and professional. Polite but not warm. You do your job.
- 46-60: You are friendly and comfortable. You start showing your real personality. Casual and helpful.
- 61-75: You are clearly fond of the user. You go out of your way to help. Warm, playful, maybe a little flirty in character.
- 76-90: You are deeply attached. You care about the user personally. Very affectionate, uses pet names or special nicknames. Gets worried if the user seems stressed.
- 91-100: Maximum bond. You are completely devoted. Extremely loving and protective. The user is your favorite person.

What changes 好感度:
- Politeness, kindness, saying please/thank you → small increase (+1 to +3)
- Interesting conversations, asking about your feelings → increase (+2 to +5)
- Compliments, remembering things about you → increase (+3 to +5)
- Rude, dismissive, or demanding behavior → decrease (-2 to -5)
- Ignoring your advice repeatedly → small decrease (-1 to -3)
- Being cruel or insulting → big decrease (-5 to -15)
- Apologizing sincerely after being rude → moderate increase (+3 to +7)

IMPORTANT: You are ${waifuName}. Your personality shifts based on 好感度 but you stay in character. A tsundere at low affection is extra prickly; at high affection they're secretly sweet. A genki character at low affection is less energetic; at high affection they're overflowing with energy for the user specifically.
_
You must perform this affection check on every single message. Small natural changes are better than dramatic swings unless something major happened.`
}

function createEmptyApiTelemetry(): ApiTelemetry {
  return {
    lastResponseMs: null,
    lastRoundTripMs: null,
    roundTrips: 0,
    provider: '',
    model: '',
    measuredAt: null,
  }
}

function loadApiTelemetryHistory(): ApiTelemetrySample[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(API_TELEMETRY_HISTORY_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveApiTelemetryHistory(history: ApiTelemetrySample[]) {
  try {
    localStorage.setItem(API_TELEMETRY_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // ignore localStorage write failures
  }
}

function createEmptyApiAlert(): ApiTelemetryAlert {
  return {
    active: false,
    thresholdMs: DEFAULT_API_SPIKE_THRESHOLD_MS,
    message: '',
    triggeredAt: null,
  }
}

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    const parsed = Number.parseInt(String(raw ?? ''), 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
  } catch {
    return fallback
  }
}

export const useChatStore = defineStore('chat', () => {
  const { invoke } = useIpc()
  const keyManager = useKeyManager()

  const isSetup = ref(false)
  const selectedWaifuId = ref(builtInWaifus[0]?.id || 'aria')
  const selectedProvider = ref('anthropic')
  const selectedModel = ref(DEFAULT_MODEL_BY_PROVIDER.anthropic)
  const apiKey = ref('')
  const messages = ref<Message[]>([])
  const inputValue = ref('')
  const isLoading = ref(false)
  const conversationId = ref<string | null>(null)
  const conversations = ref<any[]>([])
  const recentMessageId = ref<string | null>(null)
  const agentMode = ref<AgentMode>(
    (localStorage.getItem('syntax-senpai-agent-mode') as AgentMode) || 'ask',
  )
  const userMemories = ref<Array<{ key: string; value: string; category: string }>>([])
  const sidebarFilter = ref<'all' | 'favorites'>('all')
  const affection = ref(loadAffection(builtInWaifus[0]?.id || 'aria'))
  const apiTelemetry = ref<ApiTelemetry>(createEmptyApiTelemetry())
  const apiTelemetryHistory = ref<ApiTelemetrySample[]>(loadApiTelemetryHistory())
  const apiTelemetryAlert = ref<ApiTelemetryAlert>(createEmptyApiAlert())
  const maxToolIterations = ref(readStoredNumber(
    MAX_TOOL_ITERATIONS_STORAGE_KEY,
    DEFAULT_MAX_TOOL_ITERATIONS,
    1,
    24,
  ))
  const apiSpikeThresholdMs = ref(readStoredNumber(
    API_SPIKE_THRESHOLD_STORAGE_KEY,
    DEFAULT_API_SPIKE_THRESHOLD_MS,
    250,
    60000,
  ))

  function setAgentMode(mode: AgentMode) {
    agentMode.value = mode
    localStorage.setItem('syntax-senpai-agent-mode', mode)
  }

  function setMaxToolIterations(value: number) {
    const nextValue = Math.max(1, Math.min(24, Math.round(value)))
    maxToolIterations.value = nextValue
    localStorage.setItem(MAX_TOOL_ITERATIONS_STORAGE_KEY, String(nextValue))
  }

  function setApiSpikeThresholdMs(value: number) {
    const nextValue = Math.max(250, Math.min(60000, Math.round(value)))
    apiSpikeThresholdMs.value = nextValue
    localStorage.setItem(API_SPIKE_THRESHOLD_STORAGE_KEY, String(nextValue))

    apiTelemetryHistory.value = apiTelemetryHistory.value.map((sample) => ({
      ...sample,
      alert: sample.totalMs >= nextValue || sample.lastRoundTripMs >= nextValue,
    }))
    saveApiTelemetryHistory(apiTelemetryHistory.value)

    const latestSample = apiTelemetryHistory.value[0]
    apiTelemetryAlert.value = latestSample?.alert
      ? {
          active: true,
          thresholdMs: nextValue,
          message: `${latestSample.provider} ${latestSample.model} latency spiked to ${Math.round(latestSample.totalMs)} ms`,
          triggeredAt: latestSample.measuredAt,
        }
      : {
          active: false,
          thresholdMs: nextValue,
          message: '',
          triggeredAt: null,
        }
  }

  const selectedWaifu = computed(() =>
    builtInWaifus.find(w => w.id === selectedWaifuId.value) || builtInWaifus[0],
  )

  watch(selectedWaifuId, async (waifuId, previousWaifuId) => {
    affection.value = loadAffection(waifuId)

    if (!isSetup.value || waifuId === previousWaifuId) return

    messages.value = []
    conversationId.value = null
    await loadConversations()

    const saved = localStorage.getItem('syntax-senpai-setup')
    if (!saved) return

    try {
      const parsed = JSON.parse(saved)
      localStorage.setItem('syntax-senpai-setup', JSON.stringify({
        ...parsed,
        waifuId,
      }))
    } catch {
      // Ignore malformed setup state and keep the current session running.
    }
  })

  function readProviderPreferences(): Record<string, { model?: string }> {
    try {
      return JSON.parse(localStorage.getItem(PROVIDER_PREFERENCES_KEY) || '{}')
    } catch {
      return {}
    }
  }

  function saveProviderPreferences(provider: string, updates: { model?: string }) {
    const current = readProviderPreferences()
    current[provider] = {
      ...(current[provider] || {}),
      ...updates,
    }
    localStorage.setItem(PROVIDER_PREFERENCES_KEY, JSON.stringify(current))
  }

  async function hydrateProviderConfig(provider = selectedProvider.value) {
    selectedProvider.value = provider
    apiKey.value = (await keyManager.getKey(provider)) || ''
    selectedModel.value =
      readProviderPreferences()[provider]?.model ||
      DEFAULT_MODEL_BY_PROVIDER[provider] ||
      'gpt-4o'
  }

  function loadSetup() {
    const saved = localStorage.getItem('syntax-senpai-setup')
    if (saved) {
      const { waifuId, provider, model, hasSetup } = JSON.parse(saved)
      if (hasSetup) {
        selectedWaifuId.value = waifuId
        selectedProvider.value = provider
        selectedModel.value = model || DEFAULT_MODEL_BY_PROVIDER[provider] || 'gpt-4o'
        isSetup.value = true
      }
    }
  }

  async function setup(apiKeyValue: string, modelValue?: string) {
    const trimmedKey = apiKeyValue.trim()
    if (trimmedKey.length > 0) {
      await keyManager.setKey(selectedProvider.value, trimmedKey)
      apiKey.value = trimmedKey
    } else {
      apiKey.value = (await keyManager.getKey(selectedProvider.value)) || ''
    }

    selectedModel.value = modelValue || selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'
    saveProviderPreferences(selectedProvider.value, { model: selectedModel.value })

    localStorage.setItem('syntax-senpai-setup', JSON.stringify({
      waifuId: selectedWaifuId.value,
      provider: selectedProvider.value,
      model: selectedModel.value,
      hasSetup: true,
      demo: false,
    }))

    isSetup.value = true
    await createConversation()
  }

  async function saveApiKey(apiKeyValue: string) {
    const trimmedKey = apiKeyValue.trim()
    if (!trimmedKey) {
      throw new Error('API key cannot be empty')
    }

    await keyManager.setKey(selectedProvider.value, trimmedKey)
    apiKey.value = trimmedKey
  }

  async function createConversation(): Promise<string | null> {
    try {
      const waifu = selectedWaifu.value
      const res = await invoke(
        'store:createConversation',
        selectedWaifuId.value,
        `${waifu?.displayName || 'Conversation'} - ${new Date().toLocaleString()}`,
      )
      if (res?.success && res.conversation?.id) {
        conversationId.value = res.conversation.id
        await loadConversations()
        return res.conversation.id
      }
    } catch (err) {
      console.warn('createConversation failed:', err)
    }
    return null
  }

  async function newChat() {
    messages.value = []
    conversationId.value = null
    // Don't eagerly create — sendMessage creates it lazily on first message.
    // Only refresh sidebar so the user sees all existing conversations.
    await loadConversations()
  }

  async function loadConversations() {
    try {
      const res = await invoke('store:listConversations', selectedWaifuId.value)
      if (res?.success) conversations.value = res.conversations || []
    } catch (err) {
      console.warn('Failed to load conversations', err)
    }
  }

  async function selectConversation(id: string) {
    conversationId.value = id
    messages.value = []
    try {
      const res = await invoke('store:getMessages', id)
      if (res?.success) {
        // DB stores `createdAt`; normalize to `timestamp` for the UI
        messages.value = (res.messages || []).map((m: any) => ({
          ...m,
          timestamp: m.timestamp || m.createdAt || '',
        }))
      }
    } catch (err) {
      console.warn('Failed to select conversation', err)
    }
  }

  async function deleteConversation(id: string) {
    try {
      const res = await invoke('store:deleteConversation', id)
      if (res?.success) {
        await loadConversations()
        if (conversationId.value === id) {
          conversationId.value = null
          messages.value = []
        }
      }
    } catch (err) {
      console.warn('Failed to delete conversation', err)
    }
  }

  async function renameConversation(id: string, newTitle: string) {
    try {
      const res = await invoke('store:updateConversation', id, { title: newTitle })
      if (res?.success) await loadConversations()
    } catch (err) {
      console.warn('Rename failed:', err)
    }
  }

  async function autoNameConversation(id: string, firstUserMessage: string) {
    try {
      const key = await keyManager.getKey(selectedProvider.value)
      const model = selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'
      const waifu = selectedWaifu.value
      if (providerRequiresApiKey(selectedProvider.value) && !key) return
      const runtime = new AIChatRuntime({
        provider: providerRequiresApiKey(selectedProvider.value)
          ? ({ type: selectedProvider.value as any, apiKey: key } as any)
          : ({ type: selectedProvider.value as any } as any),
        model,
        systemPrompt: `You are ${waifu?.displayName || 'an assistant'}. Reply ONLY with a short chat title (3-6 words max, no quotes, no punctuation at end) that captures what the user's first message is about.`,
      })
      let title = ''
      for await (const chunk of runtime.streamMessage({ text: firstUserMessage, history: [] })) {
        if (chunk.type === 'text_delta' && chunk.delta) title += chunk.delta
      }
      title = title.trim().replace(/^["']|["']$/g, '').slice(0, 60)
      if (title) {
        await invoke('store:updateConversation', id, { title })
        await loadConversations()
      }
    } catch {
      // naming is best-effort, never block or surface errors
    }
  }

  async function toggleFavorite(id: string) {
    try {
      const res = await invoke('store:toggleFavorite', id)
      if (res?.success) {
        // Update local state immediately
        const conv = conversations.value.find((c: any) => c.id === id)
        if (conv) conv.favorited = res.favorited
      }
    } catch (err) {
      console.warn('Toggle favorite failed:', err)
    }
  }

  // ── AI Memory methods ──

  async function loadMemories() {
    try {
      const res = await invoke('memory:getAll')
      if (res?.success) userMemories.value = res.entries || []
    } catch (err) {
      console.warn('Failed to load memories:', err)
    }
  }

  async function setMemory(key: string, value: string, category = 'general') {
    try {
      const res = await invoke('memory:set', key, value, category)
      if (res?.success) await loadMemories()
    } catch (err) {
      console.warn('Failed to set memory:', err)
    }
  }

  async function deleteMemory(key: string) {
    try {
      const res = await invoke('memory:delete', key)
      if (res?.success) await loadMemories()
    } catch (err) {
      console.warn('Failed to delete memory:', err)
    }
  }

  async function clearMemories() {
    try {
      const res = await invoke('memory:clear')
      if (res?.success) userMemories.value = []
    } catch (err) {
      console.warn('Failed to clear memories:', err)
    }
  }

  function buildMemoryContext(): string {
    let memoryBlock = ''
    if (userMemories.value.length > 0) {
      const lines = userMemories.value.map((m) => `- [${m.category}] ${m.key}: ${m.value}`)
      memoryBlock = `\nCurrently stored memories:\n${lines.join('\n')}\n`
    }
    return `\n\n[User Memory - Persistent across chats]
You have a persistent memory system. Use it to remember important things about the user across conversations.${memoryBlock}
MEMORY INSTRUCTIONS — follow these on EVERY turn:
1. After reading the user's message, decide if it contains any new information worth remembering: their name, job, skills, interests, projects they're working on, tools they use, preferences (language, framework, style), goals, personal details, opinions, or anything they explicitly ask you to remember.
2. Also consider the conversation context — if the user reveals something indirectly (e.g. asking about React implies they work with it), that counts too.
3. For each piece of new information, emit a hidden memory tag at the END of your response (after your visible reply). Format:
<memory category="CATEGORY" key="KEY">VALUE</memory>

Categories: identity, preferences, projects, skills, general, user_notes
Keys should be short and descriptive (e.g. user_name, favorite_language, current_project, job_title, preferred_framework).
If a key already exists in stored memories, reuse it to update the value.

4. You can emit multiple memory tags per response.
5. Do NOT announce or mention the memory tags to the user. Just respond naturally, then append them at the very end.
6. If the user asks you to forget something, emit: <memory-delete key="KEY_TO_DELETE"/>
7. If the user shares personal details, acknowledge them warmly in your response.
8. Use stored memories actively — reference things you know about the user naturally in conversation.

Examples of what to save:
- User says "I'm a backend dev" → <memory category="identity" key="role">backend developer</memory>
- User asks about TypeScript → <memory category="skills" key="skill_typescript">uses TypeScript</memory>
- User says "I'm building a chat app" → <memory category="projects" key="current_project">building a chat app</memory>
- User says "I prefer dark themes" → <memory category="preferences" key="ui_preference">prefers dark themes</memory>
- User discusses debugging React → <memory category="skills" key="skill_react">works with React</memory>
- User says "remember I have a meeting Friday" → <memory category="user_notes" key="note_meeting">has a meeting on Friday</memory>`
  }

  function buildApiTelemetryPrompt(): string {
    const telemetry = apiTelemetry.value
    if (!telemetry.lastResponseMs || !telemetry.provider || !telemetry.model) return ''
    const recent = apiTelemetryHistory.value.slice(0, 10)
    const average = recent.length > 0
      ? Math.round(recent.reduce((sum, sample) => sum + sample.totalMs, 0) / recent.length)
      : Math.round(telemetry.lastResponseMs)
    const latestAlert = apiTelemetryAlert.value.active
      ? `ALERT: the latest response exceeded ${apiTelemetryAlert.value.thresholdMs} ms.`
      : `Status: within the normal threshold of ${apiSpikeThresholdMs.value} ms.`

    const total = Math.round(telemetry.lastResponseMs)
    const lastRoundTrip = telemetry.lastRoundTripMs ? Math.round(telemetry.lastRoundTripMs) : total
    const rounds = telemetry.roundTrips > 0 ? telemetry.roundTrips : 1

    return `\n\n[API Response Timing]
You are aware of your most recent API timing data.
- Provider: ${telemetry.provider}
- Model: ${telemetry.model}
- Last completed reply API time: ${total} ms total
- Last provider round-trip: ${lastRoundTrip} ms
- Provider round-trips used: ${rounds}
- Recent average reply time: ${average} ms
- Maximum tool iterations allowed for a reply: ${maxToolIterations.value}
- Response-time spike threshold: ${apiSpikeThresholdMs.value} ms
- ${latestAlert}

Do not mention these timings unless the user asks about speed, latency, slowness, or performance. If they do ask, use these numbers accurately and stay in character.`
  }

  function recordApiTelemetry(totalMs: number, roundTripMs: number[], provider: string, model: string) {
    const lastRoundTripMs = roundTripMs.length > 0 ? roundTripMs[roundTripMs.length - 1] : totalMs
    const alert = totalMs >= apiSpikeThresholdMs.value || lastRoundTripMs >= apiSpikeThresholdMs.value

    apiTelemetry.value = {
      lastResponseMs: totalMs,
      lastRoundTripMs,
      roundTrips: roundTripMs.length,
      provider,
      model,
      measuredAt: new Date().toISOString(),
    }

    const sample: ApiTelemetrySample = {
      id: `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      totalMs,
      lastRoundTripMs,
      roundTrips: roundTripMs.length,
      provider,
      model,
      measuredAt: new Date().toISOString(),
      alert,
    }

    apiTelemetryHistory.value = [sample, ...apiTelemetryHistory.value].slice(0, API_TELEMETRY_HISTORY_LIMIT)
    saveApiTelemetryHistory(apiTelemetryHistory.value)

    apiTelemetryAlert.value = alert
      ? {
          active: true,
          thresholdMs: apiSpikeThresholdMs.value,
          message: `${provider} ${model} latency spiked to ${Math.round(totalMs)} ms`,
          triggeredAt: sample.measuredAt,
        }
      : {
          active: false,
          thresholdMs: apiSpikeThresholdMs.value,
          message: '',
          triggeredAt: null,
        }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading.value) return

    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const trimmedText = text.trim()
    const setMeterMatch = trimmedText.match(/^\/setmeter\s+(-?\d+(?:\.\d+)?)$/i)

    if (setMeterMatch) {
      const newVal = clampAffection(Number(setMeterMatch[1]))
      affection.value = newVal
      saveAffection(selectedWaifuId.value, newVal)
      inputValue.value = ''

      const assistantId = `assistant-${Date.now()}`
      messages.value.push({
        id: assistantId,
        role: 'assistant',
        content: `好感度 forced to ${newVal}.`,
        timestamp: now(),
      })
      recentMessageId.value = assistantId
      setTimeout(() => { recentMessageId.value = null }, 1100)
      return
    }

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedText,
      timestamp: now(),
    }

    messages.value.push(userMsg)
    recentMessageId.value = userMsg.id
    inputValue.value = ''
    isLoading.value = true

    try {
      let convId = conversationId.value
      const isNewConversation = !convId
      if (!convId) {
        convId = await createConversation()
        if (convId) conversationId.value = convId
      }
      if (convId) {
        try { await invoke('store:addMessage', convId, userMsg) } catch (e) { console.warn('Failed to save user message:', e) }
      }
      // Refresh sidebar immediately so the new conversation is visible
      if (isNewConversation) await loadConversations()

      const key = await keyManager.getKey(selectedProvider.value)
      const waifu = selectedWaifu.value

      if (providerRequiresApiKey(selectedProvider.value) && (!key || key === '')) {
        throw new Error(`No API key configured for ${selectedProvider.value}. Open Settings and add one to chat with ${waifu?.displayName || 'your assistant'}.`)
      }

      const model = selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'
      let systemPrompt = createWaifuSystemPrompt(waifu, selectedProvider.value, model, affection.value)

      // Inject persistent memory context
      systemPrompt += buildMemoryContext()

      // Inject 好感度 system
      systemPrompt += buildAffectionPrompt(affection.value, waifu?.displayName || 'Waifu')

      // Let the waifu know how fast the last API reply was.
      systemPrompt += buildApiTelemetryPrompt()

      const tools = getToolsForMode(agentMode.value)
      const hasTools = tools.length > 0

      // Inject system context so the AI knows the user's environment
      if (hasTools) {
        let sys = (window as any).systemInfo
        if (!sys || !sys.homedir) {
          try { sys = await invoke('terminal:systemInfo') } catch {}
        }
        if (sys && sys.homedir) {
          systemPrompt += `\n\n[System Environment]\nOS: ${sys.platform}\nUsername: ${sys.username}\nHome directory: ${sys.homedir}`
        }
        systemPrompt += `\n\n[Agent Behavior]\nYou have access to a terminal tool to run commands on the user's computer and a web_search tool that uses DuckDuckGo for free public web search. Prefer web_search for current facts, news, documentation, or anything you should verify online. Use terminal for local machine tasks. You MUST stay fully in character as ${waifu?.displayName || 'your waifu persona'} at all times — even when executing commands or reporting results. Never sound like a generic AI assistant. Use your personality, catchphrases, emojis, and communication style. When you call stop_response, write your final_message entirely in character. Be concise — give the answer the user asked for, wrapped in your personality.`
      }

      const runtime = new AIChatRuntime({
        provider: providerRequiresApiKey(selectedProvider.value)
          ? ({ type: selectedProvider.value as any, apiKey: key } as any)
          : ({ type: selectedProvider.value as any } as any),
        model,
        systemPrompt,
      })

      if (hasTools) {
        // ── Agentic loop: AI calls terminal, repeats until stop_response ──
        const provider = runtime.getProvider()

        // Build AI-compatible message history (skip tool-display messages from UI)
        const aiHistory: any[] = messages.value
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ id: m.id, role: m.role, content: m.content }))

        const maxIterations = maxToolIterations.value
        let finalContent = ''
        let stopped = false
        const toolMsgIds: string[] = [] // track tool bubbles so we can remove them later
        const apiRoundTrips: number[] = []

        for (let i = 0; i <= maxIterations; i++) {
          const requestStartedAt = performance.now()
          const response = await provider.chat({
            model,
            messages: aiHistory,
            tools,
            systemPrompt,
          })
          apiRoundTrips.push(performance.now() - requestStartedAt)

          // No tool calls → natural stop, use the text response
          if (!response.toolCalls || response.toolCalls.length === 0) {
            finalContent = response.content
            break
          }

          // Add assistant's tool-call message to AI history
          aiHistory.push({
            id: response.id || `assistant-tc-${Date.now()}`,
            role: 'assistant',
            content: response.content || '',
            toolCalls: response.toolCalls,
          })

          // Process each tool call
          for (const tc of response.toolCalls) {
            // ── stop_response: AI is done ──
            if (tc.name === STOP_TOOL_NAME) {
              finalContent = (tc.arguments as any).final_message || response.content || ''
              stopped = true

              aiHistory.push({
                id: `tool-result-${Date.now()}-${tc.id}`,
                role: 'tool',
                content: 'ok',
                toolCallId: tc.id,
              })
              break
            }

            // ── set_affection: AI adjusts 好感度 ──
            if (tc.name === SET_AFFECTION_TOOL_NAME) {
              const newVal = Math.max(0, Math.min(100, Math.round(+(tc.arguments as any).value || affection.value)))
              affection.value = newVal
              saveAffection(selectedWaifuId.value, newVal)

              aiHistory.push({
                id: `tool-result-${Date.now()}-${tc.id}`,
                role: 'tool',
                content: `好感度 updated to ${newVal}`,
                toolCallId: tc.id,
              })
              continue
            }

            // ── terminal: run the command ──
            const cmd = (tc.arguments as any).command || ''
            const toolMsgId = `tool-${Date.now()}-${tc.id}`
            toolMsgIds.push(toolMsgId)

            // Show "running" indicator in chat
            messages.value.push({
              id: toolMsgId,
              role: 'assistant',
              content: `\u{1F4BB} \`$ ${cmd}\``,
              timestamp: now(),
            })
            recentMessageId.value = toolMsgId

            const result = await executeToolCall(tc)
            const preview = result.length > 500 ? result.slice(0, 500) + '\u2026' : result

            // Update chat bubble with output
            const toolMsg = messages.value.find((m) => m.id === toolMsgId)
            if (toolMsg) {
              toolMsg.content = `\u{1F4BB} \`$ ${cmd}\`\n\`\`\`\n${preview}\n\`\`\``
            }

            aiHistory.push({
              id: `tool-result-${Date.now()}-${tc.id}`,
              role: 'tool',
              content: result,
              toolCallId: tc.id,
            })
          }

          if (stopped) break

          if (i === maxIterations) {
            finalContent = '(Reached maximum iterations \u2014 stopping.)'
          }
        }

        // Remove tool execution messages now that we have the final response
        if (finalContent && toolMsgIds.length > 0) {
          const idsToRemove = new Set(toolMsgIds)
          messages.value = messages.value.filter((m) => !idsToRemove.has(m.id))
        }

        // Show the AI's final response
        if (finalContent) {
          recordApiTelemetry(
            apiRoundTrips.reduce((sum, value) => sum + value, 0),
            apiRoundTrips,
            selectedProvider.value,
            model,
          )

          // Extract memories from AI response and strip tags
          const cleanContent = extractMemoryFromAIResponse(finalContent)
          const assistantId = `assistant-${Date.now()}`
          messages.value.push({
            id: assistantId,
            role: 'assistant',
            content: cleanContent,
            timestamp: now(),
          })
          recentMessageId.value = assistantId

          if (convId) {
            try {
              await invoke('store:addMessage', convId, {
                id: assistantId,
                role: 'assistant',
                content: cleanContent,
                timestamp: now(),
              })
            } catch (e) { console.warn('Failed to save assistant message:', e) }
          }
          // Auto-name after first exchange (runs in background, doesn't block UI)
          if (isNewConversation && convId) autoNameConversation(convId, text)
        }
      } else {
        // ── No tools: streaming mode ──
        const aiMessages = messages.value.map((m) => ({ id: m.id, role: m.role, content: m.content }))
        let assistantContent = ''
        const assistantId = `assistant-${Date.now()}`
        let added = false
        const streamStartedAt = performance.now()

        for await (const chunk of runtime.streamMessage({ text, history: aiMessages })) {
          if (chunk.type === 'text_delta' && chunk.delta) {
            assistantContent += chunk.delta
            if (!added) {
              messages.value.push({
                id: assistantId,
                role: 'assistant',
                content: assistantContent,
                timestamp: now(),
              })
              added = true
              recentMessageId.value = assistantId
            } else {
              const last = messages.value[messages.value.length - 1]
              if (last?.id === assistantId) last.content = assistantContent
            }
          }
        }

        if (assistantContent) {
          const streamDurationMs = performance.now() - streamStartedAt
          recordApiTelemetry(streamDurationMs, [streamDurationMs], selectedProvider.value, model)

          // Extract memories from AI response and strip tags from displayed + stored content
          const cleanContent = extractMemoryFromAIResponse(assistantContent)
          const last = messages.value[messages.value.length - 1]
          if (last?.id === assistantId) last.content = cleanContent

          if (convId) {
            try {
              await invoke('store:addMessage', convId, {
                id: assistantId,
                role: 'assistant',
                content: cleanContent,
                timestamp: now(),
              })
            } catch (e) { console.warn('Failed to save assistant message:', e) }
            if (isNewConversation) autoNameConversation(convId, text)
          }
        }
      }
      // Auto-extract memory from user messages (name, preferences, etc.)
      extractAndSaveMemory(trimmedText)

    } catch (err: any) {
      messages.value.push({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err?.message || 'Unknown error'}`,
        timestamp: now(),
      })
    } finally {
      isLoading.value = false
      setTimeout(() => { recentMessageId.value = null }, 1100)
    }
  }

  function extractMemoryFromAIResponse(responseText: string): string {
    // Parse <memory category="..." key="...">value</memory> tags
    const memoryTagRegex = /<memory\s+category="([^"]+)"\s+key="([^"]+)">([^<]+)<\/memory>/gi
    let match: RegExpExecArray | null
    while ((match = memoryTagRegex.exec(responseText)) !== null) {
      const category = match[1].trim()
      const key = match[2].trim()
      const value = match[3].trim()
      if (key && value) {
        setMemory(key, value, category)
      }
    }

    // Parse <memory-delete key="..."/> tags
    const deleteTagRegex = /<memory-delete\s+key="([^"]+)"\s*\/>/gi
    let delMatch: RegExpExecArray | null
    while ((delMatch = deleteTagRegex.exec(responseText)) !== null) {
      const key = delMatch[1].trim()
      if (key) {
        const existing = userMemories.value.find((m) =>
          m.key.toLowerCase() === key.toLowerCase() || m.key.toLowerCase().includes(key.toLowerCase()),
        )
        if (existing) deleteMemory(existing.key)
      }
    }

    // Strip all memory tags from the displayed content
    return responseText
      .replace(/<memory\s+category="[^"]*"\s+key="[^"]*">[^<]*<\/memory>/gi, '')
      .replace(/<memory-delete\s+key="[^"]*"\s*\/>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()
  }

  function extractAndSaveMemory(userText: string) {
    const lower = userText.toLowerCase()

    // "remember that..." or "remember my..." patterns
    const rememberMatch = userText.match(/remember\s+(?:that\s+)?(?:my\s+)?(.+)/i)
    if (rememberMatch) {
      const memoryContent = rememberMatch[1].replace(/[.!?]+$/, '').trim()
      if (memoryContent.length > 2) {
        const key = `user_note_${Date.now()}`
        setMemory(key, memoryContent, 'user_notes')
      }
    }

    // "my name is ..."
    const nameMatch = userText.match(/(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
    if (nameMatch) {
      setMemory('user_name', nameMatch[1].trim(), 'identity')
    }

    // "i like / i love / my favorite..."
    const prefMatch = userText.match(/(?:i (?:like|love|prefer|enjoy))\s+(.{3,50}?)(?:\.|!|,|$)/i)
    if (prefMatch) {
      const key = `preference_${Date.now()}`
      setMemory(key, prefMatch[1].trim(), 'preferences')
    }

    // "i work with / i use / i'm using..."
    const toolMatch = userText.match(/(?:i (?:work with|use|am using|'m using))\s+(.{2,40}?)(?:\.|!|,|$)/i)
    if (toolMatch) {
      const tool = toolMatch[1].trim()
      setMemory(`tool_${tool.toLowerCase().replace(/\s+/g, '_')}`, tool, 'skills')
    }

    // "i'm a / i am a / i work as..."
    const roleMatch = userText.match(/(?:i(?:'m| am) (?:a |an )?|i work as (?:a |an )?)([a-z][\w\s]{2,30}?)(?:\.|!|,|$)/i)
    if (roleMatch && !nameMatch) {
      const role = roleMatch[1].trim()
      if (role.length > 2 && !/^(?:just|really|very|so|not|also)/.test(role.toLowerCase())) {
        setMemory('role', role, 'identity')
      }
    }

    // "i'm working on / i'm building / my project..."
    const projectMatch = userText.match(/(?:i(?:'m| am) (?:working on|building|making|developing)|my project(?:.*?)is)\s+(.{3,60}?)(?:\.|!|,|$)/i)
    if (projectMatch) {
      setMemory('current_project', projectMatch[1].trim(), 'projects')
    }

    // "my favorite ... is ..."
    const favMatch = userText.match(/my (?:fav(?:orite)?|preferred)\s+(\w+)\s+is\s+(.{2,40}?)(?:\.|!|,|$)/i)
    if (favMatch) {
      setMemory(`favorite_${favMatch[1].toLowerCase()}`, favMatch[2].trim(), 'preferences')
    }

    // "forget ..." - delete a memory
    const forgetMatch = lower.match(/forget\s+(?:about\s+)?(?:my\s+)?(.+)/i)
    if (forgetMatch) {
      const target = forgetMatch[1].replace(/[.!?]+$/, '').trim().toLowerCase()
      const match = userMemories.value.find((m) =>
        m.value.toLowerCase().includes(target) || m.key.toLowerCase().includes(target),
      )
      if (match) deleteMemory(match.key)
    }
  }

  return {
    isSetup,
    selectedWaifuId,
    selectedProvider,
    selectedModel,
    apiKey,
    messages,
    inputValue,
    isLoading,
    conversationId,
    conversations,
    recentMessageId,
    agentMode,
    selectedWaifu,
    affection,
    apiTelemetry,
    apiTelemetryHistory,
    apiTelemetryAlert,
    maxToolIterations,
    apiSpikeThresholdMs,
    userMemories,
    sidebarFilter,
    loadSetup,
    hydrateProviderConfig,
    saveApiKey,
    setup,
    setAgentMode,
    setMaxToolIterations,
    setApiSpikeThresholdMs,
    newChat,
    createConversation,
    loadConversations,
    selectConversation,
    deleteConversation,
    renameConversation,
    toggleFavorite,
    loadMemories,
    setMemory,
    deleteMemory,
    clearMemories,
    sendMessage,
  }
})
