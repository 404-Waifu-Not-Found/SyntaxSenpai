/**
 * Renderer-side logger.
 *
 * Writes to three places at once:
 *   1. The devtools console (so you see it immediately while debugging).
 *   2. The main-process structured log via the `log:write` IPC channel
 *      (so entries show up in the `pnpm dev` terminal alongside main logs).
 *   3. An in-memory ring buffer on `window.__senpaiLogs` so you can dump
 *      recent errors from the devtools console: `__senpaiLogs.dump()` or
 *      `__senpaiLogs.errors()`.
 *
 * Use `createLogger({ scope })` to get a scoped instance — the scope is
 * attached to every entry so you can grep for it in the terminal output.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  time: string
  level: LogLevel
  scope?: string
  msg: string
  data?: Record<string, unknown>
}

interface IpcLike {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

function getIpc(): IpcLike | null {
  const w = window as unknown as { electron?: { ipcRenderer?: IpcLike } }
  return w?.electron?.ipcRenderer ?? null
}

const RING_CAP = 200
const ring: LogEntry[] = []

function pushRing(entry: LogEntry) {
  ring.push(entry)
  if (ring.length > RING_CAP) ring.shift()
}

function serializeData(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message, stack: v.stack }
    } else {
      out[k] = v
    }
  }
  return out
}

function forwardToMain(entry: LogEntry) {
  const ipc = getIpc()
  if (!ipc) return
  // Fire-and-forget. If the main-process handler isn't registered yet (very
  // early in startup) the IPC promise will reject — swallow it so the logger
  // itself never throws to callers.
  ipc.invoke('log:write', {
    level: entry.level,
    msg: entry.msg,
    scope: entry.scope,
    data: entry.data,
  }).catch(() => { /* main not ready / channel gone */ })
}

const CONSOLE_FN: Record<LogLevel, (...args: unknown[]) => void> = {
  trace: (...a) => console.debug(...a),
  debug: (...a) => console.debug(...a),
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
}

function emit(level: LogLevel, scope: string | undefined, msg: string, data?: Record<string, unknown>) {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    scope,
    msg,
    data: serializeData(data),
  }
  pushRing(entry)
  const tag = scope ? `[${scope}]` : ''
  const args: unknown[] = entry.data
    ? [`${tag} ${msg}`.trim(), entry.data]
    : [`${tag} ${msg}`.trim()]
  CONSOLE_FN[level](...args)
  forwardToMain(entry)
}

export interface Logger {
  trace(msg: string, data?: Record<string, unknown>): void
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
  scope: string | undefined
}

export function createLogger(options: { scope?: string } = {}): Logger {
  const scope = options.scope
  return {
    scope,
    trace: (msg, data) => emit('trace', scope, msg, data),
    debug: (msg, data) => emit('debug', scope, msg, data),
    info: (msg, data) => emit('info', scope, msg, data),
    warn: (msg, data) => emit('warn', scope, msg, data),
    error: (msg, data) => emit('error', scope, msg, data),
  }
}

// Root logger for ad-hoc callers that don't want to pick a scope.
export const log: Logger = createLogger()

// Install devtools helpers once. Call `__senpaiLogs.dump()` or
// `__senpaiLogs.errors()` from the browser console to inspect recent entries.
declare global {
  interface Window {
    __senpaiLogs?: {
      dump(): LogEntry[]
      errors(): LogEntry[]
      clear(): void
    }
  }
}

if (typeof window !== 'undefined' && !window.__senpaiLogs) {
  window.__senpaiLogs = {
    dump: () => ring.slice(),
    errors: () => ring.filter((e) => e.level === 'error' || e.level === 'warn'),
    clear: () => { ring.length = 0 },
  }
}

// Promote unhandled renderer exceptions into the log pipeline so they also
// land in the main-process terminal. Without this, a throw in a Vue handler
// only surfaces in the devtools console.
if (typeof window !== 'undefined' && !(window as any).__senpaiLogsInstalled) {
  (window as any).__senpaiLogsInstalled = true
  window.addEventListener('error', (evt) => {
    emit('error', 'window.onerror', evt.message || 'Uncaught error', {
      source: evt.filename,
      line: evt.lineno,
      col: evt.colno,
      error: evt.error,
    })
  })
  window.addEventListener('unhandledrejection', (evt) => {
    const reason = (evt as PromiseRejectionEvent).reason
    const msg = reason instanceof Error ? reason.message : String(reason)
    emit('error', 'unhandledRejection', msg, { reason })
  })
}
