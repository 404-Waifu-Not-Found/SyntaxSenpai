<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name?: string
  src?: string
  size?: number
}>(), {
  name: 'A',
  size: 40,
})

const initials = computed(() =>
  (props.name || 'A').trim().split(/\s+/).map(s => s[0] || '').slice(0, 2).join('').toUpperCase(),
)
</script>

<template>
  <div
    :class="[
      'relative flex items-center justify-center font-bold text-white',
      'bg-gradient-to-br from-primary-400 to-accent-500',
      'rounded-lg shadow-lg transition-transform duration-160',
    ]"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <img
      v-if="src"
      :src="src"
      :alt="name"
      class="w-full h-full object-cover rounded-lg"
    >
    <span v-else class="text-xs font-bold">{{ initials }}</span>
  </div>
</template>
