import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AgentRun, RunEvent, FileChange, CheckResult, ProcessSession } from '@syntax-senpai/ai-core'
const ipc = () => (window as any).electron?.ipcRenderer
export function codingIntent(text: string, hasWorkspace: boolean) {
  if (/^(explain|what is|解释|什么是)/i.test(text.trim()) && !/fix|implement|修改|实现/.test(text)) return false
  return hasWorkspace || /(?:implement|debug|refactor|commit|fix (?:the |a )?(?:bug|code)|编程|修改.*代码|修复|实现|提交代码|[\w/-]+\.(?:ts|js|vue|py|rs|go|swift)|(?:Type|Syntax|Reference)Error)/i.test(text)
}
export const useWorkspaceStore = defineStore('workspace', () => {
  const conversationId = ref<string | null>(null), runs = ref<AgentRun[]>([]), events = ref<RunEvent[]>([])
  const mode = ref<'auto' | 'chat' | 'code'>('auto'), tab = ref('Changes'), open = ref(false)
  const selectedRunId = ref(''), changes = ref<FileChange[]>([]), workingTree = ref(false), checks = ref<CheckResult[]>([])
  const processes = ref<Record<string, ProcessSession>>({}), computer = ref<any>(null), capability = ref<any>(null), setupStatus = ref<any>(null)
  const run = computed(() => runs.value.find(r => r.id === selectedRunId.value))
  const totals = computed(() => ({ additions: changes.value.reduce((n, c) => n + (c.additions || 0), 0), deletions: changes.value.reduce((n, c) => n + (c.deletions || 0), 0), unknown: changes.value.some(c => c.additions === null) }))
  let subscribed = false
  const cursors = new Map<string, number>(), answeredUI = new Set<string>()
  async function refreshChanges() { if (selectedRunId.value) changes.value = await ipc()?.invoke('runs:changes', selectedRunId.value, workingTree.value) || [] }
  function receive(event: RunEvent) {
    if (event.sequence <= (cursors.get(event.runId) || 0)) return
    cursors.set(event.runId, event.sequence)
    if (event.type === 'run') {
      const item = event.payload as AgentRun
      if (item.conversationId !== conversationId.value) return
      const index = runs.value.findIndex(r => r.id === item.id)
      if (index < 0) { runs.value.unshift(item); selectedRunId.value = item.id; events.value = []; changes.value = []; checks.value = []; processes.value = {}; computer.value = null }
      else runs.value[index] = item
    }
    if (event.runId !== selectedRunId.value) return
    events.value.push(event)
    if (event.type === 'changes' && !workingTree.value) changes.value = event.payload
    if (event.type === 'checks') checks.value = event.payload
    if (event.type === 'capabilities') capability.value = event.payload
    if (event.type === 'computer' && event.payload.screenshotRef && !event.payload.screenshot) void ipc()?.invoke('runs:image', event.payload.id).then((image: string) => { if (computer.value?.id === event.payload.id) computer.value.screenshot = image })
    if (event.type === 'computer') { computer.value = { ...(computer.value || {}), ...event.payload }; if (mode.value !== 'chat') { open.value = true; tab.value = 'Computer' } }
    if (event.type === 'process') processes.value[event.payload.id] = event.payload
    if (event.type === 'process.output') { const p = processes.value[event.payload.id]; if (p) { p.output = (p.output + event.payload.chunk).slice(-64000); p.cursor = event.payload.cursor } }
    if (event.type === 'file.edit' && mode.value !== 'chat') { open.value = true; tab.value = 'Changes' }
  }
  async function connect() {
    if (subscribed || !ipc()) return
    subscribed = true
    ipc().on('runs:event', (event: RunEvent) => {
      receive(event)
      if (event.type === 'ui.request') {
        const { requestId, call } = event.payload
        if (answeredUI.has(requestId)) return
        answeredUI.add(requestId)
        void import('../agent-tools').then(async tools => {
          const content = await tools.executeToolCall(call)
          const image = tools.consumePendingBrowserScreenshot()
          await ipc().invoke('runs:ui-result', requestId, { content, image })
        }).catch(error => ipc().invoke('runs:ui-result', requestId, { success: false, error: String(error) }))
      }
    })
  }
  async function bind(id: string | null) {
    await connect(); conversationId.value = id
    runs.value = id ? await ipc()?.invoke('runs:list', id) || [] : []
    selectedRunId.value = runs.value[0]?.id || ''; events.value = []; changes.value = []; checks.value = []; processes.value = {}; computer.value = null
    const saved = id ? await ipc()?.invoke('store:getConversation', id) : null
    mode.value = saved?.conversation?.presentation || 'auto'
    if (selectedRunId.value) {
      cursors.delete(selectedRunId.value)
      for (const event of await ipc().invoke('runs:replay', selectedRunId.value, 0)) receive(event)
      await refreshChanges()
    }
    open.value = mode.value === 'code' || (mode.value === 'auto' && !!(run.value?.workspace || changes.value.length || computer.value))
  }
  async function setMode(value: 'auto' | 'chat' | 'code') {
    mode.value = value; open.value = value === 'code' || value === 'auto' && !!run.value?.workspace
    if (conversationId.value) await ipc()?.invoke('store:updateConversation', conversationId.value, { presentation: value })
  }
  async function control(action: string) { if (selectedRunId.value) await ipc()?.invoke('runs:control', selectedRunId.value, action) }
  async function status() { setupStatus.value = await ipc()?.invoke('computer:status') }
  async function setup(kind: string) { await ipc()?.invoke('computer:setup', kind); await status() }
  return { conversationId, runs, events, mode, tab, open, selectedRunId, run, changes, workingTree, checks, processes, computer, capability, setupStatus, totals, bind, connect, setMode, refreshChanges, control, status, setup }
})
