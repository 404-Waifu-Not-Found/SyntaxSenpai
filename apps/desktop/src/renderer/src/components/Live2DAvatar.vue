<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

// pixi.js and pixi-live2d-display are loaded lazily so a missing Cubism
// Core does not crash the whole renderer.
type PixiApp = import('pixi.js').Application
type Live2DModelType = any // pixi-live2d-display types vary by cubism version

const props = withDefaults(defineProps<{
  /** Absolute file:// path (or URL) to the .model3.json / .model.json */
  modelPath: string
  /** WaifuExpression name; component maps it to a motion group */
  expression?: string
  width?: number
  height?: number
  /** Motion group name overrides keyed by expression. Falls back to built-in map. */
  motionMap?: Record<string, string>
}>(), {
  expression: 'neutral',
  width: 300,
  height: 400,
})

const emit = defineEmits<{
  (e: 'error', message: string): void
  (e: 'ready'): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const error = ref('')

let pixiApp: PixiApp | null = null
let live2dModel: Live2DModelType | null = null

// Default expression to Live2D motion group name map.
// Users can override per-model via the expressionMotions field in Live2DModelRef.
const DEFAULT_MOTION_MAP: Record<string, string> = {
  neutral:     'Idle',
  happy:       'TapBody',
  excited:     'TapBody',
  thinking:    'FlickHead',
  confused:    'FlickHead',
  embarrassed: 'TapBody',
  determined:  'TapBody',
  sad:         'FlickHead',
}

function resolveMotion(expression: string): string {
  const overrides = props.motionMap ?? {}
  return overrides[expression] ?? DEFAULT_MOTION_MAP[expression] ?? 'Idle'
}

async function loadCubismCore(modelUrl: string): Promise<boolean> {
  // Check if already loaded from a previous model
  if ((window as any).Live2DCubismCore) return true

  // Derive core path: replace the model JSON filename with the core JS.
  // Both file:// and userdata:// paths are supported.
  const coreUrl = modelUrl.replace(/\/[^/]+$/, '/live2dcubismcore.min.js')
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = coreUrl
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
  })
}

async function initModel() {
  if (!canvasRef.value) return

  // Tear down any previous instance
  await destroyModel()

  error.value = ''

  try {
    // Dynamic imports so a missing package doesn't crash unrelated code
    const PIXI = await import('pixi.js')
    const { Live2DModel } = await import('pixi-live2d-display')

    // Register the PIXI ticker so Live2D updates run
    Live2DModel.registerTicker(PIXI.Ticker)

    // Derive the model directory from the path so we can look for the core
    const modelUrl = props.modelPath
    const isCubism4 = modelUrl.includes('.model3.json')

    if (isCubism4) {
      const coreLoaded = await loadCubismCore(modelUrl)
      if (!coreLoaded) {
        error.value = 'Cubism 4 Core not found. Place live2dcubismcore.min.js in your model folder.'
        emit('error', error.value)
        return
      }
    }

    pixiApp = new PIXI.Application({
      view: canvasRef.value,
      width: props.width,
      height: props.height,
      backgroundAlpha: 0,
      antialias: true,
    })

    live2dModel = await Live2DModel.from(modelUrl, { autoInteract: false })

    // Scale to fit the canvas
    const scaleX = props.width / live2dModel.width
    const scaleY = props.height / live2dModel.height
    const scale = Math.min(scaleX, scaleY)
    live2dModel.scale.set(scale)
    live2dModel.x = (props.width - live2dModel.width * scale) / 2
    live2dModel.y = 0

    pixiApp.stage.addChild(live2dModel)

    // Play the appropriate motion for the initial expression
    playMotion(props.expression)
    emit('ready')
  } catch (err: any) {
    error.value = err?.message || String(err)
    emit('error', error.value)
  }
}

function playMotion(expression: string) {
  if (!live2dModel) return
  const group = resolveMotion(expression)
  try {
    live2dModel.motion(group)
  } catch {
    // Model may not have the motion group; silently ignore.
  }
}

async function destroyModel() {
  if (live2dModel) {
    try { live2dModel.destroy() } catch { /* ignore */ }
    live2dModel = null
  }
  if (pixiApp) {
    try { pixiApp.destroy(false) } catch { /* ignore */ }
    pixiApp = null
  }
}

watch(() => props.modelPath, () => { void initModel() })
watch(() => props.expression, (expr) => { playMotion(expr) })
watch(() => [props.width, props.height], () => { void initModel() })

onMounted(() => { void initModel() })
onBeforeUnmount(() => { void destroyModel() })
</script>

<template>
  <div
    class="relative overflow-hidden"
    :style="{ width: `${width}px`, height: `${height}px` }"
  >
    <canvas ref="canvasRef" :width="width" :height="height" />
    <div
      v-if="error"
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 rounded-lg p-3 text-center"
    >
      <span class="text-2xl">!</span>
      <p class="text-xs text-red-400 leading-snug max-w-[220px]">{{ error }}</p>
    </div>
  </div>
</template>
