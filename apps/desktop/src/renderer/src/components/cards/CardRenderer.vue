<script setup lang="ts">
import { computed } from 'vue'
import WeatherCard from './WeatherCard.vue'
import TableCard from './TableCard.vue'
import LinkPreviewCard from './LinkPreviewCard.vue'
import CodeComparisonCard from './CodeComparisonCard.vue'

const props = defineProps<{
  type: string
  data: Record<string, unknown>
}>()

const component = computed(() => {
  switch (props.type) {
    case 'weather': return WeatherCard
    case 'table': return TableCard
    case 'link_preview': return LinkPreviewCard
    case 'code_comparison': return CodeComparisonCard
    default: return null
  }
})
</script>

<template>
  <component :is="component" v-if="component" :data="data" />
  <div v-else class="card-unknown">
    Unsupported card type: <code>{{ type }}</code>
  </div>
</template>

<style scoped>
.card-unknown {
  margin: 0.25rem 0;
  padding: 0.6rem 0.8rem;
  border-radius: 0.6rem;
  background: rgba(127, 29, 29, 0.22);
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #fecaca;
  font-size: 0.82rem;
}
</style>
