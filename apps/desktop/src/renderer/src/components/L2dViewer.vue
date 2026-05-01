<template>
  <div class="l2d-viewer p-4 bg-gradient-to-b from-slate-900 to-slate-800 rounded-md">
    <div class="h-96 flex items-center justify-center border-2 border-dashed border-slate-600 rounded-md bg-slate-700/50">
      <div class="text-center">
        <p v-if="!selectedModel" class="text-gray-400">No model selected</p>
        <div v-else>
          <p class="text-gray-300 font-medium">{{ selectedModel.name }}</p>
          <p class="text-gray-400 text-sm mt-2">Model path:</p>
          <p class="text-gray-500 text-xs font-mono break-all">{{ selectedModel.modelJsonPath }}</p>
          <p v-if="isLoading" class="text-blue-400 text-sm mt-4">Initializing Cubism...</p>
          <p v-else-if="modelInfo" class="text-green-400 text-sm mt-4">Model loaded successfully</p>
          <p v-else-if="cubismAvailable" class="text-yellow-400 text-sm mt-4">Ready to load model</p>
          <p v-else class="text-orange-400 text-sm mt-4">Cubism SDK not available</p>

          <div v-if="modelInfo" class="mt-4 grid grid-cols-2 gap-3 text-left text-xs text-gray-400">
            <div>
              <strong>Textures:</strong> {{ modelInfo.textures?.length || 0 }}
            </div>
            <div>
              <strong>Motions:</strong> {{ modelInfo.motions?.length || 0 }}
            </div>
            <div>
              <strong>Expressions:</strong> {{ modelInfo.expressions?.length || 0 }}
            </div>
            <div v-if="cubismVersion">
              <strong>Cubism:</strong> {{ cubismVersion }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps, ref, watch, computed, onMounted } from 'vue'
import type { L2DModel } from '../composables/use-l2d-models'

const props = defineProps<{
  model: L2DModel | null
}>()

const isLoading = ref(false)
const modelInfo = ref<Window['CubismModelInfo'] | null>(null)
const cubismAvailable = ref(false)
const cubismVersion = ref<string | null>(null)

const selectedModel = computed(() => props.model)

onMounted(() => {
  if (window.cubism) {
    cubismAvailable.value = window.cubism.isAvailable()
    if (cubismAvailable.value) {
      const version = window.cubism.getVersion()
      cubismVersion.value = version
    }
  }
})

watch(
  () => props.model,
  async (newModel) => {
    modelInfo.value = null
    if (!newModel) return

    isLoading.value = true
    try {
      if (window.cubism && cubismAvailable.value) {
        const info = window.cubism.loadModelInfo(newModel.modelJsonPath)
        modelInfo.value = info
      }
    } catch (err) {
      console.error('Failed to load model info:', err)
    } finally {
      isLoading.value = false
    }
  }
)
</script>

<style scoped>
.l2d-viewer {
  background-image: linear-gradient(to bottom, rgb(15, 23, 42), rgb(30, 41, 59));
}
</style>
