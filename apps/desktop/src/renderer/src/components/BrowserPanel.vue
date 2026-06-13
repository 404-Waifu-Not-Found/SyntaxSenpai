<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { useBrowserStore, normalizeUrlInput, type BrowserTab } from '../stores/browser'
import {
  registerWebview,
  unregisterWebview,
  setActiveTab,
  isAllowedBrowserUrl,
  type WebviewElement,
} from '../browser/controller'

const browser = useBrowserStore()
browser.wireIpcEvents()

// ── webview lifecycle ────────────────────────────────────────────────────────
// :src must stay the URL the tab was created with — rebinding it on every
// store update would reload the page. Navigation happens via loadURL only.
const initialSrcByTab = new Map<string, string>()
const wiredTabs = new Set<string>()

function initialSrcFor(tab: BrowserTab): string {
  if (!initialSrcByTab.has(tab.id)) {
    const src = isAllowedBrowserUrl(tab.url) ? tab.url : 'about:blank'
    initialSrcByTab.set(tab.id, src)
  }
  return initialSrcByTab.get(tab.id)!
}

function onWebviewRef(tabId: string, el: any) {
  if (!el) return
  const wv = el as WebviewElement
  registerWebview(tabId, wv)
  if (wiredTabs.has(tabId)) return
  wiredTabs.add(tabId)

  const sync = () => {
    try {
      browser.updateTab(tabId, {
        url: wv.getURL(),
        title: wv.getTitle() || wv.getURL(),
        canGoBack: wv.canGoBack(),
        canGoForward: wv.canGoForward(),
      })
    } catch { /* webview not attached yet */ }
  }

  wv.addEventListener('did-start-loading', () => browser.updateTab(tabId, { isLoading: true }))
  wv.addEventListener('did-stop-loading', () => {
    browser.updateTab(tabId, { isLoading: false })
    sync()
  })
  wv.addEventListener('did-navigate', sync)
  wv.addEventListener('did-navigate-in-page', sync)
  wv.addEventListener('page-title-updated', (e: any) => browser.updateTab(tabId, { title: e.title }))
  wv.addEventListener('page-favicon-updated', (e: any) => {
    const icon = Array.isArray(e.favicons) && e.favicons[0] ? e.favicons[0] : ''
    browser.updateTab(tabId, { favicon: icon })
  })
  wv.addEventListener('did-fail-load', (e: any) => {
    // -3 = aborted (normal during redirects); ignore it.
    if (e.errorCode === -3 || !e.isMainFrame) return
    browser.updateTab(tabId, { isLoading: false, title: `Failed to load (${e.errorDescription || e.errorCode})` })
  })
}

watch(
  () => browser.tabs.map((t) => t.id),
  (ids) => {
    for (const known of [...wiredTabs]) {
      if (!ids.includes(known)) {
        wiredTabs.delete(known)
        initialSrcByTab.delete(known)
        unregisterWebview(known)
      }
    }
  },
)

watch(
  () => browser.activeTabId,
  (id) => setActiveTab(id),
  { immediate: true },
)

// ── URL bar ──────────────────────────────────────────────────────────────────
const urlInput = ref('')
const urlFocused = ref(false)

watch(
  () => browser.activeTab?.url,
  (url) => {
    if (!urlFocused.value) urlInput.value = url === 'about:blank' ? '' : url || ''
  },
  { immediate: true },
)

watch(
  () => browser.activeTabId,
  () => {
    const url = browser.activeTab?.url || ''
    urlInput.value = url === 'about:blank' ? '' : url
  },
)

function activeWebview(): WebviewElement | null {
  const id = browser.activeTabId
  if (!id) return null
  const el = document.querySelector(`webview[data-tab-id="${id}"]`)
  return (el as unknown as WebviewElement) || null
}

function submitUrl() {
  const target = normalizeUrlInput(urlInput.value)
  const wv = activeWebview()
  if (!wv) return
  if (target === 'about:blank' || !isAllowedBrowserUrl(target)) return
  wv.loadURL(target).catch(() => { /* surfaced via did-fail-load */ })
  ;(document.activeElement as HTMLElement | null)?.blur?.()
}

const isSecure = computed(() => (browser.activeTab?.url || '').startsWith('https://'))

function goBack() { activeWebview()?.goBack() }
function goForward() { activeWebview()?.goForward() }
function reloadOrStop() {
  const wv = activeWebview()
  if (!wv) return
  if (browser.activeTab?.isLoading) wv.stop()
  else wv.reload()
}

// ── resize divider ───────────────────────────────────────────────────────────
const dragging = ref(false)

