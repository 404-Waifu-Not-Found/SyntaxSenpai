'use strict'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8111'
const REQUEST_TIMEOUT_MS = 700
const POLL_INTERVAL_MS = 500
const RWR_THUMBNAIL_SIZE = { width: 960, height: 540 }
const RWR_ALERT_TEXT = 'RWR 显示区域出现疑似新的雷达信号，请留意游戏内告警'
const MAX_EVENTS = 100
const PROXIMITY_COOLDOWN_MS = 8000
const { updateRwrAlert } = require('./rwr-detector')

let enabled = false
let timer = null
let config = {
  model: '',
  provider: '',
  baseUrl: DEFAULT_BASE_URL,
  dataLayerUrl: 'http://127.0.0.1:8112',
  rwr: {
    enabled: false,
    sourceId: '',
    region: null,
    baselineSignalPixels: null,
    thresholdDelta: 8,
  },
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
  rwr: { enabled: false, ready: false, active: false, signalPixels: null, baselineSignalPixels: null, error: null },
  derivedEvents: [],
  error: null,
}
let cursors = { event: 0, damage: 0, chat: 0 }
let derivedIds = new Set()
let lastProximityAt = 0
let pollInFlight = false
let rwrDetection = { aboveFrames: 0, active: false }
let rwrEventSequence = 0

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

async function getWarThunderWindowSources(includePreviews = true) {
  const { desktopCapturer } = require('electron')
  if (!desktopCapturer?.getSources) throw new Error('Window capture is unavailable in this Electron session.')
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: includePreviews ? RWR_THUMBNAIL_SIZE : { width: 0, height: 0 },
    fetchWindowIcons: false,
  })
  return sources.filter((source) => /war\s*thunder/i.test(source.name))
}

function resetRwrDetection() {
  rwrDetection = { aboveFrames: 0, active: false }
}

function validRwrRegion(region) {
  if (!region || typeof region !== 'object') return false
  return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(region[key]))
    && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0
    && region.x + region.width <= 1.000001 && region.y + region.height <= 1.000001
}

function waitingRwrStatus() {
  const rwr = config.rwr || {}
  const monitoring = enabled && rwr.enabled === true
  let error = null
  if (monitoring && (!rwr.sourceId || !validRwrRegion(rwr.region))) {
    error = 'Choose the War Thunder window and crop its RWR display.'
  } else if (monitoring && (!Number.isSafeInteger(rwr.baselineSignalPixels) || rwr.baselineSignalPixels < 0)) {
    error = 'Capture a quiet RWR baseline before monitoring.'
  }
  return { enabled: monitoring, ready: false, active: false, signalPixels: null, baselineSignalPixels: rwr.baselineSignalPixels ?? null, error }
}

function recordRwrSample(input) {
  const rwr = config.rwr || {}
  const sameRegion = validRwrRegion(input?.region) && validRwrRegion(rwr.region)
    && ['x', 'y', 'width', 'height'].every((key) => input.region[key] === rwr.region[key])
  if (!enabled || rwr.enabled !== true || input?.sourceId !== rwr.sourceId || !sameRegion) return { accepted: false }
  if (!Number.isSafeInteger(rwr.baselineSignalPixels) || rwr.baselineSignalPixels < 0) {
    resetRwrDetection()
    snapshot.rwr = waitingRwrStatus()
    return { accepted: false }
  }
  if (input?.error) {
    resetRwrDetection()
    snapshot.rwr = { ...waitingRwrStatus(), error: String(input.error) }
    return { accepted: false }
  }
  const signalPixels = input?.signalPixels
  if (!Number.isSafeInteger(signalPixels) || signalPixels < 0) return { accepted: false }
  const baselineSignalPixels = rwr.baselineSignalPixels
  rwrDetection = updateRwrAlert(rwrDetection, signalPixels, baselineSignalPixels, rwr.thresholdDelta)
  snapshot.rwr = {
    enabled: true, ready: true, active: rwrDetection.active,
    signalPixels, baselineSignalPixels, updatedAt: Date.now(), error: null,
  }
  if (rwrDetection.raised) {
    addDerivedEvents([{
      id: `rwr:${Date.now()}:${++rwrEventSequence}`,
      type: 'rwr',
      severity: 'warning',
      raw: RWR_ALERT_TEXT,
      signalPixels,
      baselineSignalPixels,
    }])
  }
  return { accepted: true, ...snapshot.rwr, raised: rwrDetection.raised, alertMessage: rwrDetection.raised ? RWR_ALERT_TEXT : null }
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
  if (!enabled || pollInFlight) return
  pollInFlight = true
  try {
    if (snapshot.rwr.ready && Date.now() - snapshot.rwr.updatedAt > 3000) {
      resetRwrDetection()
      snapshot.rwr = { ...waitingRwrStatus(), error: 'Window capture is not delivering RWR samples.' }
    }
    const state = await readJson('/state')
    const indicators = await readJson('/indicators')
    const connected = state !== null || indicators !== null
    if (!connected) {
      snapshot = {
        ...snapshot,
        connected: false,
        inBattle: false,
        updatedAt: Date.now(),
        derivedEvents: snapshot.derivedEvents,
        error: 'War Thunder 8111 is unavailable.',
      }
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
      rwr: snapshot.rwr,
      derivedEvents: snapshot.derivedEvents,
      error: null,
    }
  } catch (error) {
    snapshot = { ...snapshot, updatedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }
  } finally {
    pollInFlight = false
  }
}

