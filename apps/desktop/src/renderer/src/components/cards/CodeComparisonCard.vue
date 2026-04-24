<script setup lang="ts">
import { computed } from 'vue'

interface CodeSide {
  label?: string
  language?: string
  code?: string
}

const props = defineProps<{
  data: {
    title?: string
    before?: CodeSide
    after?: CodeSide
  }
}>()

const before = computed<CodeSide>(() => props.data.before || {})
const after = computed<CodeSide>(() => props.data.after || {})
</script>

<template>
  <div class="code-comparison-card">
    <div v-if="data.title" class="code-comparison-title">{{ data.title }}</div>
    <div class="code-comparison-grid">
      <div class="code-comparison-side code-comparison-before">
        <div class="code-comparison-header">
          <span class="code-comparison-tag">{{ before.label || 'Before' }}</span>
          <span v-if="before.language" class="code-comparison-lang">{{ before.language }}</span>
        </div>
        <pre><code>{{ before.code ?? '' }}</code></pre>
      </div>
      <div class="code-comparison-side code-comparison-after">
        <div class="code-comparison-header">
          <span class="code-comparison-tag">{{ after.label || 'After' }}</span>
          <span v-if="after.language" class="code-comparison-lang">{{ after.language }}</span>
        </div>
        <pre><code>{{ after.code ?? '' }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-comparison-card {
  margin: 0.25rem 0;
  padding: 0.85rem;
  border-radius: 0.85rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.code-comparison-title { font-weight: 700; color: #f1f5f9; margin-bottom: 0.6rem; font-size: 0.95rem; }
.code-comparison-grid { display: grid; grid-template-columns: 1fr; gap: 0.6rem; }
@media (min-width: 640px) {
  .code-comparison-grid { grid-template-columns: 1fr 1fr; }
}
.code-comparison-side { display: flex; flex-direction: column; min-width: 0; }
.code-comparison-header { display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0.5rem; font-size: 0.72rem; border-radius: 0.45rem 0.45rem 0 0; }
.code-comparison-before .code-comparison-header { background: rgba(239, 68, 68, 0.18); color: #fecaca; }
.code-comparison-after .code-comparison-header { background: rgba(34, 197, 94, 0.18); color: #bbf7d0; }
.code-comparison-tag { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.code-comparison-lang { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; opacity: 0.75; }
pre {
  margin: 0; padding: 0.7rem;
  background: rgba(2, 6, 23, 0.72);
  border-radius: 0 0 0.5rem 0.5rem;
  overflow-x: auto; color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem; line-height: 1.55;
}
</style>
