<script setup lang="ts">
</script>

<template>
  <div class="flex gap-3 items-start animate-fade-in" aria-hidden="true">
    <div class="w-9 h-9 rounded-lg bg-white/2 shrink-0" />
    <div class="flex-1 space-y-2">
      <div
        :class="[
          'h-3 rounded-lg w-48%',
          'bg-gradient-to-r from-white/2 via-white/4.5 to-white/2',
          'bg-size-[200%_100%]',
        ]"
        style="animation: shimmer 1.4s infinite linear"
      />
      <div
        :class="[
          'h-3 rounded-lg w-28%',
          'bg-gradient-to-r from-white/2 via-white/4.5 to-white/2',
          'bg-size-[200%_100%]',
        ]"
        style="animation: shimmer 1.4s infinite linear"
      />
    </div>
  </div>
</template>