function start(nextConfig = {}) {
  const previousRwr = JSON.stringify(config.rwr)
  config = {
    ...config,
    ...nextConfig,
    baseUrl: String(nextConfig.baseUrl || config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ''),
    rwr: nextConfig.rwr && typeof nextConfig.rwr === 'object'
      ? { ...config.rwr, ...nextConfig.rwr }
      : config.rwr,
  }
  if (enabled) {
    if (previousRwr !== JSON.stringify(config.rwr)) {
      resetRwrDetection()
      snapshot.rwr = waitingRwrStatus()
    }
    return
  }
  enabled = true
  cursors = { event: 0, damage: 0, chat: 0 }
  derivedIds = new Set()
  lastProximityAt = 0
  resetRwrDetection()
  snapshot.rwr = waitingRwrStatus()
  void poll()
  timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
  timer.unref?.()
}

function stop() {
  enabled = false
  if (timer) clearInterval(timer)
  timer = null
  resetRwrDetection()
  snapshot.rwr = waitingRwrStatus()
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
            rwr: { type: 'object' },
          },
          required: ['enabled'],
        },
      },
      requiresPermission: 'networkAccess',
      async execute(input) {
        const nextConfig = {
          provider: String(input?.provider || ''),
          model: String(input?.model || ''),
          ...(input?.rwr && typeof input.rwr === 'object' ? { rwr: input.rwr } : {}),
        }
        if (input?.enabled === true) start(nextConfig)
        else {
          config = {
            ...config,
            ...nextConfig,
            rwr: nextConfig.rwr ? { ...config.rwr, ...nextConfig.rwr } : config.rwr,
          }
          stop()
        }
        return result({ enabled, provider: config.provider, model: config.model })
      },
    })

    registerTool({
      definition: {
        name: 'warthunder_copilot_rwr_sources',
        description: 'List War Thunder windows and local preview images for selecting the visible RWR display region.',
        parameters: { type: 'object', properties: { includePreviews: { type: 'boolean' } } },
      },
      requiresPermission: 'networkAccess',
      async execute(input) {
        try {
          const includePreviews = input?.includePreviews !== false
          const sources = await getWarThunderWindowSources(includePreviews)
          return result({
            sources: sources.map((source) => {
              if (!includePreviews) return { id: source.id, name: source.name }
              const size = source.thumbnail.getSize()
              return { id: source.id, name: source.name, width: size.width, height: size.height, preview: source.thumbnail.toDataURL() }
            }),
          })
        } catch (error) {
          return result({ sources: [], error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    registerTool({
      definition: {
        name: 'warthunder_copilot_rwr_calibrate',
        description: 'Save the quiet RWR baseline sampled locally by the desktop renderer.',
        parameters: {
          type: 'object',
          properties: {
            sourceId: { type: 'string' },
            baselineSignalPixels: { type: 'number' },
            region: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
              },
              required: ['x', 'y', 'width', 'height'],
            },
          },
          required: ['sourceId', 'region', 'baselineSignalPixels'],
        },
      },
      requiresPermission: 'networkAccess',
      async execute(input) {
        try {
          if (!input?.sourceId || !validRwrRegion(input.region)) throw new Error('Select a valid RWR display region first.')
          const signalPixels = input.baselineSignalPixels
          if (!Number.isSafeInteger(signalPixels) || signalPixels < 0) throw new Error('The RWR baseline sample is invalid.')
          config.rwr = { ...config.rwr, sourceId: String(input.sourceId), region: input.region, baselineSignalPixels: signalPixels }
          resetRwrDetection()
          snapshot.rwr = waitingRwrStatus()
          return result({ baselineSignalPixels: signalPixels })
        } catch (error) {
          return result({ error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    registerTool({
      definition: {
        name: 'warthunder_copilot_rwr_sample',
        description: 'Record the pixel count or capture error from the selected local RWR crop. This is a visual heuristic, not direct radar telemetry.',
        parameters: {
          type: 'object',
          properties: {
            sourceId: { type: 'string' },
            region: { type: 'object' },
            signalPixels: { type: 'number' },
            error: { type: 'string' },
          },
          required: ['sourceId', 'region'],
        },
      },
      requiresPermission: 'networkAccess',
      async execute(input) {
        return result(recordRwrSample(input))
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
