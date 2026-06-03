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
  /** Bump to force reapplying an unchanged expression value. */
  expressionRevision?: number
  width?: number
  height?: number
  modelScale?: number
  offsetX?: number
  offsetY?: number
  trackCursor?: boolean
  /** Motion group name overrides keyed by expression. Falls back to built-in map. */
  motionMap?: Record<string, string>
  /**
   * Pixel-density multiplier for the PIXI renderer. 1 = CSS pixels (blurry on
   * HiDPI screens), 2 = supersample at 2x, etc. Higher values trade GPU cost
   * for a sharper Live2D model.
   */
  renderScale?: number
}>(), {
  expression: 'neutral',
  expressionRevision: 0,
  width: 300,
  height: 400,
  modelScale: 1,
  offsetX: 0,
  offsetY: 0,
  trackCursor: true,
  renderScale: 1,
})

const MIN_RENDER_SCALE = 0.5
const MAX_RENDER_SCALE = 4

function clampRenderScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.min(Math.max(value, MIN_RENDER_SCALE), MAX_RENDER_SCALE)
}

const emit = defineEmits<{
  (e: 'error', message: string): void
  (e: 'ready'): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const error = ref('')

let pixiApp: PixiApp | null = null
let live2dModel: Live2DModelType | null = null
let latestPointer = { clientX: 0, clientY: 0 }
let cursorFrame = 0

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

// Expression name → Cubism named-expression ID map.
// Many Live2D models ship predefined expressions like "Happy", "Sad", etc.
// We try these IDs first before falling back to raw parameter blending.
const EXPRESSION_NAME_MAP: Record<string, string[]> = {
  happy:       ['Happy', 'Smile', 'Joy', 'fun'],
  excited:     ['Excited', 'Surprised', 'Energetic', 'fun'],
  thinking:    ['Thinking', 'Ponder', 'Worry', 'angry'],
  confused:    ['Confused', 'Puzzle', 'Question', 'angry'],
  embarrassed: ['Embarrassed', 'Shy', 'Blush', 'sad'],
  determined:  ['Determined', 'Serious', 'Confident', 'angry', 'fun'],
  sad:         ['Sad', 'Cry', 'Sorrow', 'sad'],
  neutral:     ['Neutral', 'Default', 'Idle', 'base'],
}

type ParamDef = { id: string[]; value: number }

// Per-expression Cubism parameter overrides for models that have no named
// expressions (or when named expressions aren't found). Each parameter is
// an array of candidate IDs (Cubism 2 vs 4 conventions) and a target value.
const EXPRESSION_PARAMS: Record<string, ParamDef[]> = {
  happy: [
    { id: ['ParamMouthForm', 'PARAM_MOUTH_FORM'], value: 0.85 },
    { id: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], value: 0.1 },
    { id: ['ParamBrowLY', 'PARAM_BROW_L_Y'], value: -0.3 },
    { id: ['ParamBrowRY', 'PARAM_BROW_R_Y'], value: -0.3 },
    { id: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], value: 0.4 },
    { id: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], value: 0.4 },
    { id: ['ParamCheek', 'PARAM_CHEEK'], value: 0.3 },
  ],
  excited: [
    { id: ['ParamMouthForm', 'PARAM_MOUTH_FORM'], value: 1.0 },
    { id: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], value: 0.5 },
    { id: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], value: 0.9 },
    { id: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], value: 0.9 },
    { id: ['ParamBrowLY', 'PARAM_BROW_L_Y'], value: -0.5 },
    { id: ['ParamBrowRY', 'PARAM_BROW_R_Y'], value: -0.5 },
    { id: ['ParamCheek', 'PARAM_CHEEK'], value: 0.4 },
  ],
  thinking: [
    { id: ['ParamMouthForm', 'PARAM_MOUTH_FORM'], value: -0.2 },
    { id: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], value: 0.05 },
    { id: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], value: 0.5 },
    { id: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], value: 0.5 },
    { id: ['ParamBrowLY', 'PARAM_BROW_L_Y'], value: 0.3 },
    { id: ['ParamBrowRY', 'PARAM_BROW_R_Y'], value: 0.3 },
    { id: ['ParamBrowLAngle', 'PARAM_BROW_L_ANGLE'], value: 0.2 },
    { id: ['ParamBrowRAngle', 'PARAM_BROW_R_ANGLE'], value: -0.2 },
  ],
  confused: [
    { id: ['ParamMouthForm', 'PARAM_MOUTH_FORM'], value: -0.3 },
    { id: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], value: 0.2 },
    { id: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], value: 0.5 },
    { id: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], value: 0.8 },
    { id: ['ParamBrowLY', 'PARAM_BROW_L_Y'], value: 0.4 },
    { id: ['ParamBrowRY', 'PARAM_BROW_R_Y'], value: 0.4 },
    { id: ['ParamAngleX', 'PARAM_ANGLE_X'], value: 5 },
  ],
  embarrassed: [
    { id: ['ParamMouthForm', 'PARAM_MOUTH_FORM'], value: 0.4 },
    { id: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], value: 0.0 },
    { id: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], value: 0.7 },
    { id: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], value: 0.7 },
    { id: ['ParamBrowLY', 'PARAM_BROW_L_Y'], value: 0.1 },
    { id: ['ParamBrowRY', 'PARAM_BROW_R_Y'], value: 0.1 },
    { id: ['ParamCheek', 'PARAM_CHEEK'], value: 0.65 },
  ],
  determined: [
    { id: ['ParamMouthForm', 'PARAM_MOUTH_FORM'], value: 0.5 },
    { id: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], value: 0.0 },
    { id: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], value: 0.6 },
    { id: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], value: 0.6 },
    { id: ['ParamBrowLY', 'PARAM_BROW_L_Y'], value: 0.4 },
    { id: ['ParamBrowRY', 'PARAM_BROW_R_Y'], value: 0.4 },
    { id: ['ParamBrowLAngle', 'PARAM_BROW_L_ANGLE'], value: -0.3 },
    { id: ['ParamBrowRAngle', 'PARAM_BROW_R_ANGLE'], value: 0.3 },
  ],
  sad: [
    { id: ['ParamMouthForm', 'PARAM_MOUTH_FORM'], value: -0.8 },
    { id: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], value: 0.05 },
    { id: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], value: 0.3 },
    { id: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], value: 0.3 },
    { id: ['ParamBrowLY', 'PARAM_BROW_L_Y'], value: 0.15 },
    { id: ['ParamBrowRY', 'PARAM_BROW_R_Y'], value: 0.15 },
    { id: ['ParamBrowLAngle', 'PARAM_BROW_L_ANGLE'], value: 0.3 },
    { id: ['ParamBrowRAngle', 'PARAM_BROW_R_ANGLE'], value: -0.3 },
  ],
  neutral: [
    { id: ['ParamMouthForm', 'PARAM_MOUTH_FORM'], value: 0.0 },
    { id: ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], value: 0.0 },
    { id: ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], value: 0.7 },
    { id: ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], value: 0.7 },
    { id: ['ParamBrowLY', 'PARAM_BROW_L_Y'], value: 0.0 },
    { id: ['ParamBrowRY', 'PARAM_BROW_R_Y'], value: 0.0 },
    { id: ['ParamBrowLAngle', 'PARAM_BROW_L_ANGLE'], value: 0.0 },
    { id: ['ParamBrowRAngle', 'PARAM_BROW_R_ANGLE'], value: 0.0 },
    { id: ['ParamCheek', 'PARAM_CHEEK'], value: 0.0 },
  ],
}

