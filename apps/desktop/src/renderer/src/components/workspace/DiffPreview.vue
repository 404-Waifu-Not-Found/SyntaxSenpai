<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
const props = defineProps<{ before: string; after: string; path: string }>()
const host = ref<HTMLElement>(), mode = ref<'unified' | 'split' | 'file'>('unified')
let view: MergeView | EditorView | undefined
async function mount() {
  if (!host.value) return
  view?.destroy(); host.value.replaceChildren()
  const suffix = props.path.split('.').pop()
  let language: any = []
  if (['js', 'ts', 'tsx', 'jsx'].includes(suffix || '')) language = (await import('@codemirror/lang-javascript')).javascript({ typescript: suffix === 'ts' || suffix === 'tsx', jsx: suffix === 'jsx' || suffix === 'tsx' })
  else if (suffix === 'json') language = (await import('@codemirror/lang-json')).json()
  else if (suffix === 'css') language = (await import('@codemirror/lang-css')).css()
  else if (suffix === 'py') language = (await import('@codemirror/lang-python')).python()
  else if (suffix === 'md') language = (await import('@codemirror/lang-markdown')).markdown()
  else if (['html', 'vue'].includes(suffix || '')) language = (await import('@codemirror/lang-html')).html()
  if (!host.value) return
  const extensions = [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(), syntaxHighlighting(defaultHighlightStyle), language, EditorView.theme({ '&': { fontSize: '12px', height: '100%' }, '.cm-scroller': { overflow: 'auto' } })]
  if (mode.value === 'split') view = new MergeView({ a: { doc: props.before, extensions }, b: { doc: props.after, extensions }, parent: host.value, collapseUnchanged: { margin: 3, minSize: 8 }, highlightChanges: true })
  else view = new EditorView({ parent: host.value, doc: props.after, extensions: [...extensions, ...(mode.value === 'unified' ? [unifiedMergeView({ original: props.before, mergeControls: false, collapseUnchanged: { margin: 3, minSize: 8 } })] : [])] })
}
function nextHunk() { const nodes = host.value?.querySelectorAll('.cm-changedLine, .cm-deletedChunk'); const node = Array.from(nodes || []).find(n => n.getBoundingClientRect().top > (host.value?.getBoundingClientRect().top || 0) + 45) || nodes?.[0]; node?.scrollIntoView({ block: 'center' }) }
onMounted(mount); watch(() => [props.before, props.after, props.path, mode.value], mount); onBeforeUnmount(() => view?.destroy())
</script>
<template><div class="diff-preview"><div class="diff-toolbar"><select v-model="mode" aria-label="Diff layout"><option value="unified">Unified</option><option value="split">Split</option><option value="file">Full file</option></select><button @click="nextHunk">Next hunk ↓</button></div><div ref="host" class="diff-host" /></div></template>
<style scoped>.diff-preview{min-height:240px;flex:1;display:flex;flex-direction:column;background:#fafafa;color:#1f2937;border-radius:8px;overflow:hidden}.diff-toolbar{display:flex;gap:12px;padding:8px;background:#eef1f5;font-size:12px}.diff-host{height:48vh;overflow:auto}.diff-toolbar select{background:transparent}</style>
