<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../composables/use-i18n'
import treeData from '../data/war-thunder-tech-trees.json'
import aviationAtlas from '../assets/war-thunder/aviation.webp'
import helicoptersAtlas from '../assets/war-thunder/helicopters.webp'
import groundAtlas from '../assets/war-thunder/ground.webp'
import shipsAtlas from '../assets/war-thunder/ships.webp'
import boatsAtlas from '../assets/war-thunder/boats.webp'

type Cell = { items: string[]; group?: string; label?: string; span?: number } | null
type Rank = { rank: string; research: Cell[][]; premium: Cell[][] }
type Nation = { id: string; name: string; ranks: Rank[] }
type BrMode = 'ab' | 'rb' | 'sb'
type Unit = { name: string; rank?: number; role?: string; rb?: number; brs?: Partial<Record<BrMode, number>>; researchRp?: number; purchase?: number; currency?: string; requires?: string; iconIndex?: number }
type Category = { id: string; url: string; nations: Nation[]; units: Record<string, Unit>; groups: Record<string, { name: string; requires?: string }> }
type Snapshot = { snapshotDate: string; source: string; categories: Category[] }
type SelectedVehicle = { id: string; name: string; category: string; nation: string; rank: string; researchRp?: number }
type SearchResult = { id: string; rank: string; premium: boolean }

const snapshot = treeData as unknown as Snapshot
const atlasByCategory: Record<string, string> = {
  aviation: aviationAtlas,
  helicopters: helicoptersAtlas,
  ground: groundAtlas,
  ships: shipsAtlas,
  boats: boatsAtlas,
}
const props = defineProps<{ category: string }>()
const emit = defineEmits<{
  'update:category': [category: string]
  selectVehicle: [vehicle: SelectedVehicle]
}>()
const { t } = useI18n()
const nationId = ref(snapshot.categories[0]?.nations[0]?.id || '')
const rankFilter = ref('all')
const brMode = ref<BrMode>('rb')
const query = ref('')
const selectedId = ref('')
const activeCategory = computed(() => snapshot.categories.find((item) => item.id === props.category) || snapshot.categories[0])
const activeNation = computed(() => activeCategory.value.nations.find((item) => item.id === nationId.value) || activeCategory.value.nations[0])
const visibleRanks = computed(() => activeNation.value?.ranks.filter((rank) => rankFilter.value === 'all' || rank.rank === rankFilter.value) || [])
const selectedUnit = computed(() => activeCategory.value.units[selectedId.value] || null)
const groupByUnit = computed(() => {
  const membership: Record<string, string> = {}
  for (const rank of activeNation.value?.ranks || []) {
    for (const section of [rank.research, rank.premium]) {
      for (const row of section) {
        for (const cell of row) {
          if (cell?.group) for (const id of cell.items) membership[id] = cell.group
        }
      }
    }
  }
  return membership
})

watch(() => props.category, () => {
  if (!activeCategory.value.nations.some((nation) => nation.id === nationId.value)) {
    nationId.value = activeCategory.value.nations[0]?.id || ''
  }
  rankFilter.value = 'all'
  if (['ships', 'boats'].includes(props.category) && brMode.value === 'sb') brMode.value = 'rb'
  selectedId.value = ''
})
watch(nationId, () => {
  rankFilter.value = 'all'
  selectedId.value = ''
})

function unit(id: string): Unit {
  return activeCategory.value.units[id] || { name: id }
}

function brValue(id: string): number | undefined {
  const vehicle = unit(id)
  return vehicle.brs?.[brMode.value] ?? (brMode.value === 'rb' ? vehicle.rb : undefined)
}

function iconStyle(id: string) {
  const index = unit(id).iconIndex
  if (index === undefined) return undefined
  return {
    backgroundImage: `url("${atlasByCategory[activeCategory.value.id]}")`,
    backgroundPosition: `${-(index % 16) * 96}px ${-Math.floor(index / 16) * 42}px`,
    width: '96px',
    height: '42px',
    flexShrink: '0',
  }
}

function requirementName(id: string): string {
  const required = unit(id).requires || activeCategory.value.groups[groupByUnit.value[id]]?.requires
  return required ? activeCategory.value.units[required]?.name || activeCategory.value.groups[required]?.name || required : ''
}

