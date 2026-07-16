// Singleton controller for the embedded browser. BrowserPanel.vue registers
// each tab's <webview> element here; agent tools and the panel both drive the
// browser through this module. Keeping every webview interaction in one place
// means a future migration to WebContentsView only touches this file.

import {
  buildSnapshotScript,
  buildTargetRectScript,
  buildClickScript,
  buildTypeScript,
  buildScrollScript,
  buildReadScript,
  READ_PAGE_CHUNK,
  type RawSnapshot,
  type AgentTargetRect,
} from './snapshot-script'
import { formatSnapshot } from './snapshot-format'

/** Minimal surface of Electron's <webview> element that we rely on. */
export interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  isLoading(): boolean
  executeJavaScript(code: string, userGesture?: boolean): Promise<any>
  sendInputEvent(event: any): void
  getWebContentsId(): number
  findInPage(text: string, options?: any): number
  stopFindInPage(action: string): void
}

const webviews = new Map<string, WebviewElement>()
let activeTabId = ''

export function isAllowedBrowserUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(String(rawUrl || ''))
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function registerWebview(tabId: string, el: WebviewElement) {
  webviews.set(tabId, el)
}

export function unregisterWebview(tabId: string) {
  webviews.delete(tabId)
}

export function setActiveTab(tabId: string) {
  activeTabId = tabId
}

export function getActiveTabId(): string {
  return activeTabId
}

export function getWebview(tabId?: string): WebviewElement | null {
  return webviews.get(tabId || activeTabId) || null
}

/**
 * A freshly created tab's <webview> mounts asynchronously — poll until it is
 * registered and has a webContents attached (getURL throws before attach).
 */
export async function waitForWebview(tabId: string, timeoutMs = 4000): Promise<WebviewElement | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const wv = webviews.get(tabId)
    if (wv) {
      try {
        wv.getURL()
        return wv
      } catch { /* not attached yet */ }
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  return webviews.get(tabId) || null
}

function requireWebview(tabId?: string): WebviewElement {
  const wv = getWebview(tabId)
  if (!wv) {
    throw new Error('No browser tab is open. Use browser_navigate to open a page first.')
  }
  return wv
}

/**
 * Resolve once the page settles after an action. Two cases:
 *  - A navigation begins (`did-start-loading`) → wait for `did-stop-loading`,
 *    then a short debounce so SPAs get a beat to render.
 *  - No navigation begins (in-page interaction) → settle quickly once the probe
 *    window passes and nothing is loading.
 * The `did-start-loading` guard lets the in-page probe be aggressive without
 * misfiring on slow click→navigate transitions: if a load starts during the
 * probe window, we abandon the early settle and wait for the load to finish.
 */
export function waitForSettle(
  wv: WebviewElement,
  timeoutMs = 6000,
  opts: { settleMs?: number; probeMs?: number } = {},
): Promise<void> {
  const settleMs = opts.settleMs ?? 250
  const probeMs = opts.probeMs ?? 300
  return new Promise((resolve) => {
    let finished = false
    let navigating = false
    const cleanup = () => {
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-start-loading', onStart)
    }
    const done = () => {
      if (finished) return
      finished = true
      cleanup()
      setTimeout(resolve, settleMs)
    }
    const onStop = () => done()
    const onStart = () => { navigating = true }
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-start-loading', onStart)
    setTimeout(done, timeoutMs) // hard cap
    // In-page probe: if no navigation has begun and nothing is loading, the
    // action stayed on the page — settle without paying the full timeout.
    setTimeout(() => {
      try {
        if (!finished && !navigating && !wv.isLoading()) done()
      } catch {
        done()
      }
    }, probeMs)
  })
}

async function executeInPage(wv: WebviewElement, script: string): Promise<any> {
  try {
    return await wv.executeJavaScript(script, false)
  } catch (err: any) {
    // executeJavaScript rejects when navigation destroys the page context
    // mid-flight — for click/submit actions that just means "it navigated".
    return { error: 'context_destroyed', message: err?.message || String(err) }
  }
}

