import { useIpc } from '../composables/use-ipc'

export type WarThunderRwrRegion = { x: number; y: number; width: number; height: number }
export type WarThunderRwrCaptureConfig = { sourceId: string; region: WarThunderRwrRegion }
export type WarThunderRwrConfig = {
  enabled: boolean
  sourceId: string
  sourceName: string
  region: WarThunderRwrRegion | null
  baselineSignalPixels: number | null
  thresholdDelta: number
}

type CaptureFrame = { video: HTMLVideoElement; stream: MediaStream }
type ActiveCapture = WarThunderRwrCaptureConfig & {
  key: string
  onSample: (signalPixels: number) => void
  onError: (message: string) => void
  frame: CaptureFrame | null
  timer: ReturnType<typeof setInterval> | null
}

let activeCapture: ActiveCapture | null = null

export function isWarThunderRwrRegion(value: unknown): value is WarThunderRwrRegion {
  if (!value || typeof value !== 'object') return false
  const region = value as WarThunderRwrRegion
  return [region.x, region.y, region.width, region.height].every(Number.isFinite)
    && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0
    && region.x + region.width <= 1.000001 && region.y + region.height <= 1.000001
}

function regionPixels(region: WarThunderRwrRegion, width: number, height: number) {
  if (!region || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const values = [region.x, region.y, region.width, region.height]
  if (values.some((value) => !Number.isFinite(value)) || region.width <= 0 || region.height <= 0) return null
  const x = Math.max(0, Math.min(1, region.x))
  const y = Math.max(0, Math.min(1, region.y))
  const right = Math.max(x, Math.min(1, region.x + region.width))
  const bottom = Math.max(y, Math.min(1, region.y + region.height))
  const crop = {
    x: Math.floor(x * width),
    y: Math.floor(y * height),
    width: Math.ceil((right - x) * width),
    height: Math.ceil((bottom - y) * height),
  }
  if (crop.width < 2 || crop.height < 2) return null
  crop.width = Math.min(crop.width, width - crop.x)
  crop.height = Math.min(crop.height, height - crop.y)
  return crop
}

export function countRwrSignalPixels(image: Pick<ImageData, 'data' | 'width' | 'height'>, region: WarThunderRwrRegion): number | null {
  if (!image?.data || image.data.length < image.width * image.height * 4) return null
  const crop = regionPixels(region, image.width, image.height)
  if (!crop) return null
  let count = 0
  for (let y = crop.y; y < crop.y + crop.height; y += 1) {
    for (let x = crop.x; x < crop.x + crop.width; x += 1) {
      const offset = (y * image.width + x) * 4
      const red = image.data[offset]
      const green = image.data[offset + 1]
      const blue = image.data[offset + 2]
      const alpha = image.data[offset + 3]
      const brightest = Math.max(red, green, blue)
      const saturation = brightest - Math.min(red, green, blue)
      const coloredSignal = brightest >= 96 && saturation >= 36
      const monochromeSignal = brightest >= 210 && saturation < 36
      if (alpha > 24 && (coloredSignal || monochromeSignal)) count += 1
    }
  }
  return count
}

async function openCapture(sourceId: string): Promise<CaptureFrame> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Window capture is unavailable in this renderer.')
  const sources = await useIpc().invoke('plugins:execTool', 'warthunder_copilot_rwr_sources', { includePreviews: false })
  if (!sources?.success) throw new Error(sources?.error || 'Could not verify the War Thunder window.')
  if (!sources.data?.sources?.some((source: { id: string }) => source.id === sourceId)) {
    throw new Error('The selected War Thunder window is unavailable. Refresh the window list.')
  }
  const legacyVideo = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxWidth: 960,
      maxHeight: 540,
      maxFrameRate: 2,
    },
  } as unknown as MediaTrackConstraints
  const stream = await new Promise<MediaStream>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      settled = true
      reject(new Error('Timed out opening the War Thunder window capture.'))
    }, 7000)
    void navigator.mediaDevices.getUserMedia({ audio: false, video: legacyVideo }).then((value) => {
      clearTimeout(timeout)
      if (settled) {
        value.getTracks().forEach((track) => track.stop())
        return
      }
      settled = true
      resolve(value)
    }).catch((error) => {
      clearTimeout(timeout)
      if (!settled) { settled = true; reject(error) }
    })
  })
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout)
        video.removeEventListener('loadeddata', handleLoadedData)
      }
      const handleLoadedData = () => {
        cleanup()
        resolve()
      }
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Timed out waiting for the War Thunder capture.'))
      }, 5000)
      video.addEventListener('loadeddata', handleLoadedData, { once: true })
      void video.play().then(() => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) handleLoadedData()
      }).catch((error) => { cleanup(); reject(error) })
    })
    return { video, stream }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    throw error
  }
}

