<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { builtInWaifus } from '@syntax-senpai/waifu-core'
import { useChatStore } from './stores/chat'
import ChatBubble from './components/ChatBubble.vue'
import AppAvatar from './components/AppAvatar.vue'
import TypingDots from './components/TypingDots.vue'
import MessageSkeleton from './components/MessageSkeleton.vue'

const store = useChatStore()

const sidebarOpen = ref(true)
const showSettings = ref(false)
const showAgent = ref(false)
type AgentMode = 'ask' | 'auto' | 'full'
const agentMode = ref<AgentMode>((localStorage.getItem('syntax-senpai-agent-mode') as AgentMode) || 'ask')
const convSearch = ref('')

const messagesEndRef = ref<HTMLDivElement>()
const inputRef = ref<HTMLTextAreaElement>()

const filteredConversations = computed(() => {
  if (!convSearch.value) return store.conversations
  const q = convSearch.value.toLowerCase()
  return store.conversations.filter((c: any) => (c.title || '').toLowerCase().includes(q))
})

onMounted(() => {
  store.loadSetup()
  if (store.isSetup) store.loadConversations()
})

watch(() => store.messages.length, () => {
  nextTick(() => {
    messagesEndRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
})

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
  try {
    await store.setup(apiKeyValue)
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
  agentMode.value = mode
  localStorage.setItem('syntax-senpai-agent-mode', mode)
}
</script>

<template>
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
        <div class="glass-surface rounded-2xl p-6 max-w-md w-full mx-4 animate-content-show">
          <h2 class="text-xl font-bold text-white mb-4">
            Settings
          </h2>

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
              <option value="anthropic">
                Anthropic
              </option>
              <option value="openai">
                OpenAI
              </option>
              <option value="gemini">
                Gemini
              </option>
              <option value="mistral">
                Mistral
              </option>
              <option value="groq">
                Groq
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
        style="background: radial-gradient(circle at 10% 10%, rgba(99,102,241,0.12), transparent 8%), radial-gradient(circle at 90% 90%, rgba(236,72,153,0.08), transparent 18%); filter: blur(40px)"
      />
    </div>

    <!-- Sidebar -->
    <Transition
      enter-active-class="transition-all duration-200"
      leave-active-class="transition-all duration-200"
      enter-from-class="-translate-x-6 opacity-0"
      leave-to-class="-translate-x-6 opacity-0"
    >
      <div
        v-if="sidebarOpen"
        :class="[
          'w-72 flex flex-col p-4',
          'glass-surface border-r border-neutral-800/40',
        ]"
      >
        <h1 class="text-xl font-bold text-primary-400 mb-4 font-display">
          SyntaxSenpai
        </h1>

        <div class="flex items-center gap-2 mb-3">
          <div class="flex-1">
            <p class="text-xs text-neutral-500">
              Waifu
            </p>
            <p class="text-sm font-semibold">
              {{ store.selectedWaifu?.displayName }}
            </p>
          </div>
          <button class="btn-ghost text-xs px-3 py-1" @click="store.createConversation()">
            New
          </button>
        </div>

        <input
          v-model="convSearch"
          placeholder="Search conversations"
          class="input-field text-sm mb-3"
        >

        <div class="flex-1 overflow-auto">
          <p v-if="store.conversations.length === 0" class="text-xs text-neutral-500">
            No conversations yet
          </p>
          <ul class="space-y-2">
            <li
              v-for="c in filteredConversations"
              :key="c.id"
              :class="[
                'flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer',
                'transition-all duration-160',
                store.conversationId === c.id
                  ? 'bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-lg'
                  : 'hover:bg-white/4 text-neutral-300',
              ]"
              @click="store.selectConversation(c.id)"
            >
              <AppAvatar :name="c.title || store.selectedWaifu?.displayName" :size="32" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold truncate">
                  {{ c.title }}
                </div>
                <div class="text-xs text-neutral-400">
                  {{ new Date(c.updatedAt).toLocaleString() }}
                </div>
              </div>
              <div class="flex gap-1 shrink-0">
                <button
                  class="text-xs px-1 opacity-60 hover:opacity-100"
                  title="Delete"
                  @click.stop="store.deleteConversation(c.id)"
                >
                  ✕
                </button>
              </div>
            </li>
          </ul>
        </div>

        <div class="mt-3 space-y-2">
          <button class="btn-primary w-full text-sm" @click="showAgent = true">
            Agent
          </button>
          <button class="btn-secondary w-full text-sm" @click="showSettings = true">
            Settings
          </button>
          <button class="btn-ghost w-full text-sm" @click="sidebarOpen = false">
            Collapse
          </button>
        </div>
      </div>
    </Transition>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col">
      <!-- Header -->
      <div
        :class="[
          'sticky top-0 z-20 px-6 py-3',
          'glass-surface border-b border-neutral-800/40',
          'flex items-center justify-between',
        ]"
      >
        <div class="flex items-center gap-3">
          <button class="btn-ghost p-2" @click="sidebarOpen = !sidebarOpen">
            {{ sidebarOpen ? '←' : '☰' }}
          </button>
          <div>
            <div class="text-lg font-bold font-display">
              {{ store.selectedWaifu?.displayName }}
            </div>
            <div class="text-xs text-neutral-400">
              {{ store.selectedWaifu?.backstory?.slice(0, 60) }}
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
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <div
          v-if="store.messages.length === 0"
          class="flex flex-col items-center justify-center h-full text-center text-neutral-400"
        >
          <div class="text-4xl mb-4">
            💬
          </div>
          <h3 class="text-lg font-semibold text-white mb-2 font-display">
            Chat with {{ store.selectedWaifu?.displayName }}
          </h3>
          <p class="text-sm">
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
                :class="[
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold',
                  'bg-gradient-to-br from-purple-600 to-pink-500',
                ]"
              >
                {{ store.selectedWaifu?.displayName?.[0] || 'A' }}
              </div>
            </div>

            <ChatBubble
              :role="msg.role"
              :content="msg.content"
              :timestamp="msg.timestamp"
              :recent="msg.id === store.recentMessageId"
            />

            <div v-if="msg.role === 'user'" class="ml-3 shrink-0">
              <div class="w-8 h-8 rounded-full bg-primary-700 flex items-center justify-center text-xs font-semibold">
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
      <div class="glass-surface border-t border-neutral-800/40 p-4">
        <div class="flex gap-3">
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
            class="btn-primary min-w-fit flex items-center gap-2"
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
