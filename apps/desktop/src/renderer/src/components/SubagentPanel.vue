<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SubagentSnapshot, SubagentStatus } from '../agent/subagent-runner'

const props = defineProps<{
  subagents: SubagentSnapshot[]
}>()

const expanded = ref<Record<string, boolean>>({})

function toggle(id: string) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}

function statusLabel(status: SubagentStatus): string {
  switch (status) {
    case 'queued': return 'queued'
    case 'running': return 'running'
    case 'completed': return 'done'
    case 'failed': return 'failed'
    case 'aborted': return 'aborted'
  }
}

function statusClass(status: SubagentStatus): string {
  switch (status) {
    case 'queued': return 'bg-neutral-700/60 text-neutral-300'
    case 'running': return 'bg-blue-500/20 text-blue-300 animate-pulse'
    case 'completed': return 'bg-emerald-500/20 text-emerald-300'
    case 'failed': return 'bg-red-500/25 text-red-300'
    case 'aborted': return 'bg-amber-500/20 text-amber-300'
  }
}

function elapsedLabel(snap: SubagentSnapshot): string {
  if (snap.startedAt == null) return ''
  const end = snap.endedAt ?? performance.now()
  const ms = end - snap.startedAt
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function previewMessage(text: string, limit = 200): string {
  const trimmed = (text || '').trim()
  if (trimmed.length <= limit) return trimmed
  return trimmed.slice(0, limit) + '…'
}

const summary = computed(() => {
  const total = props.subagents.length
  const completed = props.subagents.filter((s) => s.status === 'completed').length
  const failed = props.subagents.filter((s) => s.status === 'failed' || s.status === 'aborted').length
  const running = props.subagents.filter((s) => s.status === 'running' || s.status === 'queued').length
  return { total, completed, failed, running }
})
</script>

<template>
  <div v-if="subagents.length > 0" class="subagent-panel mt-2 rounded-xl border border-white/10 bg-neutral-900/50 backdrop-blur-sm">
    <div class="px-3 py-2 border-b border-white/5 text-xs text-neutral-400 flex items-center gap-2">
      <span>🤖 Subagents</span>
      <span>·</span>
      <span>{{ summary.total }} total</span>
      <span v-if="summary.running > 0" class="text-blue-300">{{ summary.running }} running</span>
      <span v-if="summary.completed > 0" class="text-emerald-300">{{ summary.completed }} done</span>
      <span v-if="summary.failed > 0" class="text-red-300">{{ summary.failed }} failed</span>
    </div>
    <ul class="divide-y divide-white/5">
      <li
        v-for="snap in subagents"
        :key="snap.id"
        class="px-3 py-2"
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="text-neutral-500 hover:text-neutral-200 transition-colors text-xs select-none w-3 text-left"
            :aria-label="expanded[snap.id] ? 'Collapse' : 'Expand'"
            @click="toggle(snap.id)"
          >
            {{ expanded[snap.id] ? '▾' : '▸' }}
          </button>
          <span class="font-medium text-sm text-neutral-200 truncate flex-1">{{ snap.name }}</span>
          <span :class="['text-[10px] px-1.5 py-0.5 rounded font-medium', statusClass(snap.status)]">
            {{ statusLabel(snap.status) }}
          </span>
          <span class="text-[10px] text-neutral-500 tabular-nums">{{ snap.iterations }}/{{ snap.maxIterations }}</span>
          <span v-if="snap.startedAt != null" class="text-[10px] text-neutral-500 tabular-nums">{{ elapsedLabel(snap) }}</span>
        </div>
        <div class="text-[11px] text-neutral-500 mt-0.5 ml-5 italic truncate">
          {{ snap.task }}
        </div>
        <div v-if="snap.status === 'completed' && snap.finalMessage && !expanded[snap.id]" class="text-xs text-neutral-300 mt-1 ml-5">
          {{ previewMessage(snap.finalMessage) }}
        </div>
        <div v-if="expanded[snap.id]" class="ml-5 mt-2 space-y-2">
          <div v-if="snap.toolCalls.length > 0">
            <div class="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Tools</div>
            <ul class="text-[11px] text-neutral-300 font-mono space-y-0.5">
              <li v-for="(tc, i) in snap.toolCalls" :key="i" :class="tc.ok ? 'text-neutral-300' : 'text-red-300'">
                {{ tc.ok ? '✓' : '✗' }} {{ tc.name }}
              </li>
            </ul>
          </div>
          <div v-if="snap.errorMessage" class="text-[11px] text-red-300">
            Error: {{ snap.errorMessage }}
          </div>
          <div v-if="snap.finalMessage">
            <div class="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Report</div>
            <pre class="text-xs text-neutral-200 whitespace-pre-wrap break-words bg-neutral-950/50 p-2 rounded border border-white/5 max-h-72 overflow-y-auto">{{ snap.finalMessage }}</pre>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.subagent-panel {
  font-feature-settings: "tnum" 1;
}
</style>
