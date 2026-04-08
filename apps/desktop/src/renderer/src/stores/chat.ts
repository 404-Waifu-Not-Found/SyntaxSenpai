import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { builtInWaifus } from '@syntax-senpai/waifu-core'
import { AIChatRuntime } from '@syntax-senpai/ai-core'
import { useIpc } from '../composables/use-ipc'
import { useKeyManager } from '../composables/use-key-manager'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export const useChatStore = defineStore('chat', () => {
  const { invoke } = useIpc()
  const keyManager = useKeyManager()

  const isSetup = ref(false)
  const selectedWaifuId = ref(builtInWaifus[0]?.id || 'aria')
  const selectedProvider = ref('anthropic')
  const apiKey = ref('')
  const messages = ref<Message[]>([])
  const inputValue = ref('')
  const isLoading = ref(false)
  const conversationId = ref<string | null>(null)
  const conversations = ref<any[]>([])
  const recentMessageId = ref<string | null>(null)

  const selectedWaifu = computed(() =>
    builtInWaifus.find(w => w.id === selectedWaifuId.value) || builtInWaifus[0],
  )

  function loadSetup() {
    const saved = localStorage.getItem('syntax-senpai-setup')
    if (saved) {
      const { waifuId, provider, hasSetup } = JSON.parse(saved)
      if (hasSetup) {
        selectedWaifuId.value = waifuId
        selectedProvider.value = provider
        isSetup.value = true
      }
    }
  }

  async function setup(apiKeyValue: string) {
    if (apiKeyValue && apiKeyValue.length > 0) {
      await keyManager.setKey(selectedProvider.value, apiKeyValue)
      apiKey.value = apiKeyValue
    } else {
      await keyManager.setKey(selectedProvider.value, '')
      apiKey.value = ''
    }

    localStorage.setItem('syntax-senpai-setup', JSON.stringify({
      waifuId: selectedWaifuId.value,
      provider: selectedProvider.value,
      hasSetup: true,
      demo: !apiKeyValue,
    }))

    isSetup.value = true
    await createConversation()
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
    try {
      const res = await invoke('store:getMessages', id)
      if (res?.success) messages.value = res.messages || []
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

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading.value) return

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    messages.value.push(userMsg)
    recentMessageId.value = userMsg.id
    inputValue.value = ''
    isLoading.value = true

    try {
      let convId = conversationId.value
      if (!convId) {
        convId = await createConversation()
        if (convId) conversationId.value = convId
      }
      if (convId) {
        try { await invoke('store:addMessage', convId, userMsg) } catch {}
      }

      const key = await keyManager.getKey(selectedProvider.value)
      const waifu = selectedWaifu.value

      let runtime: any
      if (!key || key === '') {
        runtime = {
          async *streamMessage({ text: userText }: any) {
            const persona = waifu?.displayName || 'Assistant'
            const reply = `${persona}: ${userText.split('').reverse().join('')}`
            for (let i = 0; i < reply.length; i += 16) {
              await new Promise(r => setTimeout(r, 30))
              yield { type: 'text_delta', delta: reply.slice(i, i + 16) }
            }
          },
        }
      } else {
        runtime = new AIChatRuntime({
          provider: { type: selectedProvider.value as any, apiKey: key } as any,
          model: selectedProvider.value === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-20241022',
          systemPrompt: `You are ${waifu.displayName}. ${waifu.backstory}`,
        })
      }

      const aiMessages = messages.value.map(m => ({ id: m.id, role: m.role, content: m.content }))
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
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          })
        } catch {}
      }
    } catch (err: any) {
      messages.value.push({
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err?.message || 'Unknown error'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      })
    } finally {
      isLoading.value = false
      setTimeout(() => { recentMessageId.value = null }, 1100)
    }
  }

  return {
    isSetup,
    selectedWaifuId,
    selectedProvider,
    apiKey,
    messages,
    inputValue,
    isLoading,
    conversationId,
    conversations,
    recentMessageId,
    selectedWaifu,
    loadSetup,
    setup,
    createConversation,
    loadConversations,
    selectConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
  }
})
