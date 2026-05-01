<template>
  <div class="l2d-panel space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Live2D Cubism Models</h1>
      <p class="text-gray-600 dark:text-gray-400">Import and manage Live2D Cubism models for your avatar</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Model Browser -->
      <div class="lg:col-span-1">
        <div class="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
          <L2dModelBrowser @modelSelected="handleModelSelected" @modelLoaded="handleModelLoaded" />
        </div>
      </div>

      <!-- Model Viewer -->
      <div class="lg:col-span-2">
        <div class="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
          <L2dViewer :model="selectedModel" />
        </div>
      </div>
    </div>

    <!-- Model Info Section -->
    <div v-if="selectedModel" class="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Model Details</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p class="text-gray-600 dark:text-gray-400">Name</p>
          <p class="font-medium text-gray-900 dark:text-white">{{ selectedModel.name }}</p>
        </div>
        <div>
          <p class="text-gray-600 dark:text-gray-400">Status</p>
          <p class="font-medium text-green-600">Imported</p>
        </div>
        <div v-if="selectedModel.importedAt">
          <p class="text-gray-600 dark:text-gray-400">Import Date</p>
          <p class="font-medium text-gray-900 dark:text-white">{{ formatDate(selectedModel.importedAt) }}</p>
        </div>
        <div>
          <p class="text-gray-600 dark:text-gray-400">Path</p>
          <p class="font-medium text-gray-900 dark:text-white truncate" :title="selectedModel.path">
            {{ truncatePath(selectedModel.path) }}
          </p>
        </div>
      </div>

      <div v-if="selectedModel.metadata" class="mt-6 pt-6 border-t border-gray-200 dark:border-slate-700">
        <h4 class="font-semibold text-gray-900 dark:text-white mb-3">Metadata</h4>
        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div v-for="(value, key) in selectedModel.metadata" :key="key">
            <dt class="text-gray-600 dark:text-gray-400">{{ key }}</dt>
            <dd class="font-medium text-gray-900 dark:text-white mt-1">{{ JSON.stringify(value) }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- Help Section -->
    <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
      <h4 class="font-semibold text-blue-900 dark:text-blue-300 mb-2">How to Import a Model</h4>
      <ol class="list-decimal list-inside space-y-2 text-sm text-blue-800 dark:text-blue-200">
        <li>Click the "Import Model" button in the models list</li>
        <li>Select a folder containing your Cubism model files (.model3.json and .moc3)</li>
        <li>The model will be copied to your app's local library</li>
        <li>Click "Load Model" to preview the model and see its details</li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import L2dModelBrowser from './L2dModelBrowser.vue'
import L2dViewer from './L2dViewer.vue'
import type { L2DModel } from '../composables/use-l2d-models'

const selectedModel = ref<L2DModel | null>(null)

const handleModelSelected = (model: L2DModel) => {
  selectedModel.value = model
}

const handleModelLoaded = (model: L2DModel) => {
  selectedModel.value = model
}

const formatDate = (isoString: string) => {
  try {
    return new Date(isoString).toLocaleDateString()
  } catch {
    return isoString
  }
}

const truncatePath = (path: string) => {
  const parts = path.split('\\').concat(path.split('/'))
  return parts[parts.length - 1]
}
</script>

<style scoped>
.l2d-panel {
  padding: 1rem;
}
</style>