function resolveMotion(expression: string): string {
  const overrides = props.motionMap ?? {}
  return overrides[expression] ?? DEFAULT_MOTION_MAP[expression] ?? 'Idle'
}

function tryLoadCoreScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve(true)
    script.onerror = () => {
      // Remove the failed tag so we don't accumulate broken scripts when
      // we try multiple sources.
      script.remove()
      resolve(false)
    }
    document.head.appendChild(script)
  })
}

async function loadCubismCore(modelUrl: string): Promise<boolean> {
  // Check if already loaded from a previous model
  if ((window as any).Live2DCubismCore) return true

  // Try the model folder's own copy first (auto-installed during import for
  // every model), then the shared <userData>/live2d-sdk fallback the desktop
  // main process maintains via waifus:installCubismCore. Either path is
  // served via the userdata:// protocol, so file:// CORS isn't a concern.
  const candidates = [
    modelUrl.replace(/\/[^/]+$/, '/live2dcubismcore.min.js'),
    'userdata://live2d-sdk/live2dcubismcore.min.js',
  ]
  for (const url of candidates) {
    if ((window as any).Live2DCubismCore) return true
    if (await tryLoadCoreScript(url)) return true
  }
  return false
}

async function loadCubism2Runtime(modelUrl: string): Promise<boolean> {
  // Cubism 2 exposes `window.Live2D` (capital L). pixi-live2d-display
  // probes this global at module-load time, so the script must be in the
  // DOM before the cubism2 submodule is imported.
  if ((window as any).Live2D) return true
  const candidates = [
    modelUrl.replace(/\/[^/]+$/, '/live2d.min.js'),
    'userdata://live2d-sdk/live2d.min.js',
  ]
  for (const url of candidates) {
    if ((window as any).Live2D) return true
    if (await tryLoadCoreScript(url)) return true
  }
  return false
}

