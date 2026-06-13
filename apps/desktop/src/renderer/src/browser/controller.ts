// Singleton controller for the embedded browser. BrowserPanel.vue registers
// each tab's <webview> element here; agent tools and the panel both drive the
// browser through this module. Keeping every webview interaction in one place
// means a future migration to WebContentsView only touches this file.

import {
  buildSnapshotScript,
  buildClickScript,
  buildTypeScript,
  buildScrollScript,
  buildReadScript,
  READ_PAGE_CHUNK,
  type RawSnapshot,
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
 * Resolve once the page settles after an action: either it never starts
 * loading (in-page interaction) or `did-stop-loading` fires. A short debounce
 * afterwards gives SPAs a beat to render.
 */
export function waitForSettle(wv: WebviewElement, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve) => {
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      wv.removeEventListener('did-stop-loading', onStop)
      setTimeout(resolve, 300)
    }
    const onStop = () => done()
    wv.addEventListener('did-stop-loading', onStop)
    setTimeout(done, timeoutMs)
    // If nothing is loading right now, give navigation a moment to start;
    // if it still hasn't, treat the action as in-page and settle early.
    setTimeout(() => {
      try {
        if (!finished && !wv.isLoading()) done()
      } catch {
        done()
      }
    }, 700)
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
  try {
    await wv.loadURL(url)
  } catch {
    // loadURL rejects on aborts/redirect races; the did-* events and settle
    // below still reflect the real outcome.
  }
  await waitForSettle(wv)
  return { url: wv.getURL(), title: wv.getTitle() }
}

export async function click(ref: string, tabId?: string): Promise<{ summary: string; snapshotText: string }> {
  const wv = requireWebview(tabId)
  const before = wv.getURL()
  const result = await executeInPage(wv, buildClickScript(ref))
  if (result?.error === 'stale_ref') {
    throw new Error(`Ref ${ref} is stale (the page changed). Take a new browser_snapshot and use fresh refs.`)
  }
  if (result?.error && result.error !== 'context_destroyed') {
    throw new Error(`Click on ${ref} failed: ${result.message || result.error}`)
  }
  await waitForSettle(wv)
  const after = wv.getURL()
  const summary = after !== before
    ? `Clicked [${ref}] — navigated to ${after}`
    : `Clicked [${ref}].`
  return { summary, snapshotText: await snapshot(tabId) }
}

export async function type(
  ref: string,
  text: string,
  opts: { submit?: boolean; clear?: boolean } = {},
): Promise<{ summary: string; snapshotText: string }> {
  const wv = requireWebview()
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
  }
  await waitForSettle(wv)
  return { summary, snapshotText: await snapshot() }
}

export async function scroll(
  direction: 'up' | 'down',
  pages = 1,
  ref?: string,
): Promise<{ summary: string; snapshotText: string }> {
  const wv = requireWebview()
  const result = await executeInPage(wv, buildScrollScript(direction, pages, ref))
  if (result?.error === 'stale_ref') {
    throw new Error(`Ref ${ref} is stale (the page changed). Take a new browser_snapshot and use fresh refs.`)
  }
  const pct = result?.scrollMax > 0 ? Math.round((result.scrollY / result.scrollMax) * 100) : 0
  const summary = ref
    ? `Scrolled [${ref}] into view.`
    : `Scrolled ${direction} — now at ${pct}% of page.`
  return { summary, snapshotText: await snapshot() }
}

export async function history(direction: 'back' | 'forward'): Promise<{ summary: string; snapshotText: string }> {
  const wv = requireWebview()
  if (direction === 'back') {
    if (!wv.canGoBack()) return { summary: 'Cannot go back — no earlier page in this tab.', snapshotText: '' }
    wv.goBack()
  } else {
    if (!wv.canGoForward()) return { summary: 'Cannot go forward — no later page in this tab.', snapshotText: '' }
    wv.goForward()
  }
  await waitForSettle(wv)
  return { summary: `Went ${direction} to ${wv.getURL()}`, snapshotText: await snapshot() }
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
