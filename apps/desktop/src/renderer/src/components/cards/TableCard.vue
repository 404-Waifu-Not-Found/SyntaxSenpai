<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  data: {
    title?: string
    headers?: unknown[]
    rows?: unknown[][]
    caption?: string
  }
}>()

const headers = computed<string[]>(() =>
  Array.isArray(props.data.headers) ? props.data.headers.map((h) => String(h ?? '')) : [],
)
const rows = computed<string[][]>(() => {
  const raw = Array.isArray(props.data.rows) ? props.data.rows : []
  return raw.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [String(row ?? '')],
  )
})
</script>

<template>
  <div class="table-card">
    <div v-if="data.title" class="table-card-title">{{ data.title }}</div>
    <div class="table-card-scroll">
      <table>
        <thead v-if="headers.length">
          <tr>
            <th v-for="(h, i) in headers" :key="i">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in rows" :key="ri">
            <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="data.caption" class="table-card-caption">{{ data.caption }}</div>
  </div>
</template>

<style scoped>
.table-card {
  margin: 0.25rem 0;
  padding: 0.75rem 0.85rem;
  border-radius: 0.75rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
  font-size: 0.85rem;
}
.table-card-title { font-weight: 700; margin-bottom: 0.55rem; font-size: 0.95rem; }
.table-card-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td {
  padding: 0.45rem 0.6rem; text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.12);
}
th { background: rgba(255, 255, 255, 0.08); font-weight: 700; font-size: 0.82rem; }
td { background: rgba(255, 255, 255, 0.03); }
.table-card-caption { margin-top: 0.5rem; font-size: 0.75rem; color: rgba(241, 245, 249, 0.65); font-style: italic; }
</style>
