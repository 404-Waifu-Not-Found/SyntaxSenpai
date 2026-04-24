<script setup lang="ts">
import { ref, computed } from 'vue'
import CardRenderer from './cards/CardRenderer.vue'

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

const CARD_FENCE = 'syntax-senpai-card'

type RenderedPart =
  | { kind: 'html'; html: string }
  | { kind: 'card'; cardType: string; data: Record<string, unknown> }
  | { kind: 'card-error'; message: string }

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

function isHorizontalRule(line: string): boolean {
  return /^(\s*)([-*_])(\s*\2){2,}\s*$/.test(line)
}

function isTableRow(line: string): boolean {
  return /^\s*\|?.+\|.+\|?\s*$/.test(line)
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => formatInlineMarkdown(cell.trim()))
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

    if (isHorizontalRule(line)) {
      blocks.push('<hr>')
      index += 1
      continue
    }

    if (
      index + 1 < lines.length &&
      isTableRow(line) &&
      isTableDivider(lines[index + 1])
    ) {
      const headerCells = parseTableCells(line)
      index += 2
      const bodyRows: string[][] = []
      while (index < lines.length && lines[index].trim() && isTableRow(lines[index])) {
        bodyRows.push(parseTableCells(lines[index]))
        index += 1
      }

      blocks.push(
        `<div class="table-wrap"><table><thead><tr>${headerCells.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>` +
        `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      )
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`)
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

const hasCard = computed(() => renderedParts.value.some((p) => p.kind === 'card'))

const bubbleClasses = computed(() => [
  'relative px-4 py-3 rounded-xl',
  hasCard.value ? 'max-w-md lg:max-w-xl' : 'max-w-xs lg:max-w-md',
  'transition-all duration-160 ease-out',
  props.role === 'user'
    ? 'themed-user-bubble text-white animate-slide-up'
    : 'glass-surface text-neutral-100 animate-slide-up',
  props.recent ? 'animate-pop-in' : '',
])

function splitOnCardFences(raw: string): RenderedPart[] {
  const parts: RenderedPart[] = []
  const pattern = new RegExp('```' + CARD_FENCE + '\\s*\\n([\\s\\S]*?)\\n```', 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw)) !== null) {
    const before = raw.slice(lastIndex, match.index)
    if (before.trim()) parts.push({ kind: 'html', html: renderMarkdown(before) })
    try {
      const parsed = JSON.parse(match[1]) as { type?: unknown; data?: unknown }
      if (
        parsed &&
        typeof parsed.type === 'string' &&
        parsed.data &&
        typeof parsed.data === 'object'
      ) {
        parts.push({ kind: 'card', cardType: parsed.type, data: parsed.data as Record<string, unknown> })
      } else {
        parts.push({ kind: 'card-error', message: 'Card payload missing type or data.' })
      }
    } catch {
      parts.push({ kind: 'card-error', message: 'Card payload was not valid JSON.' })
    }
    lastIndex = pattern.lastIndex
  }
  const tail = raw.slice(lastIndex)
  if (tail.trim()) parts.push({ kind: 'html', html: renderMarkdown(tail) })
  return parts
}

const renderedParts = computed<RenderedPart[]>(() => {
  const raw = props.content || ''
  if (!raw) return []
  if (!raw.includes(CARD_FENCE)) {
    return [{ kind: 'html', html: renderMarkdown(raw) }]
  }
  return splitOnCardFences(raw)
})
</script>

<template>
  <div :class="bubbleClasses">
    <div ref="containerRef">
      <div class="break-words text-sm">
        <template v-if="role === 'assistant'">
          <template v-for="(part, index) in renderedParts" :key="index">
            <div v-if="part.kind === 'html'" class="markdown-content" v-html="part.html" />
            <CardRenderer
              v-else-if="part.kind === 'card'"
              :type="part.cardType"
              :data="part.data"
            />
            <div v-else class="card-parse-error">{{ part.message }}</div>
          </template>
        </template>
        <template v-else>
          <slot>
            <div class="whitespace-pre-wrap">{{ content }}</div>
          </slot>
        </template>
      </div>
    </div>
    <div
      v-if="timestamp || (showCopy && content)"
      class="flex items-center gap-2 mt-1"
    >
      <p
        v-if="timestamp"
        :class="[
          'text-xs',
          role === 'user' ? 'text-primary-200' : 'text-neutral-500',
        ]"
      >
        {{ timestamp }}
      </p>
      <button
        v-if="showCopy && content"
        :class="[
          'text-xs px-2 py-0.5 rounded',
          'bg-neutral-800/80 hover:bg-neutral-700 backdrop-blur-sm',
          'transition-all duration-200',
        ]"
        @click="handleCopy"
      >
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>
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

.markdown-content :deep(hr) {
  margin: 0.9rem 0;
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.markdown-content :deep(pre) {
  position: relative;
  margin: 0 0 0.75rem;
  padding: 0.8rem;
  padding-top: 1.6rem;
  border-radius: 0.75rem;
  overflow-x: auto;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.markdown-content :deep(pre[data-language])::before {
  content: attr(data-language);
  position: absolute;
  top: 0.3rem;
  right: 0.6rem;
  font-size: 0.68rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.32);
  pointer-events: none;
  user-select: none;
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

.markdown-content :deep(.table-wrap) {
  margin: 0 0 0.75rem;
  overflow-x: auto;
}

.markdown-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 0.5rem 0.65rem;
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.markdown-content :deep(th) {
  background: rgba(255, 255, 255, 0.08);
  font-weight: 700;
}

.markdown-content :deep(td) {
  background: rgba(255, 255, 255, 0.03);
}

.markdown-content :deep(strong) {
  font-weight: 700;
}

.markdown-content :deep(em) {
  font-style: italic;
}

.card-parse-error {
  margin: 0.25rem 0;
  padding: 0.5rem 0.7rem;
  border-radius: 0.55rem;
  background: rgba(127, 29, 29, 0.2);
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #fecaca;
  font-size: 0.8rem;
}
</style>
