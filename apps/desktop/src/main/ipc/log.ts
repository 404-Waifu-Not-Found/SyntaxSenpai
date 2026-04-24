const { ipcMain } = require('electron')
import { mainLogger } from '../logger'

let registered = false

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

const ALLOWED: ReadonlySet<LogLevel> = new Set(['trace', 'debug', 'info', 'warn', 'error'])

export interface RendererLogEntry {
  level: LogLevel
  msg: string
  scope?: string
  data?: Record<string, unknown>
}

/**
 * IPC bridge that lets the renderer forward structured log entries into the
 * main-process logger. Without this, renderer-side errors only show up in the
 * browser devtools console — the `pnpm dev` terminal stays silent and we lose
 * them on reload. Using one channel for all renderer logs keeps the terminal
 * output correlated with main-process events.
 */
export function registerLogIpc() {
  if (registered) return
  registered = true

  const rendererLogger = mainLogger.child({ source: 'renderer' })

  ipcMain.handle('log:write', (_event: unknown, entry: RendererLogEntry) => {
    const level: LogLevel = ALLOWED.has(entry?.level as LogLevel) ? (entry.level as LogLevel) : 'info'
    const msg = typeof entry?.msg === 'string' ? entry.msg : ''
    const scope = typeof entry?.scope === 'string' && entry.scope ? entry.scope : undefined
    const data = entry?.data && typeof entry.data === 'object' ? entry.data : undefined
    const payload = { ...(scope ? { scope } : {}), ...(data || {}) }
    if (Object.keys(payload).length > 0) {
      rendererLogger[level](payload, msg)
    } else {
      rendererLogger[level](msg)
    }
    return { ok: true }
  })
}

module.exports = { registerLogIpc }

export {}