function sampleCapture(frame: CaptureFrame, region: WarThunderRwrRegion) {
  const { video } = frame
  if (frame.stream.getVideoTracks()[0]?.readyState === 'ended') throw new Error('The War Thunder window capture stopped.')
  if (video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null
  const crop = regionPixels(region, video.videoWidth, video.videoHeight)
  if (!crop) throw new Error('The selected RWR crop is invalid or empty.')
  const canvas = document.createElement('canvas')
  // Keep the scoring resolution stable if the captured video dimensions change.
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Could not initialize the RWR image sampler.')
  context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
  return countRwrSignalPixels(context.getImageData(0, 0, canvas.width, canvas.height), { x: 0, y: 0, width: 1, height: 1 })
}

function closeCapture(frame: CaptureFrame) {
  frame.video.pause()
  frame.video.srcObject = null
  frame.stream.getTracks().forEach((track) => track.stop())
}

export async function captureWarThunderRwrBaseline(sourceId: string, region: WarThunderRwrRegion) {
  const frame = await openCapture(sourceId)
  try {
    const samples: number[] = []
    for (let index = 0; index < 5; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150))
      const signalPixels = sampleCapture(frame, region)
      if (!Number.isFinite(signalPixels)) throw new Error('The selected RWR crop is invalid or empty.')
      samples.push(signalPixels as number)
    }
    samples.sort((left, right) => left - right)
    return samples[Math.floor(samples.length / 2)]
  } finally {
    closeCapture(frame)
  }
}

function failCapture(capture: ActiveCapture, error: unknown) {
  if (activeCapture !== capture) return
  stopWarThunderRwrCapture()
  capture.onError(error instanceof Error ? error.message : String(error))
}

export function startWarThunderRwrCapture(
  config: WarThunderRwrCaptureConfig,
  onSample: (signalPixels: number) => void,
  onError: (message: string) => void,
) {
  const key = `${config.sourceId}:${JSON.stringify(config.region)}`
  if (activeCapture?.key === key) {
    activeCapture.onSample = onSample
    activeCapture.onError = onError
    return
  }
  stopWarThunderRwrCapture()
  const capture: ActiveCapture = { ...config, key, onSample, onError, frame: null, timer: null }
  activeCapture = capture
  void openCapture(config.sourceId).then((frame) => {
    if (activeCapture !== capture) {
      closeCapture(frame)
      return
    }
    capture.frame = frame
    const track = frame.stream.getVideoTracks()[0]
    track?.addEventListener('ended', () => failCapture(capture, 'The War Thunder window capture stopped.'))
    const sample = () => {
      if (activeCapture !== capture || !capture.frame) return
      try {
        const signalPixels = sampleCapture(capture.frame, capture.region)
        if (Number.isFinite(signalPixels)) capture.onSample(signalPixels as number)
      } catch (error) {
        failCapture(capture, error)
      }
    }
    capture.timer = setInterval(sample, 500)
    sample()
  }).catch((error) => failCapture(capture, error))
}

export function stopWarThunderRwrCapture() {
  const capture = activeCapture
  activeCapture = null
  if (!capture) return
  if (capture.timer) clearInterval(capture.timer)
  if (capture.frame) closeCapture(capture.frame)
}
