<script setup lang="ts">
</script>

<template>
  <div class="inline-flex gap-1 items-center" aria-hidden="true">
    <span
      v-for="i in 3"
      :key="i"
      :class="[
        'w-2.5 h-2.5 rounded-full bg-primary-400',
      ]"
      :style="{ animationDelay: `${(i - 1) * 0.12}s`, animation: 'typing 1s infinite ease-in-out' }"
    />
  </div>
</template>