async function initModel() {
  if (!canvasRef.value) return

  // Tear down any previous instance
  await destroyModel()

  error.value = ''

  try {
    // Dynamic imports so a missing package doesn't crash unrelated code.
    // We deliberately import the version-specific submodule of
    // pixi-live2d-display — the combined "index" build registers BOTH the
    // Cubism 2 and Cubism 4 factories, and the Cubism 2 factory then
    // demands the live2d.min.js runtime even when we're loading a Cubism 4
    // model. By picking the submodule that matches the model we sidestep
    // the Cubism 2 dependency entirely.
    const PIXI = await import('pixi.js')
    const modelUrl = props.modelPath
    const isCubism4 = modelUrl.includes('.model3.json')

    // Load the runtime that this model needs BEFORE importing the
    // pixi-live2d-display submodule — the submodule's module-level
    // initialization probes for the runtime as it loads.
    if (isCubism4) {
      const coreLoaded = await loadCubismCore(modelUrl)
      if (!coreLoaded) {
        error.value = 'Cubism 4 Core not found. Open Settings → Live2D and click "Install Cubism Core SDK".'
        emit('error', error.value)
        return
      }
    } else {
      const legacyLoaded = await loadCubism2Runtime(modelUrl)
      if (!legacyLoaded) {
        error.value = 'Cubism 2 runtime not found. Place live2d.min.js next to your model.json.'
        emit('error', error.value)
        return
      }
    }

    const live2dModule: any = isCubism4
      ? await import('pixi-live2d-display/cubism4')
      : await import('pixi-live2d-display/cubism2')
    const { Live2DModel } = live2dModule

    // Register the PIXI ticker so Live2D updates run
    Live2DModel.registerTicker(PIXI.Ticker)

    pixiApp = new PIXI.Application({
      view: canvasRef.value,
      width: props.width,
      height: props.height,
      backgroundAlpha: 0,
      antialias: true,
      // Supersample so the model stays crisp on HiDPI screens and at user-
      // selected quality multipliers. `autoDensity` keeps the canvas's CSS
      // size equal to width/height while the backing store grows by
      // `resolution`, which is exactly the standard PIXI sharpening trick.
      resolution: clampRenderScale(props.renderScale),
      autoDensity: true,
    })

    live2dModel = await Live2DModel.from(modelUrl, { autoInteract: false })

    layoutModel()
    pixiApp.ticker.add(applyCursorFocus)
    scheduleCursorFocus()

    pixiApp.stage.addChild(live2dModel)

    // Set the initial expression (named expression + parameter blend + motion)
    void setExpression(props.expression)
    playMotion(props.expression)
    emit('ready')
  } catch (err: any) {
    error.value = err?.message || String(err)
    emit('error', error.value)
  }
}

function layoutModel() {
  if (!live2dModel) return
  if (pixiApp) {
    const targetResolution = clampRenderScale(props.renderScale)
    if (pixiApp.renderer.resolution !== targetResolution) {
      pixiApp.renderer.resolution = targetResolution
    }
    pixiApp.renderer.resize(props.width, props.height)
  }

  live2dModel.scale.set(1)
  const modelWidth = live2dModel.width || props.width
  const modelHeight = live2dModel.height || props.height
  const scaleX = props.width / modelWidth
  const scaleY = props.height / modelHeight
  const scale = Math.min(scaleX, scaleY) * props.modelScale
  live2dModel.scale.set(scale)
  live2dModel.x = (props.width - modelWidth * scale) / 2 + props.offsetX
  live2dModel.y = props.offsetY
}

