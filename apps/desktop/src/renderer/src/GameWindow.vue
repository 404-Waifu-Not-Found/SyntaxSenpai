<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from 'vue'
import type { GameSnapshot } from '@syntax-senpai/game-engine'
import MiniGamePanel from './components/MiniGamePanel.vue'

const snapshot = shallowRef<GameSnapshot | null>(null)

function getIpc() {
  return (window as any).electron?.ipcRenderer
}

function handleSession(nextSnapshot: GameSnapshot | null) {
  snapshot.value = nextSnapshot
}

function handleMove(move: string) {
  getIpc()?.send('game:move', move)
}

function closeWindow() {
  void getIpc()?.invoke('game:closeWindow')
}

let removeSessionListener: (() => void) | undefined

onMounted(() => {
  removeSessionListener = getIpc()?.on('game:session', handleSession)
})

onUnmounted(() => {
  removeSessionListener?.()
})
</script>

<template>
  <main class="min-h-[100dvh] bg-[#071511] text-white">
    <div v-if="!snapshot" class="flex min-h-[100dvh] items-center justify-center text-sm text-slate-400">
      Preparing game board…
    </div>
    <MiniGamePanel
      v-else
      :snapshot="snapshot"
      :window-mode="true"
      @move="handleMove"
      @close="closeWindow"
    />
  </main>
</template>
