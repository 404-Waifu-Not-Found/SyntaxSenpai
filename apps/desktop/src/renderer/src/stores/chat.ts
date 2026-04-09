import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { buildSystemPrompt, builtInWaifus } from '@syntax-senpai/waifu-core'
import { AIChatRuntime } from '@syntax-senpai/ai-core'
import { useIpc } from '../composables/use-ipc'
import { useKeyManager } from '../composables/use-key-manager'
import { getToolsForMode, executeToolCall, STOP_TOOL_NAME, type AgentMode } from '../agent-tools'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

const PROVIDER_PREFERENCES_KEY = 'syntax-senpai-provider-preferences'

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o',
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

function createWaifuSystemPrompt(waifu: any, provider: string, model: string) {
  return buildSystemPrompt(
    waifu,
    {
      waifuId: waifu.id,
      userId: 'local-user',
      affectionLevel: 40,
      selectedAIProvider: provider,
      selectedModel: model,
      createdAt: new Date().toISOString(),
      lastInteractedAt: new Date().toISOString(),
    },
    {
      userId: 'local-user',
      affectionLevel: 40,
      platform: 'desktop',
      availableTools: Object.entries(waifu.capabilities || {})
        .filter(([, enabled]) => !!enabled)
        .map(([name]) => name),
    },
  )
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

  function setAgentMode(mode: AgentMode) {
    agentMode.value = mode
    localStorage.setItem('syntax-senpai-agent-mode', mode)
  }

  const selectedWaifu = computed(() =>
    builtInWaifus.find(w => w.id === selectedWaifuId.value) || builtInWaifus[0],
  )

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
      if (!key) return
      const runtime = new AIChatRuntime({
        provider: { type: selectedProvider.value as any, apiKey: key } as any,
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
    if (userMemories.value.length === 0) return ''
    const lines = userMemories.value.map((m) => `- [${m.category}] ${m.key}: ${m.value}`)
    return `\n\n[User Memory - Persistent across chats]\nYou have access to the following remembered information about the user. Use this to personalize your responses:\n${lines.join('\n')}\n\nIMPORTANT: If the user asks you to remember something, respond naturally and confirm you'll remember it. The system will save it automatically. If the user shares personal details (name, preferences, interests, projects), acknowledge them warmly.`
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading.value) return

    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
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

      if (!key || key === '') {
        throw new Error(`No API key configured for ${selectedProvider.value}. Open Settings and add one to chat with ${waifu?.displayName || 'your assistant'}.`)
      }

      const model = selectedModel.value || DEFAULT_MODEL_BY_PROVIDER[selectedProvider.value] || 'gpt-4o'
      let systemPrompt = createWaifuSystemPrompt(waifu, selectedProvider.value, model)

      // Inject persistent memory context
      systemPrompt += buildMemoryContext()

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
        systemPrompt += `\n\n[Agent Behavior]\nYou have access to a terminal tool to run commands on the user's computer. You MUST stay fully in character as ${waifu?.displayName || 'your waifu persona'} at all times — even when executing commands or reporting results. Never sound like a generic AI assistant. Use your personality, catchphrases, emojis, and communication style. When you call stop_response, write your final_message entirely in character. Be concise — give the answer the user asked for, wrapped in your personality.`
      }

      const runtime = new AIChatRuntime({
        provider: { type: selectedProvider.value as any, apiKey: key } as any,
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

        const maxIterations = 12
        let finalContent = ''
        let stopped = false
        const toolMsgIds: string[] = [] // track tool bubbles so we can remove them later

        for (let i = 0; i <= maxIterations; i++) {
          const response = await provider.chat({
            model,
            messages: aiHistory,
            tools,
            systemPrompt,
          })

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
          const assistantId = `assistant-${Date.now()}`
          messages.value.push({
            id: assistantId,
            role: 'assistant',
            content: finalContent,
            timestamp: now(),
          })
          recentMessageId.value = assistantId

          if (convId) {
            try {
              await invoke('store:addMessage', convId, {
                id: assistantId,
                role: 'assistant',
                content: finalContent,
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

        if (assistantContent && convId) {
          try {
            await invoke('store:addMessage', convId, {
              id: assistantId,
              role: 'assistant',
              content: assistantContent,
              timestamp: now(),
            })
          } catch (e) { console.warn('Failed to save assistant message:', e) }
          if (isNewConversation) autoNameConversation(convId, text)
        }
      }
      // Auto-extract memory from user messages (name, preferences, etc.)
      extractAndSaveMemory(text)

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

    // "forget ..." - delete a memory
    const forgetMatch = lower.match(/forget\s+(?:about\s+)?(?:my\s+)?(.+)/i)
    if (forgetMatch) {
      const target = forgetMatch[1].replace(/[.!?]+$/, '').trim().toLowerCase()
      // Try to find and delete matching memory
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
    userMemories,
    sidebarFilter,
    loadSetup,
    hydrateProviderConfig,
    saveApiKey,
    setup,
    setAgentMode,
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