async function setExpression(expression: string) {
  if (!live2dModel) return

  const exprMgr = live2dModel.internalModel?.motionManager?.expressionManager

  let namedExpressionSet = false

  if (exprMgr?.definitions?.length) {
    const candidates = EXPRESSION_NAME_MAP[expression]
    if (candidates) {
      for (const name of candidates) {
        const index = exprMgr.getExpressionIndex(name)
        if (index >= 0 && index < exprMgr.definitions.length) {
          try {
            await live2dModel.expression(name)
            namedExpressionSet = true
            break
          } catch {
            /* try next candidate */
          }
        }
      }
    }
    if (!namedExpressionSet) {
      try {
        await live2dModel.expression()
      } catch {
        /* random expression failed; fall back to parameter blending */
      }
    }
  }

  if (!namedExpressionSet) {
    const params = EXPRESSION_PARAMS[expression]
    if (params) {
      for (const p of params) {
        setCoreParameter(p.id, p.value)
      }
    }
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

function setCoreParameter(ids: string[], value: number) {
  const coreModel = live2dModel?.internalModel?.coreModel
  if (!coreModel) return
  for (const id of ids) {
    try {
      if (typeof coreModel.setParameterValueById === 'function') {
        coreModel.setParameterValueById(id, value)
        return
      }
      if (typeof coreModel.getParameterIndex === 'function' && typeof coreModel.setParameterValueByIndex === 'function') {
        const index = coreModel.getParameterIndex(id)
        if (typeof index === 'number' && index >= 0) {
          coreModel.setParameterValueByIndex(index, value)
          return
        }
      }
    } catch {
      /* Try the next common parameter id. */
    }
  }
}

function applyCursorFocus() {
  cursorFrame = 0
  if (!props.trackCursor || !live2dModel || !canvasRef.value) return

  const rect = canvasRef.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  const localX = latestPointer.clientX - rect.left
  const localY = latestPointer.clientY - rect.top
  const normalizedX = Math.max(-1, Math.min(1, (localX / rect.width - 0.5) * 2))
  const normalizedY = Math.max(-1, Math.min(1, (localY / rect.height - 0.5) * 2))

  try {
    if (typeof live2dModel.focus === 'function') {
      live2dModel.focus(localX, localY)
      return
    }
    if (typeof live2dModel.internalModel?.focusController?.focus === 'function') {
      live2dModel.internalModel.focusController.focus(localX, localY)
      return
    }
  } catch {
    /* Fall through to direct Cubism parameters. */
  }

  setCoreParameter(['ParamAngleX', 'PARAM_ANGLE_X'], normalizedX * 30)
  setCoreParameter(['ParamAngleY', 'PARAM_ANGLE_Y'], -normalizedY * 20)
  setCoreParameter(['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X'], normalizedX * 10)
  setCoreParameter(['ParamEyeBallX', 'PARAM_EYE_BALL_X'], normalizedX)
  setCoreParameter(['ParamEyeBallY', 'PARAM_EYE_BALL_Y'], -normalizedY)
}

function scheduleCursorFocus() {
  if (cursorFrame !== 0) return
  cursorFrame = window.requestAnimationFrame(applyCursorFocus)
}

function handleGlobalPointerMove(event: PointerEvent) {
  latestPointer = {
    clientX: event.clientX,
    clientY: event.clientY,
  }
  scheduleCursorFocus()
}

async function destroyModel() {
  if (cursorFrame !== 0) {
    window.cancelAnimationFrame(cursorFrame)
    cursorFrame = 0
  }
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
watch(() => [props.expression, props.expressionRevision] as const, ([expr]) => { void setExpression(expr); playMotion(expr) })
watch(() => [props.width, props.height, props.modelScale, props.offsetX, props.offsetY, props.renderScale], () => { layoutModel(); scheduleCursorFocus() })
watch(() => props.trackCursor, () => { scheduleCursorFocus() })

onMounted(() => {
  latestPointer = { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }
  window.addEventListener('pointermove', handleGlobalPointerMove, { passive: true })
  void initModel()
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', handleGlobalPointerMove)
  void destroyModel()
})
</script>

<template>
  <div
    class="relative overflow-hidden"
    :style="{ width: `${width}px`, height: `${height}px` }"
  >
    <!-- PIXI manages the canvas dimensions itself via autoDensity. Setting
         width/height attributes here would conflict with the supersampled
         backing store, so the canvas just fills its parent. -->
    <canvas ref="canvasRef" class="block w-full h-full" />
    <div
      v-if="error"
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 rounded-lg p-3 text-center"
    >
      <span class="text-2xl">!</span>
      <p class="text-xs text-red-400 leading-snug max-w-[220px]">{{ error }}</p>
    </div>
  </div>
</template>
