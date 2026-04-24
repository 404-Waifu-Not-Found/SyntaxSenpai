<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useIpc } from '../composables/use-ipc'
import type { ActiveCodingRepo, RepoListItem, RepoInfo } from '../types/coding-session'

const props = defineProps<{
  visible: boolean
  mode: 'initial' | 'switch'
  currentRepo: ActiveCodingRepo | null
}>()

const emit = defineEmits<{
  close: []
  selected: [repo: ActiveCodingRepo]
  keepCurrent: []
}>()

const { invoke } = useIpc()

const loading = ref(false)
const error = ref<string | null>(null)
const repos = ref<RepoListItem[]>([])
const filter = ref('')
const selectedPath = ref<string | null>(null)
const loadingInfo = ref(false)

const filteredRepos = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  if (!needle) return repos.value
  return repos.value.filter((r) =>
    r.name.toLowerCase().includes(needle) ||
    r.path.toLowerCase().includes(needle),
  )
})

function relativeTime(ts: number | null): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 0) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

async function runScan() {
  loading.value = true
  error.value = null
  repos.value = []
  selectedPath.value = null
  try {
    const res = await invoke('repo:scan')
    if (res?.success) {
      repos.value = res.repos ?? []
    } else {
      error.value = res?.error || 'Scan failed.'
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function useSelected() {
  if (!selectedPath.value) return
  loadingInfo.value = true
  error.value = null
  try {
    const res = await invoke('repo:info', selectedPath.value)
    if (!res?.success) {
      error.value = res?.error || 'Failed to read repository info.'
      return
    }
    const info = res.info as RepoInfo
    const active: ActiveCodingRepo = { ...info, activatedAt: Date.now() }
    emit('selected', active)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loadingInfo.value = false
  }
}

function pickRepo(repo: RepoListItem) {
  selectedPath.value = repo.path
}

function onKeepCurrent() {
  emit('keepCurrent')
  emit('close')
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      filter.value = ''
      runScan()
    }
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-backdrop">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-[60]"
        @click.self="emit('close')"
      >
        <div
          class="modal-glass rounded-t-3xl sm:rounded-2xl p-5 max-w-lg w-full mx-0 sm:mx-4 flex flex-col"
          style="max-height: 80vh;"
        >
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-lg font-bold text-white">
              {{ mode === 'switch' ? 'Switch repository' : 'Select a repository' }}
            </h2>
            <button
              class="text-neutral-400 hover:text-white transition-colors"
              aria-label="Close"
              @click="emit('close')"
            >
              <span class="text-xl leading-none">×</span>
            </button>
          </div>

          <div
            v-if="mode === 'switch' && currentRepo"
            class="mb-3 p-3 rounded-lg bg-primary-500/10 ring-1 ring-primary-500/30 flex items-center justify-between gap-3"
          >
            <div class="min-w-0">
              <p class="text-xs text-primary-200/80">Currently coding in</p>
              <p class="text-sm font-semibold text-white truncate">
                {{ currentRepo.name }}
                <span class="text-xs text-neutral-400 font-normal">· {{ currentRepo.branch ?? 'HEAD' }}</span>
              </p>
            </div>
            <button
              class="text-xs px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-neutral-200 whitespace-nowrap"
              @click="onKeepCurrent"
            >
              Keep current
            </button>
          </div>

          <input
            v-model="filter"
            type="text"
            placeholder="Filter by name or path…"
            class="w-full px-3 py-2 mb-3 rounded-lg bg-white/5 text-sm text-white placeholder-neutral-500 ring-1 ring-white/10 focus:outline-none focus:ring-primary-500/50"
          />

          <div class="flex-1 overflow-y-auto -mx-1 px-1" style="min-height: 200px;">
            <div v-if="loading" class="py-12 flex flex-col items-center gap-3">
              <div class="w-6 h-6 border-2 border-primary-500/40 border-t-primary-500 rounded-full animate-spin" />
              <p class="text-sm text-neutral-400">Scanning for repositories…</p>
            </div>

            <div v-else-if="error" class="py-8 text-center">
              <p class="text-sm text-red-400 mb-3">{{ error }}</p>
              <button class="text-xs px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-neutral-200" @click="runScan">
                Try again
              </button>
            </div>

            <div v-else-if="repos.length === 0" class="py-8 text-center">
              <p class="text-sm text-neutral-400 leading-relaxed">
                No git repositories found in the usual places.<br />
                Check ~/Documents, ~/Projects, ~/code, ~/dev, ~/repos, or ~/src and try again.
              </p>
            </div>

            <div v-else-if="filteredRepos.length === 0" class="py-8 text-center">
              <p class="text-sm text-neutral-400">No matches for "{{ filter }}".</p>
            </div>

            <ul v-else class="space-y-1">
              <li
                v-for="repo in filteredRepos"
                :key="repo.path"
                class="px-3 py-2 rounded-lg cursor-pointer transition-colors"
                :class="selectedPath === repo.path
                  ? 'bg-primary-500/20 ring-1 ring-primary-500/40'
                  : 'hover:bg-white/5'"
                @click="pickRepo(repo)"
                @dblclick="pickRepo(repo); useSelected()"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-white truncate">{{ repo.name }}</p>
                    <p class="text-[10px] font-mono text-neutral-500 truncate">{{ repo.parentDir }}</p>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span
                      v-if="repo.branch"
                      class="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-neutral-300 font-mono"
                    >
                      {{ repo.branch }}
                    </span>
                    <span class="text-[10px] text-neutral-500 min-w-[50px] text-right">
                      {{ relativeTime(repo.lastCommitTimestamp) }}
                    </span>
                  </div>
                </div>
              </li>
            </ul>
          </div>

          <div class="pt-3 mt-3 border-t border-white/5 flex items-center justify-end gap-2">
            <button
              class="text-xs px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-neutral-200"
              :disabled="loadingInfo"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              class="text-xs px-4 py-1.5 rounded-md bg-primary-500 hover:bg-primary-400 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="!selectedPath || loadingInfo"
              @click="useSelected"
            >
              <span v-if="loadingInfo">Loading info…</span>
              <span v-else>Use this repo</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