type AgentCursorState = 'moving' | 'clicking' | 'typing' | 'loading' | 'hidden'

function emitAgentCursor(state: AgentCursorState, position?: Partial<AgentTargetRect>) {
  window.dispatchEvent(new CustomEvent('syntax-senpai:browser-cursor', {
    detail: { state, ...position },
  }))
}

async function pointAtRef(wv: WebviewElement, ref: string, state: 'clicking' | 'typing') {
  const target = await executeInPage(wv, buildTargetRectScript(ref))
  if (target?.error === 'stale_ref') {
    throw new Error(`Ref ${ref} is stale (the page changed). Take a new browser_snapshot and use fresh refs.`)
  }
  if (target?.error) return
  emitAgentCursor('moving', target)
  await new Promise((resolve) => setTimeout(resolve, 420))
  emitAgentCursor(state, target)
  await new Promise((resolve) => setTimeout(resolve, 140))
}

export async function snapshot(tabId?: string): Promise<string> {
  const wv = requireWebview(tabId)
  const raw = (await executeInPage(wv, buildSnapshotScript())) as RawSnapshot | { error: string }
  if (raw && (raw as any).error) {
    return 'Snapshot failed: the page navigated while capturing. Call browser_snapshot again.'
  }
  return formatSnapshot(raw as RawSnapshot)
}

export async function navigate(url: string, tabId?: string): Promise<{ url: string; title: string }> {
  if (!isAllowedBrowserUrl(url)) {
    throw new Error(`Blocked: only http(s) URLs are allowed in the embedded browser (got "${url}").`)
  }
  const wv = requireWebview(tabId)
  emitAgentCursor('loading', { x: 48, y: 42 })
  try {
    await wv.loadURL(url)
  } catch {
    // loadURL rejects on aborts/redirect races; the did-* events and settle
    // below still reflect the real outcome.
  }
  await waitForSettle(wv)
  emitAgentCursor('moving', { x: 48, y: 42 })
  return { url: wv.getURL(), title: wv.getTitle() }
}

// ── action cores ──────────────────────────────────────────────────────────────
// Each *Core performs the action and settles but does NOT snapshot. The public
// wrappers append a snapshot for single-shot tool calls; runSteps() chains the
// cores and snapshots once at the very end (no per-step round-trip).

async function clickCore(ref: string, tabId?: string): Promise<string> {
  const wv = requireWebview(tabId)
  const before = wv.getURL()
  await pointAtRef(wv, ref, 'clicking')
  const result = await executeInPage(wv, buildClickScript(ref))
  if (result?.error === 'stale_ref') {
    throw new Error(`Ref ${ref} is stale (the page changed). Take a new browser_snapshot and use fresh refs.`)
  }
  if (result?.error && result.error !== 'context_destroyed') {
    throw new Error(`Click on ${ref} failed: ${result.message || result.error}`)
  }
  emitAgentCursor('loading')
  await waitForSettle(wv)
  const after = wv.getURL()
  emitAgentCursor('moving')
  const summary = after !== before
    ? `Clicked [${ref}] — navigated to ${after}`
    : `Clicked [${ref}].`
  return summary
}

export async function click(ref: string, tabId?: string): Promise<{ summary: string; snapshotText: string }> {
  const summary = await clickCore(ref, tabId)
  return { summary, snapshotText: await snapshot(tabId) }
}

async function typeCore(
  ref: string,
  text: string,
  opts: { submit?: boolean; clear?: boolean } = {},
): Promise<string> {
  const wv = requireWebview()
  await pointAtRef(wv, ref, 'typing')
  const result = await executeInPage(wv, buildTypeScript(ref, text, opts.clear !== false))
  if (result?.error === 'stale_ref') {
    throw new Error(`Ref ${ref} is stale (the page changed). Take a new browser_snapshot and use fresh refs.`)
  }
  if (result?.error === 'password_field') {
    throw new Error('Refused: this is a password field. Ask the user to type their password themselves.')
  }
  if (result?.error === 'not_typable') {
    throw new Error(`Ref ${ref} is not a text input. Pick a textbox/searchbox ref from the snapshot.`)
  }
  if (result?.error && result.error !== 'context_destroyed') {
    throw new Error(`Typing into ${ref} failed: ${result.message || result.error}`)
  }
  let summary = `Typed into [${ref}].`
  if (opts.submit) {
    wv.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    wv.sendInputEvent({ type: 'char', keyCode: 'Return' })
    wv.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    summary = `Typed into [${ref}] and pressed Enter.`
    emitAgentCursor('loading')
  }
  await waitForSettle(wv)
  emitAgentCursor('moving')
  return summary
}

