<template>
  <div class="l2d-model-browser p-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">Live2D Models</h2>
      <button
        @click="handleImport"
        :disabled="isLoading"
        class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {{ isLoading ? 'Loading...' : 'Import Model' }}
      </button>
    </div>

    <div v-if="error" class="mb-4 p-3 bg-red-100 text-red-700 border border-red-300 rounded-md">
      {{ error }}
    </div>

    <div class="grid gap-3">
      <div v-if="models.length === 0" class="text-center py-8 text-gray-500">
        <p>No models imported yet</p>
        <p class="text-sm">Click "Import Model" to add a Cubism model</p>
      </div>

      <div
        v-for="model in models"
        :key="model.id"
        @click="selectModel(model.id)"
        class="p-4 border rounded-md cursor-pointer transition"
        :class="[
          selectedModelId === model.id
            ? 'bg-blue-50 border-blue-500 shadow-sm'
            : 'bg-white border-gray-200 hover:border-gray-300'
        ]"
      >
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <h3 class="font-medium">{{ model.name }}</h3>
            <p class="text-xs text-gray-500 mt-1">{{ model.modelJsonPath }}</p>
            <p v-if="model.importedAt" class="text-xs text-gray-400 mt-1">
              Imported: {{ new Date(model.importedAt).toLocaleDateString() }}
            </p>
          </div>
          <button
            @click.stop="handleDelete(model.id)"
            :disabled="isLoading"
            class="ml-2 px-3 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200 disabled:opacity-50 transition"
          >
            Delete
          </button>
        </div>

        <div v-if="selectedModelId === model.id && model.metadata" class="mt-3 pt-3 border-t border-blue-200">
          <div class="text-xs text-gray-600 space-y-1">
            <p v-if="model.metadata.Version"
              ><strong>Version:</strong> {{ model.metadata.Version }}</p
            >
            <p v-if="model.metadata.Model"
              ><strong>Model:</strong> {{ model.metadata.Model }}</p
            >
          </div>
          <button
            @click.stop="handleLoadModel(model)"
            class="mt-2 px-3 py-1 text-xs bg-green-100 text-green-600 rounded hover:bg-green-200 transition"
          >
            Load Model
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue'
import { useL2dModels, type L2DModel } from '../composables/use-l2d-models'

const props = defineProps<{}>()
const emit = defineEmits<{
  modelSelected: [model: L2DModel]
  modelLoaded: [model: L2DModel]
}>()

const { models, selectedModelId, isLoading, error, importModel, deleteModel, selectModel } = useL2dModels()

const handleImport = async () => {
  const success = await importModel()
  if (success) {
    emit('modelSelected', models.value[models.value.length - 1])
  }
}

const handleDelete = async (modelId: string) => {
  if (confirm('Are you sure you want to delete this model?')) {
    await deleteModel(modelId)
  }
}

const handleLoadModel = (model: L2DModel) => {
  emit('modelLoaded', model)
}
</script>

<style scoped>
.l2d-model-browser {
  background: white;
  border-radius: 0.5rem;
}
</style>
