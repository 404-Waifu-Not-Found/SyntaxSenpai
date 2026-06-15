import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useIpc } from '../composables/use-ipc'

export interface BrowserTab {
  id: string
  url: string
  title: string
  favicon: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserDownload {
  id: string
  filename: string
  url: string
  totalBytes: number
  receivedBytes: number
  state: 'pending' | 'downloading' | 'completed' | 'cancelled' | 'interrupted'
  savePath?: string
}

const PANEL_WIDTH_KEY = 'syntax-senpai-browser-panel-width'
const AI_CONTROL_KEY = 'syntax-senpai-browser-ai-control'
const BROWSER_TABS_KEY = 'syntax-senpai-browser-tabs'
const BROWSER_ACTIVE_TAB_KEY = 'syntax-senpai-browser-active-tab'

export const DEFAULT_NEW_TAB_URL = 'about:blank'

/** Short, human-friendly label for a URL (its host) — used as the tab title
 *  for restored-but-not-yet-loaded tabs so the strip is readable before the
 *  page is lazily mounted. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host || 'New Tab'
  } catch {
    return 'New Tab'
  }
}

/** Turn URL-bar input into a navigable URL (search query → DuckDuckGo). */
export function normalizeUrlInput(input: string): string {
  const trimmed = String(input || '').trim()
  if (!trimmed) return DEFAULT_NEW_TAB_URL
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // Looks like a host (has a dot, no spaces) → assume https.
  if (!/\s/.test(trimmed) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

export const useBrowserStore = defineStore('browser', () => {
  const ipc = useIpc()

  const panelOpen = ref(false)
  const panelWidthPct = ref<number>(Number(localStorage.getItem(PANEL_WIDTH_KEY)) || 45)
  const aiControlEnabled = ref(localStorage.getItem(AI_CONTROL_KEY) !== 'false')

  const tabs = ref<BrowserTab[]>([])
  const activeTabId = ref<string>('')
  const downloads = ref<BrowserDownload[]>([])
  // Saved-session restore runs once per app launch, not on every panel mount —
  // otherwise toggling the panel would clobber and reload all live tabs.
  const hasRestored = ref(false)

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) || null)
  const pendingDownloads = computed(() => downloads.value.filter((d) => d.state === 'pending'))

  let tabSeq = 0

  function newTab(url?: string): BrowserTab {
    const tab: BrowserTab = {
      id: `tab-${Date.now()}-${++tabSeq}`,
      url: url || DEFAULT_NEW_TAB_URL,
      title: 'New Tab',
      favicon: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
    }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    return tab
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    tabs.value.splice(idx, 1)
    if (activeTabId.value === id) {
      const next = tabs.value[Math.min(idx, tabs.value.length - 1)]
      activeTabId.value = next ? next.id : ''
    }
  }

  function selectTab(id: string) {
    if (tabs.value.some((t) => t.id === id)) activeTabId.value = id
  }

  function updateTab(id: string, patch: Partial<BrowserTab>) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) Object.assign(tab, patch)
  }

  function openPanel() {
    panelOpen.value = true
    if (tabs.value.length === 0) newTab()
  }

  function closePanel() {
    panelOpen.value = false
  }

  function togglePanel() {
    if (panelOpen.value) closePanel()
    else openPanel()
  }

