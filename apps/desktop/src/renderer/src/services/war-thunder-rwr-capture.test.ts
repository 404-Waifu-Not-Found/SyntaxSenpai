import { afterEach, describe, expect, it, vi } from 'vitest'
import { countRwrSignalPixels, startWarThunderRwrCapture, stopWarThunderRwrCapture } from './war-thunder-rwr-capture'

function rgbaImage(width: number, height: number, color: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set(color, offset)
  return { data, width, height }
}

describe('War Thunder RWR image sampler', () => {
  it('counts colored and bright monochrome display pixels in the selected crop', () => {
    const image = rgbaImage(10, 10, [0, 0, 0, 255])
    for (let y = 2; y < 5; y += 1) {
      for (let x = 2; x < 5; x += 1) {
        const offset = (y * 10 + x) * 4
        image.data.set([0, 255, 0, 255], offset)
      }
    }
    expect(countRwrSignalPixels(image, { x: 0.2, y: 0.2, width: 0.3, height: 0.3 })).toBe(9)
    expect(countRwrSignalPixels(image, { x: 0.6, y: 0.6, width: 0.3, height: 0.3 })).toBe(0)
    expect(countRwrSignalPixels(rgbaImage(4, 4, [240, 240, 240, 255]), { x: 0, y: 0, width: 1, height: 1 })).toBe(16)
  })

  it('ignores neutral background and invalid crop geometry', () => {
    const image = rgbaImage(4, 4, [180, 180, 180, 255])
    expect(countRwrSignalPixels(image, { x: 0, y: 0, width: 1, height: 1 })).toBe(0)
    expect(countRwrSignalPixels(image, { x: Number.NaN, y: 0, width: 1, height: 1 })).toBeNull()
  })
})

describe('War Thunder RWR capture lifetime', () => {
  const config = { sourceId: 'window:1:0', region: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 } }

  function mockCapture() {
    vi.useFakeTimers()
    const track = { readyState: 'live', stop: vi.fn(), addEventListener: vi.fn() }
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    const video = {
      readyState: 2, videoWidth: 320, videoHeight: 240, srcObject: null,
      play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }
    const context = { drawImage: vi.fn(), getImageData: () => rgbaImage(4, 4, [0, 255, 0, 255]) }
    const canvas = { width: 0, height: 0, getContext: () => context }
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 })
    vi.stubGlobal('document', { createElement: (tag: string) => tag === 'video' ? video : canvas })
    vi.stubGlobal('window', { electron: { ipcRenderer: { invoke: async () => ({ success: true, data: { sources: [{ id: config.sourceId }] } }) } } })
    return { track, stream, getUserMedia }
  }

  afterEach(() => {
    stopWarThunderRwrCapture()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reuses the selected capture and closes its stream and timer when stopped', async () => {
    const { getUserMedia, track } = mockCapture()
    const firstSample = vi.fn()
    const currentSample = vi.fn()
    startWarThunderRwrCapture(config, firstSample, vi.fn())
    startWarThunderRwrCapture(config, currentSample, vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(firstSample).not.toHaveBeenCalled()
    expect(currentSample).toHaveBeenCalledWith(16)
    stopWarThunderRwrCapture()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not leave a polling timer behind if the initial sample fails', async () => {
    const { track } = mockCapture()
    const onError = vi.fn()
    startWarThunderRwrCapture({ ...config, region: { ...config.region, width: 0 } }, vi.fn(), onError)
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases a stream that arrives after monitoring was stopped', async () => {
    const { getUserMedia, stream, track } = mockCapture()
    let resolveStream!: (value: typeof stream) => void
    getUserMedia.mockReturnValue(new Promise((resolve) => { resolveStream = resolve }))
    const onSample = vi.fn()
    startWarThunderRwrCapture(config, onSample, vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    stopWarThunderRwrCapture()
    resolveStream(stream)
    await vi.advanceTimersByTimeAsync(0)
    expect(onSample).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