export async function type(
  ref: string,
  text: string,
  opts: { submit?: boolean; clear?: boolean } = {},
): Promise<{ summary: string; snapshotText: string }> {
  const summary = await typeCore(ref, text, opts)
  return { summary, snapshotText: await snapshot() }
}

async function scrollCore(direction: 'up' | 'down', pages = 1, ref?: string): Promise<string> {
  const wv = requireWebview()
  const result = await executeInPage(wv, buildScrollScript(direction, pages, ref))
  if (result?.error === 'stale_ref') {
    throw new Error(`Ref ${ref} is stale (the page changed). Take a new browser_snapshot and use fresh refs.`)
  }
  const pct = result?.scrollMax > 0 ? Math.round((result.scrollY / result.scrollMax) * 100) : 0
  return ref ? `Scrolled [${ref}] into view.` : `Scrolled ${direction} — now at ${pct}% of page.`
}

export async function scroll(
  direction: 'up' | 'down',
  pages = 1,
  ref?: string,
): Promise<{ summary: string; snapshotText: string }> {
  const summary = await scrollCore(direction, pages, ref)
  return { summary, snapshotText: await snapshot() }
}

async function historyCore(direction: 'back' | 'forward'): Promise<string> {
  const wv = requireWebview()
  if (direction === 'back') {
    if (!wv.canGoBack()) return 'Cannot go back — no earlier page in this tab.'
    wv.goBack()
  } else {
    if (!wv.canGoForward()) return 'Cannot go forward — no later page in this tab.'
    wv.goForward()
  }
  await waitForSettle(wv)
  return `Went ${direction} to ${wv.getURL()}`
}

export async function history(direction: 'back' | 'forward'): Promise<{ summary: string; snapshotText: string }> {
  const summary = await historyCore(direction)
  // No snapshot when the navigation was a no-op (kept the old behaviour).
  if (summary.startsWith('Cannot go')) return { summary, snapshotText: '' }
  return { summary, snapshotText: await snapshot() }
}

/**
 * Pause for a bounded duration. With `untilText`, poll the page and resolve as
 * soon as that text appears (case-insensitive substring of visible text) — much
 * better than a blind sleep for dynamic/lazy content. Returns a status line.
 */
export async function waitFor(seconds: number, untilText?: string): Promise<string> {
  const wv = requireWebview()
  const ms = Math.max(100, Math.min(15000, Math.round((Number(seconds) || 0) * 1000)))
  const secStr = (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)
  if (!untilText) {
    await new Promise((r) => setTimeout(r, ms))
    return `Waited ${secStr}s.`
  }
  const needle = String(untilText).toLowerCase()
  const probe = `(() => { const t = (document.body && document.body.innerText) || ''; return t.toLowerCase().includes(${JSON.stringify(needle)}); })()`
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const hit = await executeInPage(wv, probe)
    if (hit === true) return `"${untilText}" appeared — done waiting.`
    await new Promise((r) => setTimeout(r, 250))
  }
  return `Timed out after ${secStr}s waiting for "${untilText}" (it never appeared).`
}

/** One step of a batched browser_act sequence. */
export interface BrowserStep {
  action: 'navigate' | 'click' | 'type' | 'scroll' | 'history' | 'wait'
  url?: string
  ref?: string
  text?: string
  submit?: boolean
  clear?: boolean
  direction?: 'up' | 'down' | 'back' | 'forward'
  pages?: number
  seconds?: number
  until_text?: string
}

