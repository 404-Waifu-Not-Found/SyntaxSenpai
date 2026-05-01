import { ref, computed, onMounted } from 'vue'

export interface L2DModel {
  id: string
  name: string
  path: string
  modelJsonPath: string
  metadata?: Record<string, any>
  importedAt?: string
}

interface L2DAPI {
  importModel(): Promise<{ success: boolean; model?: L2DModel; error?: string; canceled?: boolean }>
  listModels(): Promise<{ success: boolean; models?: L2DModel[]; error?: string }>
  deleteModel(modelId: string): Promise<{ success: boolean; error?: string }>
  getModel(modelId: string): Promise<{ success: boolean; model?: L2DModel; error?: string }>
}

const getL2dAPI = (): L2DAPI => {
  return (window as any).l2d as L2DAPI
}

export const useL2dModels = () => {
  const models = ref<L2DModel[]>([])
  const selectedModelId = ref<string | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const selectedModel = computed(() => {
    if (!selectedModelId.value) return null
    return models.value.find((m: L2DModel) => m.id === selectedModelId.value) || null
  })

  const loadModels = async () => {
    isLoading.value = true
    error.value = null
    try {
      const result = await getL2dAPI().listModels()
      if (result.success && result.models) {
        models.value = result.models as L2DModel[]
      } else {
        error.value = result.error || 'Failed to load models'
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
    } finally {
      isLoading.value = false
    }
  }

  const importModel = async () => {
    isLoading.value = true
    error.value = null
    try {
      const result = await getL2dAPI().importModel()
      if (result.canceled) {
        return false
      }
      if (result.success && result.model) {
        models.value.push(result.model as L2DModel)
        selectedModelId.value = result.model.id
        return true
      } else {
        error.value = result.error || 'Failed to import model'
        return false
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      return false
    } finally {
      isLoading.value = false
    }
  }

  const deleteModel = async (modelId: string) => {
    isLoading.value = true
    error.value = null
    try {
      const result = await getL2dAPI().deleteModel(modelId)
      if (result.success) {
        models.value = models.value.filter((m: L2DModel) => m.id !== modelId)
        if (selectedModelId.value === modelId) {
          selectedModelId.value = null
        }
        return true
      } else {
        error.value = result.error || 'Failed to delete model'
        return false
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      return false
    } finally {
      isLoading.value = false
    }
  }

  const selectModel = (modelId: string) => {
    selectedModelId.value = modelId
  }

  onMounted(() => {
    loadModels()
  })

  return {
    models,
    selectedModelId,
    selectedModel,
    isLoading,
    error,
    loadModels,
    importModel,
    deleteModel,
    selectModel,
  }
}