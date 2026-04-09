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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

function renderMarkdown(value: string): string {
  const escaped = escapeHtml(value).replace(/\r\n/g, '\n')
  const lines = escaped.split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = []
      const language = line.slice(3).trim()
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      const languageAttr = language ? ` data-language="${language}"` : ''
      blocks.push(`<pre${languageAttr}><code>${codeLines.join('\n')}</code></pre>`)
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(`<blockquote>${quoteLines.map((entry) => formatInlineMarkdown(entry)).join('<br>')}</blockquote>`)
      continue
    }

    if (/^(-|\*|\d+\.)\s+/.test(line)) {
      const isOrdered = /^\d+\.\s+/.test(line)
      const items: string[] = []
      while (index < lines.length && /^(-|\*|\d+\.)\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^(-|\*|\d+\.)\s+/, ''))
        index += 1
      }
      const tag = isOrdered ? 'ol' : 'ul'
      blocks.push(`<${tag}>${items.map((entry) => `<li>${formatInlineMarkdown(entry)}</li>`).join('')}</${tag}>`)
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith('```') &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^(-|\*|\d+\.)\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index])
      index += 1
    }
    blocks.push(`<p>${formatInlineMarkdown(paragraphLines.join('<br>'))}</p>`)
  }

  return blocks.join('')
}

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

const renderedAssistantHtml = computed(() => renderMarkdown(props.content || ''))
</script>

<template>
  <div :class="bubbleClasses">
    <div ref="containerRef" class="relative">
      <div
        :class="[
          'break-words text-sm',
          showCopy ? 'pr-12' : '',
        ]"
      >
        <div
          v-if="role === 'assistant'"
          class="markdown-content"
          v-html="renderedAssistantHtml"
        />
        <template v-else>
          <slot>
            <div class="whitespace-pre-wrap">{{ content }}</div>
          </slot>
        </template>
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

<style scoped>
.markdown-content :deep(p) {
  margin: 0 0 0.65rem;
  line-height: 1.55;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin: 0 0 0.5rem;
  font-weight: 700;
  line-height: 1.3;
}

.markdown-content :deep(h1) { font-size: 1.125rem; }
.markdown-content :deep(h2) { font-size: 1.05rem; }
.markdown-content :deep(h3) { font-size: 1rem; }

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0 0 0.75rem;
  padding-left: 1.2rem;
}

.markdown-content :deep(li) {
  margin: 0.2rem 0;
}

.markdown-content :deep(blockquote) {
  margin: 0 0 0.75rem;
  padding-left: 0.85rem;
  border-left: 3px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.82);
}

.markdown-content :deep(pre) {
  margin: 0 0 0.75rem;
  padding: 0.8rem;
  border-radius: 0.75rem;
  overflow-x: auto;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.markdown-content :deep(code) {
  padding: 0.12rem 0.35rem;
  border-radius: 0.35rem;
  background: rgba(255, 255, 255, 0.08);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}

.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-content :deep(a) {
  color: #93c5fd;
  text-decoration: underline;
}

.markdown-content :deep(strong) {
  font-weight: 700;
}

.markdown-content :deep(em) {
  font-style: italic;
}
</style>
