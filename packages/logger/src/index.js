'use strict'

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 60 }
const LEVEL_NAMES = ['trace', 'debug', 'info', 'warn', 'error']

const DEFAULT_LEVEL = process.env.LOG_LEVEL || 'info'
const DEFAULT_FORMAT = (() => {
  if (process.env.LOG_FORMAT === 'json') return 'json'
  if (process.env.LOG_FORMAT === 'pretty') return 'pretty'
  return process.stdout && process.stdout.isTTY ? 'pretty' : 'json'
})()

function levelValue(level) {
  const v = LEVELS[level]
  return typeof v === 'number' ? v : LEVELS.info
}

function safeStringify(value) {
  const seen = new WeakSet()
  return JSON.stringify(value, (_, v) => {
    if (typeof v === 'bigint') return v.toString()
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: v.stack }
    }
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[Circular]'
      seen.add(v)
    }
    return v
  })
}

function formatPretty(record) {
  const { level, time, msg, name, ...rest } = record
  const ts = new Date(time).toISOString().slice(11, 23)
  const color = levelColor(level)
  const reset = '\x1b[0m'
  const label = color + level.toUpperCase().padEnd(5) + reset
  const header = `${ts} ${label}${name ? ' [' + name + ']' : ''} ${msg || ''}`.trimEnd()
  const extras = Object.keys(rest).length > 0 ? ' ' + safeStringify(rest) : ''
  return header + extras
}

function levelColor(level) {
  switch (level) {
    case 'trace':
      return '\x1b[90m'
    case 'debug':
      return '\x1b[36m'
    case 'info':
      return '\x1b[32m'
    case 'warn':
      return '\x1b[33m'
    case 'error':
      return '\x1b[31m'
    default:
      return '\x1b[0m'
  }
}

function writeRecord(record, format) {
  const output = format === 'pretty' ? formatPretty(record) : safeStringify(record)
  const stream = record.level === 'error' || record.level === 'warn' ? process.stderr : process.stdout
  stream.write(output + '\n')
}

function buildLogger({ name, bindings, level, format }) {
  const minValue = levelValue(level)

  function log(methodLevel, first, second) {
    if (levelValue(methodLevel) < minValue) return
    const record = { level: methodLevel, time: Date.now(), ...bindings }
    if (name) record.name = name
    if (typeof first === 'string') {
      record.msg = first
    } else if (first && typeof first === 'object') {
      Object.assign(record, first)
      if (typeof second === 'string') record.msg = second
    }
    writeRecord(record, format)
  }

  const api = {
    level,
    isLevelEnabled(lvl) {
      return levelValue(lvl) >= minValue
    },
    child(extraBindings) {
      return buildLogger({
        name,
        bindings: { ...bindings, ...extraBindings },
        level,
        format
      })
    }
  }

  for (const lvl of LEVEL_NAMES) {
    api[lvl] = (first, second) => log(lvl, first, second)
  }

  return api
}

function createLogger(options = {}) {
  const level = options.level || DEFAULT_LEVEL
  const format = options.format || DEFAULT_FORMAT
  return buildLogger({
    name: options.name,
    bindings: options.bindings || {},
    level,
    format
  })
}

function generateRequestId() {
  // Short, URL-safe, monotonically increasing-ish
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${time}-${rand}`
}

module.exports = {
  createLogger,
  generateRequestId,
  LEVELS
}