  function setPanelWidthPct(pct: number) {
    panelWidthPct.value = Math.min(75, Math.max(20, pct))
    localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidthPct.value))
  }

  function setAiControlEnabled(enabled: boolean) {
    aiControlEnabled.value = enabled
    localStorage.setItem(AI_CONTROL_KEY, enabled ? 'true' : 'false')
  }

  async function respondToDownload(id: string, allow: boolean) {
    const dl = downloads.value.find((d) => d.id === id)
    if (dl) dl.state = allow ? 'downloading' : 'cancelled'
    try {
      const res = await ipc.invoke('browser:download:respond', { id, allow })
      if (dl && res?.savePath) dl.savePath = res.savePath
    } catch {
      if (dl) dl.state = 'interrupted'
    }
  }

  let ipcWired = false
  function wireIpcEvents() {
    if (ipcWired) return
    ipcWired = true

    ipc.on('browser:openUrl', (_event: any, payload: { url: string }) => {
      if (!payload?.url) return
      openPanel()
      newTab(payload.url)
    })

    ipc.on('browser:download:request', (_event: any, payload: any) => {
      if (!payload?.id) return
      downloads.value.push({
        id: payload.id,
        filename: payload.filename || 'download',
        url: payload.url || '',
        totalBytes: Number(payload.totalBytes) || 0,
        receivedBytes: 0,
        state: 'pending',
      })
    })

    ipc.on('browser:download:progress', (_event: any, payload: any) => {
      const dl = downloads.value.find((d) => d.id === payload?.id)
      if (!dl || dl.state === 'pending') return
      dl.receivedBytes = Number(payload.receivedBytes) || 0
      if (Number(payload.totalBytes) > 0) dl.totalBytes = Number(payload.totalBytes)
    })

    ipc.on('browser:download:done', (_event: any, payload: any) => {
      const dl = downloads.value.find((d) => d.id === payload?.id)
      if (!dl) return
      if (dl.state === 'cancelled') return
      dl.state = payload?.state === 'completed' ? 'completed' : payload?.state === 'cancelled' ? 'cancelled' : 'interrupted'
      if (payload?.savePath) dl.savePath = payload.savePath
    })
  }

  function dismissDownload(id: string) {
    const idx = downloads.value.findIndex((d) => d.id === id)
    if (idx !== -1) downloads.value.splice(idx, 1)
  }

  // ── Tab state persistence ──────────────────────────────────────────────────
  /** Save current tab URLs and active tab to localStorage so they survive restart.
   *  The active tab is stored by index, not id: tab ids are regenerated on every
   *  launch, so a saved id would never match a restored tab. */
  function saveTabState() {
    try {
      const urls = tabs.value.map((t) => t.url)
      const activeIdx = tabs.value.findIndex((t) => t.id === activeTabId.value)
      localStorage.setItem(BROWSER_TABS_KEY, JSON.stringify(urls))
      localStorage.setItem(BROWSER_ACTIVE_TAB_KEY, String(Math.max(0, activeIdx)))
    } catch { /* localStorage full or unavailable — best effort */ }
  }

  /** Load previously saved tab URLs from localStorage. */
  function loadSavedTabUrls(): string[] {
    try {
      const raw = localStorage.getItem(BROWSER_TABS_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : []
    } catch { return [] }
  }

  /** Load saved active tab index from localStorage. */
  function loadSavedActiveTabIndex(): number {
    try {
      const n = Number(localStorage.getItem(BROWSER_ACTIVE_TAB_KEY))
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
    } catch { return 0 }
  }

  /** Re-create tabs from saved state. Idempotent within a launch: only the first
   *  call rebuilds from localStorage, so re-mounting the panel keeps live tabs. */
  function restoreSavedTabs() {
    if (hasRestored.value) {
      // Already restored this session — just ensure there is something to show.
      if (tabs.value.length === 0) newTab()
      return
    }
    hasRestored.value = true

    const urls = loadSavedTabUrls()
    if (urls.length === 0) {
      // No saved state — start with a fresh blank tab
      if (tabs.value.length === 0) newTab()
      return
    }
    // Clear any existing tabs (e.g. the default one created by openPanel)
    tabs.value = []
    activeTabId.value = ''
    // Re-create tabs from saved URLs. Title shows the host until the tab is
    // lazily mounted and reports its real title.
    for (const url of urls) {
      const tab = newTab(url)
      if (url !== DEFAULT_NEW_TAB_URL) tab.title = hostLabel(url)
    }
    // Restore the previously active tab by index.
    const idx = Math.min(loadSavedActiveTabIndex(), tabs.value.length - 1)
    if (tabs.value[idx]) activeTabId.value = tabs.value[idx].id
    // If there was a saved session, keep the panel open.
    panelOpen.value = true
  }

  return {
    panelOpen,
    panelWidthPct,
    aiControlEnabled,
    hasRestored,
    tabs,
    activeTabId,
    activeTab,
    downloads,
    pendingDownloads,
    newTab,
    closeTab,
    selectTab,
    updateTab,
    openPanel,
    closePanel,
    togglePanel,
    setPanelWidthPct,
    setAiControlEnabled,
    respondToDownload,
    dismissDownload,
    wireIpcEvents,
    saveTabState,
    restoreSavedTabs,
  }
})