function selectVehicle(id: string, rank: string) {
  selectedId.value = id
  emit('selectVehicle', {
    id,
    name: unit(id).name,
    category: activeCategory.value.id,
    nation: activeNation.value.name,
    rank,
    researchRp: unit(id).researchRp,
  })
}

function scrollToCalculator() {
  document.getElementById('war-thunder-research-calculator')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const searchResults = computed<SearchResult[]>(() => {
  const term = query.value.trim().toLocaleLowerCase()
  if (!term) return []
  const results: SearchResult[] = []
  const seen = new Set<string>()
  for (const rank of visibleRanks.value) {
    for (const [section, premium] of [[rank.research, false], [rank.premium, true]] as const) {
      for (const row of section) {
        for (const cell of row) {
          for (const id of cell?.items || []) {
            if (seen.has(id) || !unit(id).name.toLocaleLowerCase().includes(term)) continue
            seen.add(id)
            results.push({ id, rank: rank.rank, premium })
          }
        }
      }
    }
  }
  return results
})
</script>

<template>
  <div class="settings-card mt-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="text-sm font-semibold text-neutral-200">{{ t('pet.warThunderTechTree') }}</div>
      <span class="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">{{ t('pet.treeOffline') }} · {{ snapshot.snapshotDate }}</span>
    </div>
    <p class="mt-1 text-xs text-neutral-400">{{ t('pet.treeOfflineDescription') }}</p>
    <p class="mt-1 text-[11px] text-neutral-500">{{ t('pet.treeBrMode') }}</p>

    <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <label class="text-xs text-neutral-400">
        {{ t('pet.warThunderTreeType') }}
        <select :value="category" class="input-field mt-1" @change="emit('update:category', ($event.target as HTMLSelectElement).value)">
          <option v-for="item in snapshot.categories" :key="item.id" :value="item.id">{{ t(`pet.warThunderTree${item.id[0].toUpperCase()}${item.id.slice(1)}`) }}</option>
        </select>
      </label>
      <label class="text-xs text-neutral-400">
        {{ t('pet.treeNation') }}
        <select v-model="nationId" class="input-field mt-1">
          <option v-for="nation in activeCategory.nations" :key="nation.id" :value="nation.id">{{ nation.name }}</option>
        </select>
      </label>
      <label class="text-xs text-neutral-400">
        {{ t('pet.treeRank') }}
        <select v-model="rankFilter" class="input-field mt-1">
          <option value="all">{{ t('pet.treeAllRanks') }}</option>
          <option v-for="rank in activeNation?.ranks || []" :key="rank.rank" :value="rank.rank">{{ rank.rank }}</option>
        </select>
      </label>
      <label class="text-xs text-neutral-400">
        {{ t('pet.treeBattleRating') }}
        <select v-model="brMode" class="input-field mt-1">
          <option value="rb">{{ t('pet.treeBrRealistic') }}</option>
          <option value="ab">{{ t('pet.treeBrArcade') }}</option>
          <option v-if="!['ships', 'boats'].includes(category)" value="sb">{{ t('pet.treeBrSimulator') }}</option>
        </select>
      </label>
    </div>
    <input v-model="query" type="search" class="input-field mt-3" :placeholder="t('pet.treeSearch')" :aria-label="t('pet.treeSearch')">

    <div class="mt-3 max-h-[560px] overflow-y-auto rounded-xl border border-neutral-700/70 bg-black/15 p-3">
      <div v-if="query.trim()" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          v-for="result in searchResults"
          :key="result.id"
          type="button"
          class="rounded-lg border p-2 text-left text-xs hover:bg-white/10"
          :class="selectedId === result.id ? 'border-amber-400 bg-amber-400/10' : 'border-neutral-700 bg-white/5'"
          @click="selectVehicle(result.id, result.rank)"
        >
          <span class="flex items-center gap-2">
            <span v-if="unit(result.id).iconIndex !== undefined" aria-hidden="true" class="block rounded-md bg-white/10 bg-no-repeat" :style="iconStyle(result.id)"></span>
            <span class="min-w-0">
              <span class="block font-semibold text-neutral-200">{{ unit(result.id).name }}</span>
              <span class="block mt-1 text-[10px] text-neutral-400">{{ t('pet.treeRank') }} {{ result.rank }} · {{ result.premium ? t('pet.treePremium') : t('pet.treeResearchable') }}</span>
              <span class="block text-[10px] text-neutral-400">{{ brValue(result.id) !== undefined ? `BR ${brValue(result.id)?.toFixed(1)}` : '' }}{{ unit(result.id).researchRp !== undefined ? ` · ${unit(result.id).researchRp?.toLocaleString()} RP` : '' }}</span>
            </span>
          </span>
        </button>
        <p v-if="!searchResults.length" class="text-xs text-neutral-500">{{ t('pet.treeNoMatches') }}</p>
      </div>
      <div v-else>
        <section v-for="rank in visibleRanks" :key="rank.rank" class="mb-5 last:mb-0">
          <div class="sticky top-0 z-10 rounded-lg bg-neutral-900/95 px-2 py-1 text-xs font-semibold text-amber-200">{{ t('pet.treeRank') }} {{ rank.rank }}</div>
          <div v-for="(section, sectionIndex) in [rank.research, rank.premium]" :key="sectionIndex" v-show="section.length" class="mt-2">
            <div class="mb-1 text-[11px] text-neutral-400">{{ sectionIndex === 0 ? t('pet.treeResearchable') : t('pet.treePremium') }}</div>
            <div class="overflow-x-auto">
              <table class="border-separate border-spacing-2">
                <tbody>
                  <tr v-for="(row, rowIndex) in section" :key="rowIndex">
                    <td v-for="(cell, cellIndex) in row" :key="cellIndex" :colspan="cell?.span || 1" class="min-w-[205px] align-top">
                      <div v-if="cell?.items.length" class="rounded-lg border p-1.5" :class="sectionIndex === 0 ? 'border-sky-500/30 bg-sky-500/5' : 'border-amber-500/30 bg-amber-500/5'">
                        <div v-if="cell.group" class="mb-1 text-[10px] font-semibold text-neutral-400">{{ cell.label }}</div>
                        <button
                          v-for="id in cell.items"
                          :key="id"
                          type="button"
                          class="block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-white/10"
                          :class="selectedId === id ? 'bg-amber-400/20 text-amber-200' : 'text-neutral-200'"
                          @click="selectVehicle(id, rank.rank)"
                        >
                          <span class="flex items-center gap-2">
                            <span v-if="unit(id).iconIndex !== undefined" aria-hidden="true" class="block rounded-md bg-white/10 bg-no-repeat" :style="iconStyle(id)"></span>
                            <span class="min-w-0">
                              <span class="block font-medium">{{ unit(id).name }}</span>
                              <span class="block text-[10px] text-neutral-400">{{ brValue(id) !== undefined ? `BR ${brValue(id)?.toFixed(1)}` : '' }}{{ unit(id).researchRp !== undefined ? ` · ${unit(id).researchRp?.toLocaleString()} RP` : '' }}</span>
                              <span v-if="requirementName(id)" class="block truncate text-[10px] text-neutral-500">← {{ requirementName(id) }}</span>
                            </span>
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div v-if="selectedUnit" class="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-neutral-300">
      <div class="flex items-center gap-3">
        <span v-if="selectedUnit.iconIndex !== undefined" aria-hidden="true" class="block rounded-md bg-white/10 bg-no-repeat" :style="iconStyle(selectedId)"></span>
        <div>
          <div class="font-semibold text-amber-200">{{ t('pet.treeSelected') }}: {{ selectedUnit.name }}</div>
          <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400">
            <span v-if="selectedUnit.role">{{ selectedUnit.role }}</span>
            <span v-if="brValue(selectedId) !== undefined">BR {{ brValue(selectedId)?.toFixed(1) }}</span>
            <span v-if="selectedUnit.researchRp !== undefined">{{ t('pet.treeResearchRp') }} {{ selectedUnit.researchRp.toLocaleString() }} RP</span>
            <span v-else>{{ t('pet.treeNoResearchRp') }}</span>
            <span v-if="selectedUnit.purchase !== undefined">{{ t('pet.treePurchase') }} {{ selectedUnit.purchase.toLocaleString() }} {{ selectedUnit.currency }}</span>
            <span v-if="requirementName(selectedId)">{{ t('pet.treeRequires') }} {{ requirementName(selectedId) }}</span>
          </div>
        </div>
      </div>
      <button type="button" class="mt-3 rounded-lg bg-amber-400/15 px-3 py-2 text-xs text-amber-100 hover:bg-amber-400/25" @click="scrollToCalculator">
        {{ t('pet.treeGoCalculator') }} ↓
      </button>
    </div>
  </div>
</template>