function startDrag(e: MouseEvent) {
  e.preventDefault()
  dragging.value = true
  const onMove = (ev: MouseEvent) => {
    const pct = ((window.innerWidth - ev.clientX) / window.innerWidth) * 100
    browser.setPanelWidthPct(pct)
  }
  const onUp = () => {
    dragging.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

onBeforeUnmount(() => {
  for (const id of wiredTabs) unregisterWebview(id)
})

function formatBytes(n: number): string {
  if (!n || n <= 0) return ''
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div
    class="browser-panel relative flex flex-col border-l border-white/10 bg-neutral-950/60 min-w-0"
    :style="{ width: `${browser.panelWidthPct}%` }"
  >
    <!-- Resize handle -->
    <div
      class="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.75 cursor-col-resize z-30 hover:bg-pink-400/40 transition-colors"
      @mousedown="startDrag"
    />
    <!-- While dragging, block the webview from eating mouse events -->
    <div v-if="dragging" class="fixed inset-0 z-50 cursor-col-resize" />

    <!-- Tab strip -->
    <div class="flex items-center gap-1 px-2 pt-2 pb-1 overflow-x-auto shrink-0">
      <button
        v-for="tab in browser.tabs"
        :key="tab.id"
        :class="[
          'group flex items-center gap-1.5 max-w-44 min-w-0 px-2.5 py-1.5 rounded-lg text-xs transition-colors',
          tab.id === browser.activeTabId
            ? 'bg-white/10 text-neutral-100'
            : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200',
        ]"
        :title="tab.title"
        @click="browser.selectTab(tab.id)"
      >
        <img v-if="tab.favicon" :src="tab.favicon" class="w-3.5 h-3.5 shrink-0 rounded-sm" alt="">
        <span v-else-if="tab.isLoading" class="w-3.5 h-3.5 shrink-0 animate-spin text-[10px]">⟳</span>
        <span class="truncate">{{ tab.title || 'New Tab' }}</span>
        <span
          class="shrink-0 opacity-0 group-hover:opacity-100 hover:text-pink-300 transition-opacity px-0.5"
          role="button"
          aria-label="Close tab"
          @click.stop="browser.closeTab(tab.id)"
        >×</span>
      </button>
      <button
        class="px-2 py-1 rounded-lg text-neutral-400 hover:bg-white/5 hover:text-neutral-200 text-sm shrink-0"
        aria-label="New tab"
        title="New tab"
        @click="browser.newTab()"
      >＋</button>
      <div class="flex-1" />
      <button
        class="px-2 py-1 rounded-lg text-neutral-400 hover:bg-white/5 hover:text-neutral-200 text-sm shrink-0"
        aria-label="Close browser panel"
        title="Close browser panel"
        @click="browser.closePanel()"
      >✕</button>
    </div>

    <!-- Toolbar -->
    <div class="flex items-center gap-1.5 px-2 pb-2 shrink-0">
      <button
        class="btn-ghost px-2 py-1 text-sm disabled:opacity-30"
        :disabled="!browser.activeTab?.canGoBack"
        aria-label="Back"
        @click="goBack"
      >◀</button>
      <button
        class="btn-ghost px-2 py-1 text-sm disabled:opacity-30"
        :disabled="!browser.activeTab?.canGoForward"
        aria-label="Forward"
        @click="goForward"
      >▶</button>
      <button
        class="btn-ghost px-2 py-1 text-sm"
        :aria-label="browser.activeTab?.isLoading ? 'Stop' : 'Reload'"
        @click="reloadOrStop"
      >{{ browser.activeTab?.isLoading ? '✕' : '⟳' }}</button>
      <div class="flex-1 flex items-center gap-1.5 rounded-xl bg-neutral-900/80 border border-white/10 px-2.5 py-1.5 min-w-0">
        <span class="text-xs shrink-0" :title="isSecure ? 'Secure (HTTPS)' : 'Not secure'">
          {{ isSecure ? '🔒' : '⚠️' }}
        </span>
        <input
          v-model="urlInput"
          class="flex-1 bg-transparent outline-none text-xs text-neutral-200 placeholder:text-neutral-500 min-w-0"
          placeholder="Search or enter address"
          spellcheck="false"
          aria-label="Address bar"
          @focus="urlFocused = true; ($event.target as HTMLInputElement).select()"
          @blur="urlFocused = false"
          @keydown.enter="submitUrl"
        >
      </div>
    </div>

    <!-- Loading bar -->
    <div class="h-0.5 shrink-0">
      <div
        v-if="browser.activeTab?.isLoading"
        class="h-full w-full bg-gradient-to-r from-pink-400 to-violet-400 animate-pulse"
      />
    </div>

    <!-- Webviews (one per tab, kept alive) -->
    <div class="flex-1 relative min-h-0 bg-white">
      <webview
        v-for="tab in browser.tabs"
        :key="tab.id"
        :ref="(el: any) => onWebviewRef(tab.id, el)"
        :data-tab-id="tab.id"
        :src="initialSrcFor(tab)"
        partition="persist:browser"
        webpreferences="contextIsolation=yes,sandbox=yes"
        class="absolute inset-0 w-full h-full"
        :style="{ visibility: tab.id === browser.activeTabId ? 'visible' : 'hidden' }"
      />
      <div
        v-if="browser.tabs.length === 0"
        class="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm bg-neutral-950"
      >
        Open a tab to start browsing～
      </div>
    </div>

    <!-- Downloads -->
    <div
      v-if="browser.downloads.length > 0"
      class="shrink-0 border-t border-white/10 bg-neutral-950/90 px-3 py-2 space-y-1.5 max-h-40 overflow-y-auto"
    >
      <div
        v-for="dl in browser.downloads"
        :key="dl.id"
        class="flex items-center gap-2 text-xs text-neutral-300"
      >
        <span class="truncate flex-1" :title="dl.url">
          {{ dl.filename }}
          <span v-if="dl.totalBytes" class="text-neutral-500">({{ formatBytes(dl.totalBytes) }})</span>
        </span>
        <template v-if="dl.state === 'pending'">
          <button class="btn-primary px-2 py-0.5 text-[11px]" @click="browser.respondToDownload(dl.id, true)">Save</button>
          <button class="btn-ghost px-2 py-0.5 text-[11px]" @click="browser.respondToDownload(dl.id, false)">Deny</button>
        </template>
        <template v-else-if="dl.state === 'downloading'">
          <span class="text-neutral-500">
            {{ dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) + '%' : formatBytes(dl.receivedBytes) }}
          </span>
        </template>
        <template v-else>
          <span :class="dl.state === 'completed' ? 'text-emerald-300' : 'text-amber-300'">{{ dl.state }}</span>
          <button class="btn-ghost px-1.5 py-0.5 text-[11px]" aria-label="Dismiss" @click="browser.dismissDownload(dl.id)">×</button>
        </template>
      </div>
    </div>
  </div>
</template>
