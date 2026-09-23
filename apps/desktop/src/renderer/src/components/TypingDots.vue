<template>
  <span class="typing-dots" aria-hidden="true">
    <span v-for="index in 3" :key="index" class="typing-dot" :style="{ animationDelay: `${(index - 1) * 160}ms` }" />
  </span>
</template>

<style scoped>
.typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 12px;
}
.typing-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-primary-400, #34d399);
  animation: typing-bounce 1.15s ease-in-out infinite;
}
@keyframes typing-bounce {
  0%, 60%, 100% { opacity: 0.4; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-4px); }
}
@media (prefers-reduced-motion: reduce) {
  .typing-dot { animation: none; opacity: 0.8; }
}
</style>