const MAX_BATCH_STEPS = 8

/**
 * Execute a planned sequence of steps back-to-back without an LLM round-trip
 * between them — the agent "thinks ahead" once, then the renderer drives the
 * page through every step, settling after each. Only the final page is
 * snapshotted (intermediate snapshots would be wasted tokens the model never
 * sees). Stops at the first failing step and returns progress + a snapshot so
 * the model can recover from where it landed.
 */
export async function runSteps(
  steps: BrowserStep[],
): Promise<{ summaries: string[]; snapshotText: string; stoppedAtStep?: number }> {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('browser_act needs a non-empty "steps" array.')
  }
  requireWebview() // fail fast if no tab is open
  const summaries: string[] = []
  const count = Math.min(steps.length, MAX_BATCH_STEPS)
  for (let i = 0; i < count; i++) {
    const step = steps[i] || ({} as BrowserStep)
    const action = String(step.action || '')
    try {
      switch (action) {
        case 'navigate': {
          if (!isAllowedBrowserUrl(String(step.url || ''))) {
            throw new Error(`only http(s) URLs are allowed (got "${step.url}")`)
          }
          const info = await navigate(String(step.url))
          summaries.push(`Navigated to ${info.url}`)
          break
        }
        case 'click':
          summaries.push(await clickCore(String(step.ref || '')))
          break
        case 'type':
          summaries.push(await typeCore(String(step.ref || ''), String(step.text ?? ''), {
            submit: step.submit === true,
            clear: step.clear !== false,
          }))
          break
        case 'scroll':
          summaries.push(await scrollCore(
            step.direction === 'up' ? 'up' : 'down',
            Math.max(1, Math.min(10, Number(step.pages) || 1)),
            step.ref ? String(step.ref) : undefined,
          ))
          break
        case 'history':
          summaries.push(await historyCore(step.direction === 'forward' ? 'forward' : 'back'))
          break
        case 'wait':
          summaries.push(await waitFor(Number(step.seconds) || 1, step.until_text ? String(step.until_text) : undefined))
          break
        default:
          throw new Error(`unknown step action "${action}"`)
      }
    } catch (err: any) {
      summaries.push(`✗ Step ${i + 1} (${action}) failed: ${err?.message || String(err)} — stopped here.`)
      let snap = ''
      try { snap = await snapshot() } catch { /* page may be gone */ }
      return { summaries, snapshotText: snap, stoppedAtStep: i + 1 }
    }
  }
  if (steps.length > MAX_BATCH_STEPS) {
    summaries.push(`(only the first ${MAX_BATCH_STEPS} steps ran; send the rest in another browser_act)`)
  }
  return { summaries, snapshotText: await snapshot() }
}

export async function readPage(offset = 0): Promise<string> {
  const wv = requireWebview()
  const result = await executeInPage(wv, buildReadScript(offset))
  if (result?.error) {
    return 'Could not read the page (it may have navigated). Take a browser_snapshot and retry.'
  }
  const end = Math.min(result.total, result.offset + READ_PAGE_CHUNK)
  let header = `${result.title} — ${result.url}\nShowing characters ${result.offset}–${end} of ${result.total}`
  if (end < result.total) {
    header += ` (call browser_read_page with offset=${end} for more)`
  }
  return `${header}\n\n${result.text}`
}

export async function screenshot(): Promise<{ dataUrl: string }> {
  const wv = requireWebview()
  const ipc = (window as any).electron?.ipcRenderer
  if (!ipc) throw new Error('IPC not available')
  const res = await ipc.invoke('browser:capturePage', wv.getWebContentsId())
  if (!res?.success) throw new Error(res?.error || 'screenshot failed')
  return { dataUrl: res.dataUrl }
}

export function currentPageInfo(): { url: string; title: string } | null {
  const wv = getWebview()
  if (!wv) return null
  try {
    return { url: wv.getURL(), title: wv.getTitle() }
  } catch {
    return null
  }
}
