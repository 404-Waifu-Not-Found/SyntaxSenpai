<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ count?: number }>()

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

const petals = computed(() => {
  const n = props.count ?? 24
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: `${rand(-2, 102)}%`,
    size: `${Math.round(rand(9, 20))}px`,
    drift: `${Math.round(rand(-140, 140))}px`,
    duration: `${rand(11, 22).toFixed(1)}s`,
    delay: `${rand(-20, 0).toFixed(1)}s`,
  }))
})
</script>

<template>
  <div class="sakura-layer" aria-hidden="true">
    <div
      v-for="petal in petals"
      :key="petal.id"
      class="sakura-petal"
      :style="{
        '--sakura-x': petal.x,
        '--sakura-size': petal.size,
        '--sakura-drift': petal.drift,
        '--sakura-duration': petal.duration,
        '--sakura-delay': petal.delay,
      }"
    />
  </div>
</template>
