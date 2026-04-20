<script setup lang="ts">
import { ref, onUnmounted, watch } from 'vue'
import { useIpc } from '../composables/use-ipc'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { invoke } = useIpc()

const qrDataUrl = ref<string | null>(null)
const wsUrl = ref<string | null>(null)
const paired = ref(false)
const deviceName = ref('')
const loading = ref(true)
const error = ref<string | null>(null)
const availableIps = ref<Array<{ name: string; address: string }>>([])
const selectedIp = ref<string | null>(null)

let pollInterval: ReturnType<typeof setInterval> | null = null

async function loadQrForIp(ip: string) {
  try {
    const result = await invoke('ws:generateQrForIp', ip)
    if (result?.success && result.data?.qrDataUrl) {
      qrDataUrl.value = result.data.qrDataUrl
      wsUrl.value = result.data.wsUrl
      selectedIp.value = ip
      error.value = null
    } else {
      error.value = result?.error || 'Could not generate QR code for the selected IP.'
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error'
  }
}

async function initPairing() {
  loading.value = true
  paired.value = false
  error.value = null
  try {
    const result = await invoke('ws:getQrData')
    if (result?.success && result.data?.qrDataUrl) {
      qrDataUrl.value = result.data.qrDataUrl
      wsUrl.value = result.data.wsUrl
      availableIps.value = result.data.availableIps ?? []
      selectedIp.value = availableIps.value[0]?.address ?? null
    } else {
      error.value = 'Could not generate QR code. Make sure the desktop app is running.'
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error'
  } finally {
    loading.value = false
  }

  if (pollInterval) clearInterval(pollInterval)
  pollInterval = setInterval(async () => {
    try {
      const status = await invoke('ws:getPairingStatus')
      if (status?.paired) {
        paired.value = true
        deviceName.value = status.deviceName || 'Mobile Device'
        if (pollInterval) clearInterval(pollInterval)
      }
    } catch {
      // ignore poll errors
    }
  }, 2000)
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      initPairing()
    } else if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-backdrop">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-[60]"
        @click.self="emit('close')"
      >
          <div
            class="modal-glass rounded-t-3xl sm:rounded-2xl p-6 max-w-sm w-full mx-0 sm:mx-4 text-center"
          >
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-bold text-white">Connect Mobile</h2>
              <button class="text-neutral-400 hover:text-white transition-colors" @click="emit('close')">
                <span class="text-xl leading-none">×</span>
              </button>
            </div>

            <!-- Loading -->
            <div v-if="loading" class="py-12 flex flex-col items-center gap-3">
              <div class="w-8 h-8 border-2 border-primary-500/40 border-t-primary-500 rounded-full animate-spin" />
              <p class="text-sm text-neutral-400">Generating QR code...</p>
            </div>

            <!-- Error -->
            <div v-else-if="error" class="py-8">
              <p class="text-sm text-red-400">{{ error }}</p>
            </div>

            <!-- Paired -->
            <div v-else-if="paired" class="py-8 flex flex-col items-center gap-4">
              <div class="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg class="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p class="text-white font-semibold">Connected!</p>
                <p class="text-sm text-neutral-400 mt-1">{{ deviceName }}</p>
              </div>
              <button class="btn-primary w-full" @click="emit('close')">Done</button>
            </div>

            <!-- QR Code -->
            <div v-else>
              <p class="text-sm text-neutral-400 mb-4">
                Open SyntaxSenpai on your phone and scan this code to connect.
              </p>

              <div class="flex justify-center mb-4">
                <div class="bg-white rounded-xl p-3 inline-block">
                  <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR Code" class="w-48 h-48" />
                </div>
              </div>

              <div class="flex items-center gap-2 justify-center mb-5">
                <div class="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <p class="text-xs text-neutral-400">Waiting for device...</p>
              </div>

              <p v-if="wsUrl" class="text-[10px] font-mono text-neutral-600 break-all">{{ wsUrl }}</p>

              <!-- IP selector -->
              <div v-if="availableIps.length > 1" class="mt-4 text-left">
                <p class="text-[10px] text-neutral-500 mb-1">Network interface</p>
                <div class="flex flex-col gap-1">
                  <button
                    v-for="ip in availableIps"
                    :key="ip.address"
                    class="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-colors"
                    :class="selectedIp === ip.address
                      ? 'bg-primary-500/20 text-primary-300 ring-1 ring-primary-500/40'
                      : 'bg-white/5 text-neutral-400 hover:bg-white/10'"
                    @click="loadQrForIp(ip.address)"
                  >
                    <span class="font-mono">{{ ip.address }}</span>
                    <span class="text-neutral-600 ml-2 truncate max-w-[100px]">{{ ip.name }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
      </div>
    </Transition>
  </Teleport>
</template>
