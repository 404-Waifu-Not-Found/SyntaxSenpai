<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useBrowserStore } from '../stores/browser'
const store = useWorkspaceStore(), browser = useBrowserStore()
const DiffPreview = defineAsyncComponent(() => import('./workspace/DiffPreview.vue'))
const tabs = ['Changes', 'Files', 'Checks', 'Terminal', 'Browser', 'Computer']
const width = ref(Number(localStorage.getItem('syntax-workspace-width')) || 460)
const selected = ref<any>(null), before = ref(''), after = ref(''), error = ref('')
const ipc = () => (window as any).electron?.ipcRenderer
const activity = computed(() => store.events.filter(e => ['tool.start', 'tool.result', 'file.edit', 'error', 'policy.blocked'].includes(e.type)).slice(-80))
const actions = computed(() => store.events.filter(e => e.type === 'tool.start' && e.payload.name.startsWith('computer_')).slice(-15))
async function preview(change: any) {
  selected.value = change; error.value = ''; before.value = ''; after.value = ''
  if (change.binary || change.large) return
  try { [before.value, after.value] = await Promise.all([ipc().invoke('runs:blob', change.beforeRef), ipc().invoke('runs:blob', change.afterRef)]) } catch (e) { error.value = String(e) }
}
async function capture() { try { store.computer = await ipc().invoke('computer:observe') } catch(e) { error.value = String(e) } }
function resize(event: PointerEvent) {
  const x = event.clientX, initial = width.value
  const move = (e: PointerEvent) => { width.value = Math.min(window.innerWidth * .75, Math.max(300, initial + x - e.clientX)) }
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); localStorage.setItem('syntax-workspace-width', String(width.value)) }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true })
}
watch(() => store.workingTree, () => { void store.refreshChanges(); selected.value = null })
watch(() => store.tab, t => { if (t === 'Computer') void store.status() })
watch(() => store.selectedRunId, () => { selected.value = null })
</script>
<template>
  <aside v-if="store.open" class="workspace-panel" :style="{ width: width + 'px' }" aria-label="Agent workspace">
    <div class="workspace-resize" role="separator" aria-label="Resize workspace" @pointerdown.prevent="resize" />
    <header><div><b>{{ store.run?.workspace?.split('/').pop() || 'Workspace' }}</b><small>{{ store.run?.status || 'Ready' }}</small></div><button aria-label="Close workspace" @click="store.open = false">×</button></header>
    <nav aria-label="Workspace tabs"><button v-for="name in tabs" :key="name" :class="{ active: store.tab === name }" @click="store.tab = name">{{ name }}</button></nav>
    <div v-if="store.run && !store.run.endedAt" class="run-controls"><button @click="store.control(store.run.status === 'paused' ? 'resume' : 'pause')">{{ store.run.status === 'paused' ? 'Resume' : 'Pause' }}</button><button @click="store.control('stop')">Stop task</button><span>{{ store.run.iterations }} model calls</span></div>
    <div class="workspace-body">
      <template v-if="store.tab === 'Changes' || store.tab === 'Files'">
        <div class="change-heading"><select v-model="store.workingTree" aria-label="Change baseline"><option :value="false">This task</option><option :value="true">Working tree</option></select><button @click="store.refreshChanges">↻</button><span>{{ store.changes.length }} files <em>+{{ store.totals.additions }}</em> <i>−{{ store.totals.deletions }}</i>{{ store.totals.unknown ? ' + non-text changes' : '' }}</span></div>
        <p v-if="!store.changes.length" class="empty">File changes will appear here after the first edit.</p>
        <button v-for="file in store.changes" :key="file.path" class="file-row" @click="preview(file)"><span class="file-status">{{ file.operation[0].toUpperCase() }}</span><span class="file-name">{{ file.path.replace((store.run?.workspace || '') + '/', '') }}<small v-if="file.preExisting || file.origin !== 'agent'">{{ file.preExisting ? 'Pre-existing changes · ' : '' }}{{ file.origin }}</small></span><span v-if="file.additions !== null"><em>+{{ file.additions }}</em> <i>−{{ file.deletions }}</i></span><span v-else>{{ file.binary ? 'Binary' : 'Large file' }}</span></button>
        <template v-if="selected"><div class="preview-heading"><b>{{ selected.path.split('/').pop() }}</b><button @click="ipc().invoke('runs:open-file', selected.path)">Open in editor ↗</button></div><p v-if="error">{{ error }}</p><p v-else-if="selected.binary || selected.large">Preview unavailable for this file. Counts are not estimated.</p><DiffPreview v-else :before="before" :after="after" :path="selected.path" /></template>
        <details v-for="event in activity" :key="event.sequence" class="activity" :open="event.type === 'error' || event.type === 'policy.blocked' || (event.type === 'tool.result' && /^Error|BLOCKED/.test(event.payload.content))"><summary><span v-if="event.type === 'file.edit'">✓ Edited {{ event.payload.path.split('/').pop() }} <em>+{{ event.payload.additions ?? '?' }}</em> <i>−{{ event.payload.deletions ?? '?' }}</i></span><span v-else-if="event.type === 'tool.start'">● {{ event.payload.name }}</span><span v-else-if="event.type === 'tool.result'">{{ /^Error|BLOCKED/.test(event.payload.content) ? '✕' : '✓' }} {{ event.payload.call.name }}</span><span v-else>{{ event.type }}</span></summary><pre>{{ event.payload.content || event.payload.reason || JSON.stringify(event.payload, null, 2) }}</pre></details>
      </template>
      <template v-else-if="store.tab === 'Checks'"><p v-if="!store.checks.length" class="empty">No verification evidence yet.</p><article v-for="check in store.checks" :key="check.id" class="activity"><b>{{ check.status }} · {{ check.freshness }}</b><pre>{{ check.command }}</pre><small>Exit {{ check.exitCode ?? 'pending' }} · Revision {{ check.revision.slice(0, 10) }}</small></article></template>
      <template v-else-if="store.tab === 'Terminal'"><p v-if="!Object.keys(store.processes).length" class="empty">No command sessions yet.</p><article v-for="session in store.processes" :key="session.id" class="activity"><b>{{ session.status }} <span v-if="session.exitCode !== null">· Exit {{ session.exitCode }}</span></b><pre>$ {{ session.command }}
{{ session.output }}</pre></article></template>
      <template v-else-if="store.tab === 'Browser'"><p class="empty">Inspect the agent’s embedded browser and its open tabs.</p><button class="action-button" @click="browser.openPanel()">Open browser</button><div v-for="t in browser.tabs" :key="t.id" class="activity">{{ t.title }}<small>{{ t.url }}</small></div></template>
      <template v-else-if="store.tab === 'Computer'"><div class="computer-status"><b>{{ store.computer?.appName || 'Native computer control' }}</b><p>{{ store.capability?.reason }}</p><p v-if="store.setupStatus">{{ store.setupStatus.available ? `Accessibility: ${store.setupStatus.accessibility ? 'granted' : 'not granted'} · Screen Recording: ${store.setupStatus.screenRecording}` : store.setupStatus.reason }}</p><div class="run-controls"><button @click="store.setup('accessibility')">Accessibility setup</button><button @click="store.setup('screen')">Screen Recording</button><button @click="store.status">Refresh</button><button @click="capture">Capture now</button></div></div><img v-if="store.computer?.screenshot" :src="store.computer.screenshot" alt="Latest observed desktop" class="computer-image" /><p v-else class="empty">No desktop capture in this run.</p><button class="emergency" @click="ipc().invoke('computer:stop')">Emergency stop · ⌘⇧Esc</button><article v-for="a in actions" :key="a.sequence" class="activity">{{ a.payload.name }}<small>{{ new Date(a.timestamp).toLocaleTimeString() }}</small></article></template>
    </div>
  </aside>
