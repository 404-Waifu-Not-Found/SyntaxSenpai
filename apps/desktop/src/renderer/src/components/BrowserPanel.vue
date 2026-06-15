<script setup lang="ts">
import { ref, reactive, watch, computed, onBeforeUnmount, onMounted } from 'vue'
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

type AgentCursorState = 'moving' | 'clicking' | 'typing' | 'loading' | 'hidden'
const agentCursor = ref({ x: 48, y: 42, state: 'hidden' as AgentCursorState, visible: false })
let agentCursorHideTimer: ReturnType<typeof setTimeout> | null = null

function onAgentCursor(event: Event) {
  const detail = (event as CustomEvent).detail || {}
  if (agentCursorHideTimer) clearTimeout(agentCursorHideTimer)
  agentCursor.value = {
    x: Number.isFinite(detail.x) ? detail.x : agentCursor.value.x,
    y: Number.isFinite(detail.y) ? detail.y : agentCursor.value.y,
    state: detail.state || 'moving',
    visible: detail.state !== 'hidden',
  }
  if (detail.state !== 'loading') {
    agentCursorHideTimer = setTimeout(() => {
      agentCursor.value.visible = false
    }, 1800)
  }
}

// ── Tab state persistence ──────────────────────────────────────────────────
// Auto-save tab state whenever tabs or active tab changes (debounced).
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    browser.saveTabState()
    saveTimer = null
  }, 500)
}
// Watch tabs array structure (add/remove/reorder) and active tab
watch(
  [() => browser.tabs.map((t) => t.url + '|' + t.id), () => browser.activeTabId],
  () => scheduleSave(),
  { deep: true },
)

// Restore saved tabs on first mount only. restoreSavedTabs() is idempotent per
// launch, so re-opening the panel keeps live tabs instead of reloading them all.
onMounted(() => {
  window.addEventListener('syntax-senpai:browser-cursor', onAgentCursor)
  if (browser.hasRestored) return
  // Small delay to ensure the component is fully rendered before restoring webviews
  setTimeout(() => browser.restoreSavedTabs(), 100)
})

// ── lazy tab mounting ─────────────────────────────────────────────────────────
// A <webview> is only created once its tab has been activated. A restored
// session of N tabs therefore loads one Chromium guest (the active tab) instead
// of N — the rest stay weightless until the user (or agent) selects them.
const mountedTabs = reactive(new Set<string>())
function ensureMounted(tabId: string) {
  if (tabId) mountedTabs.add(tabId)
}

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
        mountedTabs.delete(known)
        unregisterWebview(known)
      }
    }
  },
)

watch(
  () => browser.activeTabId,
  (id) => {
    ensureMounted(id)
    setActiveTab(id)
  },
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
  window.removeEventListener('syntax-senpai:browser-cursor', onAgentCursor)
  if (agentCursorHideTimer) clearTimeout(agentCursorHideTimer)
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

    <!-- Webviews: only mounted (ever-activated) tabs exist as guests; the rest
         stay weightless until selected. Mounted-but-inactive tabs are hidden via
         visibility (not display:none, which would force a reload). -->
    <div class="flex-1 relative min-h-0 bg-white">
      <template v-for="tab in browser.tabs" :key="tab.id">
        <webview
          v-if="mountedTabs.has(tab.id)"
          :ref="(el: any) => onWebviewRef(tab.id, el)"
          :data-tab-id="tab.id"
          :src="initialSrcFor(tab)"
          partition="persist:browser"
          webpreferences="contextIsolation=yes,sandbox=yes"
          class="absolute inset-0 w-full h-full"
          :style="{ visibility: tab.id === browser.activeTabId ? 'visible' : 'hidden' }"
        />
      </template>
      <div
        class="ai-browser-cursor"
        :class="[
          `ai-browser-cursor--${agentCursor.state}`,
          { 'ai-browser-cursor--visible': agentCursor.visible },
        ]"
        :style="{ transform: `translate3d(${agentCursor.x}px, ${agentCursor.y}px, 0)` }"
        aria-hidden="true"
      >
        <div class="ai-browser-cursor__pointer">
          <span class="ai-browser-cursor__core" />
        </div>
        <span class="ai-browser-cursor__label">AI</span>
        <span class="ai-browser-cursor__ring" />
      </div>
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

<style scoped>
.ai-browser-cursor {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 40;
  width: 1px;
  height: 1px;
  pointer-events: none;
  opacity: 0;
  transition:
    transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 160ms ease;
  will-change: transform, opacity;
}

.ai-browser-cursor--visible {
  opacity: 1;
}

.ai-browser-cursor__pointer {
  position: absolute;
  left: -10px;
  top: -10px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.82);
  border-radius: 999px;
  background: rgba(17, 17, 20, 0.9);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
}

.ai-browser-cursor__core {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #f472b6;
  box-shadow: 0 0 12px rgba(244, 114, 182, 0.72);
}

.ai-browser-cursor__label {
  position: absolute;
  left: 12px;
  top: 11px;
  min-width: 28px;
  padding: 4px 7px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 9px;
  background: rgba(17, 17, 20, 0.9);
  color: rgba(255, 255, 255, 0.94);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.08em;
  text-align: center;
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
}

.ai-browser-cursor__ring {
  position: absolute;
  left: -17px;
  top: -17px;
  width: 34px;
  height: 34px;
  border: 1.5px solid rgba(244, 114, 182, 0.72);
  border-radius: 999px;
  opacity: 0;
  transform: scale(0.5);
}

.ai-browser-cursor--clicking .ai-browser-cursor__pointer {
  transform: scale(0.82);
}

.ai-browser-cursor--clicking .ai-browser-cursor__ring {
  animation: ai-cursor-click 520ms cubic-bezier(0.16, 1, 0.3, 1);
}

.ai-browser-cursor--typing .ai-browser-cursor__pointer {
  animation: ai-cursor-type 680ms ease-in-out infinite;
}

.ai-browser-cursor--typing .ai-browser-cursor__label::after {
  content: ' typing';
  color: #f9a8d4;
  font-weight: 600;
  letter-spacing: 0;
}

.ai-browser-cursor--loading .ai-browser-cursor__ring {
  opacity: 1;
  border-color: transparent;
  border-top-color: #f472b6;
  border-right-color: rgba(244, 114, 182, 0.32);
  animation: ai-cursor-orbit 760ms linear infinite;
}

.ai-browser-cursor--loading .ai-browser-cursor__label::after {
  content: ' navigating';
  color: #f9a8d4;
  font-weight: 600;
  letter-spacing: 0;
}

@keyframes ai-cursor-click {
  0% { opacity: 0.9; transform: scale(0.45); }
  100% { opacity: 0; transform: scale(1.65); }
}

@keyframes ai-cursor-type {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.88); }
}

@keyframes ai-cursor-orbit {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ai-browser-cursor {
    transition: opacity 100ms linear;
  }

  .ai-browser-cursor__pointer,
  .ai-browser-cursor__ring {
    animation: none !important;
    transition: none;
  }
}
</style>
