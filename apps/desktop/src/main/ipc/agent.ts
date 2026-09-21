import { registerHostHandler, resolveWorkspacePath, hostContext, invokeHost } from '../agent/host'
const { ipcMain, app } = require('electron')
const fs = require('fs').promises
const fsSync = require('fs')
const path = require('path')
import * as executor from '../agent/executor'

let registered = false

function webSearchSettingsPath(): string {
  return path.join(app.getPath('userData'), 'agent-web-search.json')
}

export function isWebSearchEnabled(): boolean {
  try {
    const raw = fsSync.readFileSync(webSearchSettingsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed?.enabled === true
  } catch {
    return false
  }
}

function writeWebSearchEnabled(enabled: boolean) {
  const file = webSearchSettingsPath()
  fsSync.mkdirSync(path.dirname(file), { recursive: true })
  fsSync.writeFileSync(file, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
}

export function registerAgentIpc() {
  if (registered) return
  registered = true

  registerHostHandler('agent:exec', async (event: any, payload: any) => {
    return await invokeHost('terminal:exec', payload.command, payload.cwd)
  })

  registerHostHandler('agent:readFile', async (event: any, filePath: string) => {
    return await invokeHost('fs:read', filePath)
  })

  registerHostHandler('agent:writeFile', async (event: any, filePath: string, content: string) => {
    return await invokeHost('fs:write', filePath, content)
  })

  registerHostHandler('agent:listDirectory', async (event: any, dirPath: string) => {
    return await invokeHost('fs:list', dirPath)
  })

  registerHostHandler('agent:openExternal', async (event: any, url: string) => {
    return await executor.openExternal(url)
  })

  registerHostHandler('agent:webSearch', async (_event: any, query: string, limit?: number) => {
    if (!isWebSearchEnabled()) {
      return { success: false, error: 'Web search is disabled. Enable it in Settings before using web_search.' }
    }
    return await executor.webSearch(query, limit)
  })

  registerHostHandler('agent:webFetch', async (_event: any, url: string, format?: string) => {
    return await executor.webFetch(url, format)
  })

  registerHostHandler('agent:webSearchEnabled:get', async () => {
    try {
      return { success: true, enabled: isWebSearchEnabled() }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err), enabled: false }
    }
  })

  registerHostHandler('agent:webSearchEnabled:set', async (_event: any, enabled: boolean) => {
    try {
      writeWebSearchEnabled(!!enabled)
      return { success: true, enabled: !!enabled }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  registerHostHandler('agent:getLog', async (event: any) => {
    try {
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const logPath = path.join(path.dirname(dbPath), 'agent.log')
      const content = await fs.readFile(logPath, 'utf-8').catch(() => '')
      return { success: true, content }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerHostHandler('agent:getAudit', async (event: any) => {
    try {
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const auditPath = path.join(path.dirname(dbPath), 'agent-audit.jsonl')
      const content = await fs.readFile(auditPath, 'utf-8').catch(() => '')
      return { success: true, content }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerHostHandler('agent:clearAudit', async (event: any) => {
    try {
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const auditPath = path.join(path.dirname(dbPath), 'agent-audit.jsonl')
      await fs.writeFile(auditPath, '').catch(() => {})
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

}

export {}
