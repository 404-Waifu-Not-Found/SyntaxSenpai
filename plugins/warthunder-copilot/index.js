'use strict'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8111'
const REQUEST_TIMEOUT_MS = 700
const POLL_INTERVAL_MS = 500
const MAX_EVENTS = 100
const PROXIMITY_COOLDOWN_MS = 8000

let enabled = false
let timer = null
let config = {
  model: '',
  provider: '',
  baseUrl: DEFAULT_BASE_URL,
  dataLayerUrl: 'http://127.0.0.1:8112',
}
let snapshot = {
  connected: false,
  inBattle: false,
  updatedAt: null,
  state: null,
  indicators: null,
  mapObjects: null,
  mapInfo: null,
  mission: null,
  processed: null,
  hudEvents: [],
  chat: [],
  mapImageAvailable: false,
  derivedEvents: [],
  error: null,
}
let cursors = { event: 0, damage: 0, chat: 0 }
let derivedIds = new Set()
let lastProximityAt = 0

async function readJson(path, timeoutMs = REQUEST_TIMEOUT_MS) {
  return readJsonFrom(config.baseUrl, path, timeoutMs)
}

async function readJsonFrom(baseUrl, path, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function appendEvents(target, values) {
  if (!Array.isArray(values)) return
  for (const value of values) {
    if (value && typeof value === 'object') target.push(value)
  }
  if (target.length > MAX_EVENTS) target.splice(0, target.length - MAX_EVENTS)
}

function cleanText(value) {
  return String(value || '').replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim()
}

function deriveHudEvent(item) {
  const raw = cleanText(item?.msg || item?.message || item?.text)
  if (!raw) return null
  const id = `hud:${item?.id || raw}`
  if (derivedIds.has(id)) return null
  const kill = raw.match(/(.+?)\s+(击落了|击毁了|摧毁了|炸毁了|destroyed|shot down|gunned down)\s+(.+)/i)
  if (kill) return { id, type: 'kill', severity: 'info', raw, killer: kill[1].trim(), action: kill[2], victim: kill[3].trim() }
  if (/(先拔头筹|双杀|三杀|多杀|连续无伤|first blood|double kill|triple kill|multi kill|award)/i.test(raw)) {
    return { id, type: 'award', severity: 'info', raw }
  }
  if (/(发动机过热|油温过高|水温过高|襟翼非对称|可能导致失控|失速|engine overhe|oil temperature|water temperature|asymmetric flap|stall|loss of control)/i.test(raw)) {
    return { id, type: 'notice', severity: 'warning', raw }
  }
  return null
}

function deriveTechnicalNotice(state, indicators) {
  const notices = []
  const temperatures = [state?.oil_temp_c, state?.oilTemperature, indicators?.oil_temperature, indicators?.water_temperature, indicators?.turbine_temperature]
  if (temperatures.some((value) => Number(value) >= 120)) notices.push({ type: 'notice', severity: 'warning', raw: '发动机温度过高' })
  const fuel = Number(state?.fuel_kg)
  const fuelFull = Number(state?.fuel_full_kg)
  if (Number.isFinite(fuel) && fuelFull > 0 && fuel / fuelFull <= 0.12) notices.push({ type: 'notice', severity: 'warning', raw: '燃油剩余较低' })
  const altitude = Number(state?.altitude_m)
  const speed = Number(state?.ias_kmh ?? state?.tas_kmh ?? indicators?.speed)
  if (Number.isFinite(altitude) && Number.isFinite(speed) && altitude < 120 && speed < 160) notices.push({ type: 'notice', severity: 'critical', raw: '低高度低速，注意失速风险' })
  return notices
}

function deriveProximity(mapObjects) {
  if (!Array.isArray(mapObjects)) return null
  const player = mapObjects.find((item) => item?.icon === 'Player')
  if (!player || !Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return null
  let nearest = null
  for (const item of mapObjects) {
    if (item?.faction !== 'enemy' || !Number.isFinite(Number(item.x)) || !Number.isFinite(Number(item.y))) continue
    const distance = Math.hypot(Number(item.x) - Number(player.x), Number(item.y) - Number(player.y))
    if (!nearest || distance < nearest.distance) nearest = { item, distance }
  }
  if (!nearest || nearest.distance > 0.12 || Date.now() - lastProximityAt < PROXIMITY_COOLDOWN_MS) return null
  lastProximityAt = Date.now()
  return { id: `proximity:${Math.round(lastProximityAt / PROXIMITY_COOLDOWN_MS)}`, type: 'proximity', severity: nearest.distance < 0.06 ? 'critical' : 'warning', distance: Number(nearest.distance.toFixed(3)), raw: '敌方单位正在接近' }
}

function addDerivedEvents(events) {
  const fresh = events.filter(Boolean).map((event) => ({
    ...event,
    id: event.id || `${event.type}:${event.raw}:${Math.floor(Date.now() / 10000)}`,
  })).filter((event) => {
    if (derivedIds.has(event.id)) return false
    derivedIds.add(event.id)
    return true
  })
  appendEvents(snapshot.derivedEvents, fresh)
}

async function poll() {
  if (!enabled) return
  const state = await readJson('/state')
  const indicators = await readJson('/indicators')
  const connected = state !== null || indicators !== null
  if (!connected) {
    snapshot = { ...snapshot, connected: false, inBattle: false, updatedAt: Date.now(), error: 'War Thunder 8111 is unavailable.' }
    return
  }

  const inBattle = state?.valid === true || indicators?.valid === true
  const [mapObjects, mapInfo, mission, hud, chat, processed, mapImageAvailable] = inBattle
    ? await Promise.all([
        readJson('/map_obj.json'),
        readJson('/map_info.json'),
        readJson('/mission.json'),
        readJson(`/hudmsg?lastEvt=${cursors.event}&lastDmg=${cursors.damage}`),
        readJson(`/gamechat?lastId=${cursors.chat}`),
        readJsonFrom(config.dataLayerUrl, '/api/telemetry'),
        readBinaryAvailable('/map.img'),
      ])
    : [null, null, null, null, null, null, false]

  const nextHud = []
  if (hud && typeof hud === 'object') {
    for (const event of Array.isArray(hud.events) ? hud.events : []) {
      const id = Number(event?.id || 0)
      cursors.event = Math.max(cursors.event, id)
      nextHud.push({ type: 'event', ...event })
    }
    for (const damage of Array.isArray(hud.damage) ? hud.damage : []) {
      const id = Number(damage?.id || 0)
      cursors.damage = Math.max(cursors.damage, id)
      nextHud.push({ type: 'damage', ...damage })
    }
  }

  addDerivedEvents(nextHud.map((item) => deriveHudEvent(item)))
  addDerivedEvents(deriveTechnicalNotice(state, indicators))
  addDerivedEvents([deriveProximity(mapObjects)])

  if (Array.isArray(chat)) {
    appendEvents(snapshot.chat, chat)
    for (const message of chat) cursors.chat = Math.max(cursors.chat, Number(message?.id || 0))
  }

  appendEvents(snapshot.hudEvents, nextHud)
  snapshot = {
    connected: true,
    inBattle,
    updatedAt: Date.now(),
    state,
    indicators,
    mapObjects,
    mapInfo,
    mission,
    processed,
    hudEvents: snapshot.hudEvents,
    chat: snapshot.chat,
    mapImageAvailable,
    derivedEvents: snapshot.derivedEvents,
    error: null,
  }
}

function start(nextConfig = {}) {
  config = {
    ...config,
    ...nextConfig,
    baseUrl: String(nextConfig.baseUrl || config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ''),
  }
  if (enabled) return
  enabled = true
  cursors = { event: 0, damage: 0, chat: 0 }
  derivedIds = new Set()
  lastProximityAt = 0
  void poll()
  timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
  timer.unref?.()
}

function stop() {
  enabled = false
  if (timer) clearInterval(timer)
  timer = null
}

function result(data) {
  return { success: true, data, displayText: JSON.stringify(data) }
}

module.exports = {
  activate({ registerTool }) {
    registerTool({
      definition: {
        name: 'warthunder_copilot_control',
        description: 'Start or stop the read-only War Thunder 8111 telemetry listener. It must only be enabled while the desktop pet is visible.',
        parameters: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            provider: { type: 'string' },
            model: { type: 'string' },
          },
          required: ['enabled'],
        },
      },
      requiresPermission: 'networkAccess',
      async execute(input) {
        const nextConfig = { provider: String(input?.provider || ''), model: String(input?.model || '') }
        if (input?.enabled === true) start(nextConfig)
        else stop()
        return result({ enabled, provider: config.provider, model: config.model })
      },
    })

    registerTool({
      definition: {
        name: 'warthunder_copilot_status',
        description: 'Return the latest read-only War Thunder telemetry collected by the desktop pet copilot.',
        parameters: { type: 'object', properties: {} },
      },
      requiresPermission: 'networkAccess',
      async execute() {
        return result({ enabled, provider: config.provider, model: config.model, ...snapshot })
      },
    })
  },
}

async function readBinaryAvailable(path) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${config.baseUrl}${path}`, { signal: controller.signal })
    return response.ok && Number(response.headers.get('content-length') || 0) > 0
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}