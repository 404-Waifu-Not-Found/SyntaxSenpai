/**
 * Strict-mode IPC — manage the allowlist + audit log exposed by
 * `main/agent/executor.ts` from the renderer.
 *
 * When strict mode is enabled, `ipc/terminal.ts` stops running arbitrary
 * commands and instead delegates to `executor.runCommand`, which:
 *   - refuses shell meta-operators (; & | < > ` $)
 *   - refuses any binary not on the user's allowlist
 *   - appends a JSONL entry to <userData>/agent-audit.jsonl for every call
 *
 * Casual users keep the old native-dialog flow. Corporate / strict users
 * flip a toggle and get a tight sandbox.
 */

const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const { ipcMain, app, shell } = electronModule

import {
  getAllowlist,
  addAllowed,
  removeAllowed,
  saveAllowlist,
} from '../agent/executor'

let registered = false

function configPath(): string {
  return path.join(app.getPath('userData'), 'agent-strict-mode.json')
}

function auditLogPath(): string {
  // Same location executor.ts writes to: derived from CHAT_DB_PATH's dir
  // (which the main process sets to app.getPath('userData')).
  const dbPath = process.env.CHAT_DB_PATH
  const dir = dbPath ? path.dirname(dbPath) : app.getPath('userData')
  return path.join(dir, 'agent-audit.jsonl')
}

export function isStrictModeEnabled(): boolean {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed?.enabled === true
  } catch {
    return false
  }
}

function writeStrictMode(enabled: boolean) {
  const file = configPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }), 'utf8')
}

export function registerStrictModeIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('strictMode:get', async () => {
    try {
      return {
        success: true,
        enabled: isStrictModeEnabled(),
        allowlist: await getAllowlist(),
        auditLog: auditLogPath(),
      }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('strictMode:set', async (_e: any, enabled: boolean) => {
    try {
      writeStrictMode(!!enabled)
      return { success: true, enabled: !!enabled }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('strictMode:addAllow', async (_e: any, cmd: string) => addAllowed(cmd))
  ipcMain.handle('strictMode:removeAllow', async (_e: any, cmd: string) => removeAllowed(cmd))
  ipcMain.handle('strictMode:setAllowlist', async (_e: any, list: string[]) => {
    if (!Array.isArray(list)) return { success: false, error: 'List must be an array' }
    return saveAllowlist(list.map((c) => String(c)))
  })

  ipcMain.handle('strictMode:openAuditLog', async () => {
    try {
      const file = auditLogPath()
      // Touch the file so the shell has something to open
      try {
        fs.accessSync(file)
      } catch {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, '', 'utf8')
      }
      await shell.openPath(file)
      return { success: true, file }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}

module.exports = { registerStrictModeIpc, isStrictModeEnabled }

export {}
