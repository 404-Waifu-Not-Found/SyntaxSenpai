import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ToolCall, ComputerObservation } from '@syntax-senpai/ai-core'
export const COMPUTER_INSTRUCTIONS = `Computer use: discover tools with tool_search. Identify the requested running application, then computer_observe. Prefer an observed accessibility element_id; screenshot coordinates must use the current observation_id. Use one meaningful action, observe the result, then verify it. Re-observe after navigation, scrolling, focus/window changes, or stale targets. Never guess UI elements or repeat unchanged failed coordinates. Native input controls the real desktop. Prefer existing browser DOM tools when they fit. Respect explicit instructions such as do not submit. Use computer_wait with a condition, not repeated blind clicks. A successful input event is not proof that the intended result occurred. Verify saved files and visible state. macOS permission denial is a capability failure; report setup status without claiming success.`
export function screenshotPoint(observation: ComputerObservation, x: number, y: number) {
  const b = observation.bounds
  if (!b || !observation.imageWidth || !observation.imageHeight) throw new Error('Observation has no screenshot coordinate transform')
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= observation.imageWidth || y >= observation.imageHeight) throw new Error('Point lies outside the observed screenshot')
  return { x: b.x + x * b.width / observation.imageWidth, y: b.y + y * b.height / observation.imageHeight }
}
export class ComputerService {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private current?: ComputerObservation
  constructor(private root: string) {}
  helperPath() {
    const { app } = require('electron')
    if (app.isPackaged) return path.join(process.resourcesPath, 'native/syntax-computer')
    return [path.join(app.getAppPath(), 'resources/native/syntax-computer'), path.resolve(__dirname, '../../resources/native/syntax-computer')].find(candidate => fs.existsSync(candidate)) || path.join(app.getAppPath(), 'resources/native/syntax-computer')
  }
  private start() {
    if (process.platform !== 'darwin') throw new Error('Native computer control is available on macOS only')
    if (this.child) return
    const helper = this.helperPath()
    if (!fs.existsSync(helper)) throw new Error('Native helper missing. Run the native build and package it with the application.')
    const child = spawn(helper, [], { stdio: 'pipe' }); this.child = child
    createInterface({ input: child.stdout }).on('line', line => {
      try { const message = JSON.parse(line), p = this.pending.get(message.id); if (p) { clearTimeout(p.timer); this.pending.delete(message.id); message.error ? p.reject(new Error(message.error)) : p.resolve(message.result) } } catch {}
    })
    const failed = () => { if (this.child !== child) return; this.child = undefined; this.current = undefined; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Native helper stopped; observe again before continuing')) }; this.pending.clear() }
    child.on('exit', failed); child.on('error', failed)
    child.stderr.on('data', () => {})
  }
  private request(method: string, args: any = {}) {
    this.start()
    return new Promise<any>((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Native helper timed out')); this.child?.kill(); this.current = undefined }, 10000)
      this.pending.set(id, { resolve, reject, timer }); this.child!.stdin.write(JSON.stringify({ id, method, args }) + '\n')
    })
  }
  async status() {
    if (process.platform !== 'darwin') return { available: false, reason: 'macOS only' }
    try { return { available: true, ...await this.request('status'), screenRecording: require('electron').systemPreferences.getMediaAccessStatus('screen') } }
    catch (e) { return { available: false, reason: String(e) } }
  }
  async setup(kind: string) {
    if (kind === 'accessibility') return this.request('setup')
    await require('electron').shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    return this.status()
  }
  async observe(args: any = {}) {
    const observation: ComputerObservation = await this.request('observe', args)
    const { screen, desktopCapturer, systemPreferences } = require('electron')
    const displays = screen.getAllDisplays(); observation.displays = displays.map((d: any) => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor }))
    if (args.screenshot !== false && systemPreferences.getMediaAccessStatus('screen') === 'granted') {
      const display = args.display_id ? displays.find((d: any) => String(d.id) === String(args.display_id)) : screen.getDisplayMatching(observation.bounds || screen.getPrimaryDisplay().bounds)
      if (!display) throw new Error('Display is no longer available')
      const captures = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) } })
      const capture = captures.find((c: any) => c.display_id === String(display.id))
      if (!capture || capture.thumbnail.isEmpty()) throw new Error('Screen capture unavailable; check macOS Screen Recording access')
      let image = capture.thumbnail; let bounds = { ...display.bounds }
      if (args.crop) {
        const crop = args.crop, size = image.getSize()
        if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > size.width || crop.y + crop.height > size.height) throw new Error('Crop is outside the capture')
        const sx = bounds.width / size.width, sy = bounds.height / size.height
        bounds = { x: bounds.x + crop.x * sx, y: bounds.y + crop.y * sy, width: crop.width * sx, height: crop.height * sy }
        image = image.crop(crop)
      }
      if (image.getSize().width > 1600) image = image.resize({ width: 1600 })
      const size = image.getSize(); observation.bounds = bounds; observation.imageWidth = size.width; observation.imageHeight = size.height
      const artifact = path.join(this.root, 'screenshots', observation.id + '.png'); fs.mkdirSync(path.dirname(artifact), { recursive: true }); fs.writeFileSync(artifact, image.toPNG())
      observation.screenshotRef = artifact; observation.screenshot = image.toDataURL()
    }
    this.current = { ...observation }; return observation
  }
  async execute(call: ToolCall, signal?: AbortSignal): Promise<any> {
    if (signal?.aborted) throw new Error('Cancelled')
    const method = call.name.replace('computer_', ''), args: any = { ...call.arguments }
    if (method === 'observe') return this.observe(args)
    if (method === 'wait') {
      if (!args.until_text && !args.app_id) throw new Error('Wait requires until_text or app_id')
      const end = Date.now() + Math.min(15000, Math.max(100, Number(args.timeout_ms) || 5000))
      while (Date.now() < end) {
        if (signal?.aborted) throw new Error('Cancelled')
        const observation = await this.observe({ screenshot: false })
        if ((!args.app_id || observation.appId === args.app_id) && (!args.until_text || observation.elements.some(e => (e.label + ' ' + (e.value || '')).includes(args.until_text)))) return observation
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      throw new Error('Condition was not observed before timeout')
    }
    const o = this.current
    if (!o || args.observation_id !== o.id || Date.now() - o.timestamp > 30000) throw new Error('Observation is stale. Call computer_observe again.')
    if (method === 'focus' && !o.apps?.some(a => a.id === args.app_id)) throw new Error('Application was not discovered in this observation')
    if (args.element_id && !o.elements.some(e => e.id === args.element_id)) throw new Error('Element was not discovered in this observation')
    if (args.x !== undefined && !args.element_id) Object.assign(args, screenshotPoint(o, args.x, args.y))
    if (method === 'drag') { const point = screenshotPoint(o, args.to_x, args.to_y); args.to_x = point.x; args.to_y = point.y }
    this.current = undefined
    const result = await this.request(method, args)
    return { ...result, observationId: o.id, message: 'Input sent. Observe and verify the resulting state.' }
  }
  async stop() {
    this.current = undefined
    if (!this.child) return
    const previous = this.child; this.child = undefined
    previous.kill()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Emergency stop')) }
    this.pending.clear()
    // A fresh helper releases input even if the old helper was wedged mid-drag.
    try { await this.request('stop'); (this.child as ChildProcessWithoutNullStreams | undefined)?.stdin.end() } catch { (this.child as ChildProcessWithoutNullStreams | undefined)?.kill() }
  }
}
