<script setup lang="ts">
import { computed, ref } from 'vue'
import { useIpc } from '../composables/use-ipc'
import { useI18n } from '../composables/use-i18n'
import { captureWarThunderRwrBaseline, stopWarThunderRwrCapture, type WarThunderRwrConfig as RwrConfig, type WarThunderRwrRegion as Region } from '../services/war-thunder-rwr-capture'
type WindowSource = { id: string; name: string; width: number; height: number; preview: string }

const props = defineProps<{ modelValue: RwrConfig }>()
const emit = defineEmits<{ 'update:modelValue': [value: RwrConfig] }>()
const { invoke } = useIpc()
const { t } = useI18n()
const sources = ref<WindowSource[]>([])
const loading = ref(false)
const calibrating = ref(false)
const selectingRegion = ref(false)
const error = ref('')
const previewFrame = ref<HTMLDivElement | null>(null)
const dragStart = ref<{ x: number; y: number } | null>(null)
const draftRegion = ref<Region | null>(null)
const selectedSource = computed(() => sources.value.find((source) => source.id === props.modelValue.sourceId) || null)
const visibleRegion = computed(() => draftRegion.value || props.modelValue.region)

function update(patch: Partial<RwrConfig>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

async function refreshWindows() {
  loading.value = true
  error.value = ''
  try {
    const result = await invoke('plugins:execTool', 'warthunder_copilot_rwr_sources', {})
    if (!result?.success) throw new Error(result?.error || 'Could not list War Thunder windows.')
    const data = result?.data || {}
    sources.value = Array.isArray(data.sources) ? data.sources : []
    if (!sources.value.length) {
      error.value = data.error || t('pet.rwrNoWindow')
      return
    }
    const current = sources.value.find((source) => source.id === props.modelValue.sourceId)
    if (!current && sources.value.length === 1) {
      update({ sourceId: sources.value[0].id, sourceName: sources.value[0].name, region: null, baselineSignalPixels: null })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

function selectWindow(sourceId: string) {
  const source = sources.value.find((item) => item.id === sourceId)
  update({ sourceId, sourceName: source?.name || '', region: null, baselineSignalPixels: null })
  selectingRegion.value = false
  dragStart.value = null
  draftRegion.value = null
  error.value = ''
}

function pointFromEvent(event: PointerEvent) {
  const bounds = previewFrame.value?.getBoundingClientRect()
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  }
}

function onPointerDown(event: PointerEvent) {
  if (!selectingRegion.value) return
  const point = pointFromEvent(event)
  if (!point) return
  dragStart.value = point
  draftRegion.value = { x: point.x, y: point.y, width: 0, height: 0 }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!selectingRegion.value || !dragStart.value) return
  const point = pointFromEvent(event)
  if (!point) return
  const x = Math.min(dragStart.value.x, point.x)
  const y = Math.min(dragStart.value.y, point.y)
  draftRegion.value = {
    x,
    y,
    width: Math.abs(point.x - dragStart.value.x),
    height: Math.abs(point.y - dragStart.value.y),
  }
}

function onPointerUp(event: PointerEvent) {
  if (!selectingRegion.value || !dragStart.value) return
  onPointerMove(event)
  const region = draftRegion.value
  if (region && region.width >= 0.02 && region.height >= 0.02) {
    update({ region, baselineSignalPixels: null })
    error.value = ''
  } else {
    error.value = t('pet.rwrCropTooSmall')
  }
  selectingRegion.value = false
  dragStart.value = null
  draftRegion.value = null
}

async function calibrateQuietBaseline() {
  if (!props.modelValue.sourceId || !props.modelValue.region) {
    error.value = t('pet.rwrNeedsCrop')
    return
  }
  calibrating.value = true
  error.value = ''
  stopWarThunderRwrCapture()
  update({ baselineSignalPixels: null })
  try {
    const sourceId = props.modelValue.sourceId
    const selectedRegion = props.modelValue.region
    const region = { ...selectedRegion }
    const baselineSignalPixels = await captureWarThunderRwrBaseline(sourceId, region)
    if (props.modelValue.sourceId !== sourceId || props.modelValue.region !== selectedRegion) return
    const result = await invoke('plugins:execTool', 'warthunder_copilot_rwr_calibrate', {
      sourceId,
      region,
      baselineSignalPixels,
    })
    if (!result?.success) throw new Error(result?.error || 'Could not save the RWR baseline.')
    const data = result?.data || {}
    if (data.error) throw new Error(String(data.error))
    if (props.modelValue.sourceId !== sourceId || props.modelValue.region !== selectedRegion) return
    update({ baselineSignalPixels: Number(data.baselineSignalPixels) })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    calibrating.value = false
  }
}

function regionStyle(region: Region) {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  }
}
</script>

<template>
  <section class="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-xs font-semibold text-neutral-200">{{ t('pet.rwrMonitor') }}</div>
        <p class="mt-1 text-[11px] leading-relaxed text-neutral-400">{{ t('pet.rwrDescription') }}</p>
      </div>
      <label class="flex shrink-0 items-center gap-2 text-[11px] text-neutral-300">
        <input
          type="checkbox"
          :checked="modelValue.enabled"
          class="accent-amber-400"
          @change="update({ enabled: ($event.target as HTMLInputElement).checked })"
        >
        {{ t('pet.rwrEnable') }}
      </label>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" class="rounded-lg bg-white/10 px-3 py-2 text-[11px] text-neutral-200 hover:bg-white/15 disabled:opacity-50" :disabled="loading" @click="refreshWindows">
        {{ loading ? t('pet.rwrLoading') : t('pet.rwrRefreshWindows') }}
      </button>
      <select
        class="min-w-0 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-2 py-2 text-[11px] text-neutral-200"
        :value="modelValue.sourceId"
        :disabled="!sources.length"
        :aria-label="t('pet.rwrWindow')"
        @change="selectWindow(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('pet.rwrChooseWindow') }}</option>
        <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
      </select>
    </div>

    <label class="mt-3 flex items-center gap-3 text-[11px] text-neutral-300">
      <span>{{ t('pet.rwrThreshold') }}</span>
      <input
        type="number"
        min="1"
        max="16384"
        class="w-20 rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-neutral-200"
        :value="modelValue.thresholdDelta"
        @change="update({ thresholdDelta: Math.min(16384, Math.max(1, Number(($event.target as HTMLInputElement).value) || 8)) })"
      >
    </label>
    <p class="mt-1 text-[10px] text-neutral-500">{{ t('pet.rwrThresholdHint') }}</p>

    <div v-if="selectedSource" class="mt-3">
      <div
        ref="previewFrame"
        class="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg bg-black"
        :class="selectingRegion ? 'cursor-crosshair touch-none' : ''"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <img :src="selectedSource.preview" class="block max-h-72 max-w-full" :alt="t('pet.rwrWindowPreview')" draggable="false">
        <div v-if="visibleRegion" class="pointer-events-none absolute border-2 border-amber-300 bg-amber-300/15" :style="regionStyle(visibleRegion)" />
        <div v-if="selectingRegion" class="pointer-events-none absolute inset-0 grid place-items-center bg-black/20 text-xs font-medium text-white">
          {{ t('pet.rwrDragCrop') }}
        </div>
      </div>
      <div class="mt-2 flex flex-wrap gap-2">
        <button type="button" class="rounded-lg bg-white/10 px-3 py-2 text-[11px] text-neutral-200 hover:bg-white/15" @click="selectingRegion = !selectingRegion; draftRegion = null; dragStart = null">
          {{ selectingRegion ? t('pet.rwrCancelCrop') : t('pet.rwrSelectCrop') }}
        </button>
        <button type="button" class="rounded-lg bg-amber-400/15 px-3 py-2 text-[11px] text-amber-200 hover:bg-amber-400/25 disabled:opacity-50" :disabled="calibrating || !modelValue.region" @click="calibrateQuietBaseline">
          {{ calibrating ? t('pet.rwrCalibrating') : t('pet.rwrCalibrate') }}
        </button>
      </div>
    </div>

    <p class="mt-2 text-[10px] leading-relaxed text-neutral-500">
      {{ modelValue.baselineSignalPixels === null ? t('pet.rwrCalibrationHint') : t('pet.rwrCalibrated') }}
    </p>
    <p v-if="error" class="mt-2 text-[11px] text-amber-200" role="status">{{ error }}</p>
  </section>
</template>