</template>
<style scoped>
.workspace-panel{position:relative;flex-shrink:0;min-width:300px;max-width:75vw;height:100%;display:flex;flex-direction:column;border-left:1px solid #ffffff18;background:var(--color-neutral-900,#161b25);color:inherit;font-size:13px;z-index:20}.workspace-resize{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:ew-resize}header{display:flex;justify-content:space-between;align-items:center;padding:16px}header div{display:flex;flex-direction:column;gap:4px}small{display:block;font-size:11px;opacity:.65}header button{font-size:22px}nav{display:flex;overflow:auto;padding:0 8px;border-bottom:1px solid #ffffff18}nav button{padding:10px 8px;opacity:.6;border-bottom:2px solid transparent}nav .active{opacity:1;border-color:#a5b4fc}.workspace-body{overflow:auto;flex:1;padding:12px}.run-controls{display:flex;gap:10px;flex-wrap:wrap;padding:10px 12px;font-size:11px}.run-controls button,.action-button{border:1px solid #ffffff30;border-radius:6px;padding:5px 8px}.run-controls span{margin-left:auto;opacity:.65}.change-heading{display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:11px}.change-heading select{background:transparent;max-width:120px}.change-heading span{margin-left:auto}em{font-style:normal;color:#6ee7b7}i{font-style:normal;color:#fca5a5}.file-row{display:flex;width:100%;align-items:center;text-align:left;gap:10px;padding:10px 4px;border-bottom:1px solid #ffffff0d}.file-row:hover{background:#ffffff08}.file-name{flex:1;overflow-wrap:anywhere}.file-status{opacity:.5}.preview-heading{display:flex;justify-content:space-between;gap:8px;padding:15px 0;font-size:11px}.activity{border:1px solid #ffffff12;border-radius:8px;margin-top:10px;padding:10px}.activity pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;font-size:11px;opacity:.8;padding-top:8px}.activity summary{cursor:pointer}.empty{opacity:.6;line-height:1.7;padding:24px 4px}.computer-status{line-height:1.7}.computer-image{width:100%;border-radius:8px;margin:10px 0}.emergency{background:#7f1d1d;border:1px solid #fca5a580;border-radius:7px;padding:10px;width:100%;margin-top:10px}@media(max-width:1000px){.workspace-panel{position:fixed;right:0;top:0;bottom:0;max-width:95vw;box-shadow:-12px 0 40px #0008}.workspace-resize{display:none}}
</style>
