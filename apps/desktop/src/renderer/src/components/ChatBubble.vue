<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  role?: 'user' | 'assistant'
  content?: string
  timestamp?: string
  recent?: boolean
  showCopy?: boolean
}>(), {
  role: 'assistant',
  recent: false,
  showCopy: true,
})

const copied = ref(false)
const containerRef = ref<HTMLDivElement>()

async function handleCopy() {
  try {
    const text = props.content || containerRef.value?.innerText || ''
    if (!text) return
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  } catch {
    // ignore
  }
}

const bubbleClasses = computed(() => [
  'relative px-4 py-3 rounded-xl max-w-xs lg:max-w-md',
  'transition-all duration-160 ease-out',
  props.role === 'user'
    ? 'themed-user-bubble text-white animate-slide-up'
    : 'glass-surface text-neutral-100 animate-slide-up',
  props.recent ? 'animate-pop-in' : '',
])
</script>

<template>
  <div :class="bubbleClasses">
    <div ref="containerRef" class="relative">
      <div
        :class="[
          'break-words text-sm whitespace-pre-wrap',
          showCopy ? 'pr-12' : '',
        ]"
      >
        <slot>{{ content }}</slot>
      </div>
      <button
        v-if="showCopy && content"
        :class="[
          'absolute top-1 right-1 text-xs px-2 py-1 rounded',
          'bg-neutral-800/80 hover:bg-neutral-700 backdrop-blur-sm',
          'transition-all duration-200',
        ]"
        @click="handleCopy"
      >
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>
    <p
      v-if="timestamp"
      :class="[
        'text-xs mt-1',
        role === 'user' ? 'text-primary-200' : 'text-neutral-500',
      ]"
    >
      {{ timestamp }}
    </p>
  </div>
</template>
