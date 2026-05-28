<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'

const Live2DAvatar = defineAsyncComponent(() => import('./Live2DAvatar.vue'))

const props = withDefaults(defineProps<{
  name?: string
  src?: string
  size?: number
  /** Absolute path to a .model3.json / .model.json — activates Live2D rendering */
  live2dPath?: string
  /** WaifuExpression name forwarded to Live2DAvatar */
  expression?: string
  /** Per-model motion overrides forwarded to Live2DAvatar */
  motionMap?: Record<string, string>
}>(), {
  name: 'A',
  size: 40,
  expression: 'neutral',
})

const initials = computed(() =>
  (props.name || 'A').trim().split(/\s+/).map(s => s[0] || '').slice(0, 2).join('').toUpperCase(),
)
</script>

<template>
  <!-- Live2D mode: delegate to the full renderer -->
  <Live2DAvatar
    v-if="live2dPath"
    :model-path="live2dPath"
    :expression="expression"
    :width="size"
    :height="size"
    :motion-map="motionMap"
    class="rounded-lg shadow-lg overflow-hidden"
  />

  <!-- Static image / initials fallback -->
  <div
    v-else
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
