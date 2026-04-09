const { ipcMain } = require('electron')
const fs = require('fs').promises
const path = require('path')
import * as executor from '../agent/executor'

let registered = false

export function registerAgentIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('agent:exec', async (event: any, payload: any) => {
    return await executor.runCommand(payload)
  })

  ipcMain.handle('agent:readFile', async (event: any, filePath: string) => {
    return await executor.readFile(filePath)
  })

  ipcMain.handle('agent:writeFile', async (event: any, filePath: string, content: string) => {
    return await executor.writeFile(filePath, content)
  })

  ipcMain.handle('agent:listDirectory', async (event: any, dirPath: string) => {
    return await executor.listDirectory(dirPath)
  })

  ipcMain.handle('agent:openExternal', async (event: any, url: string) => {
    return await executor.openExternal(url)
  })

  ipcMain.handle('agent:webSearch', async (_event: any, query: string, limit?: number) => {
    return await executor.webSearch(query, limit)
  })

  ipcMain.handle('agent:getLog', async (event: any) => {
    try {
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const logPath = path.join(path.dirname(dbPath), 'agent.log')
      const content = await fs.readFile(logPath, 'utf-8').catch(() => '')
      return { success: true, content }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('agent:getAudit', async (event: any) => {
    try {
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const auditPath = path.join(path.dirname(dbPath), 'agent-audit.jsonl')
      const content = await fs.readFile(auditPath, 'utf-8').catch(() => '')
      return { success: true, content }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('agent:clearAudit', async (event: any) => {
    try {
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const auditPath = path.join(path.dirname(dbPath), 'agent-audit.jsonl')
      await fs.writeFile(auditPath, '').catch(() => {})
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('agent:getAllowlist', async (event: any) => {
    try {
      if (typeof executor.getAllowlist === 'function') {
        const list = await executor.getAllowlist()
        return { success: true, allowlist: Array.isArray(list) ? list : list }
      }
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const allowPath = path.join(path.dirname(dbPath), 'agent-allowlist.json')
      const raw = await fs.readFile(allowPath, 'utf-8').catch(() => '')
      const arr = raw ? JSON.parse(raw) : []
      return { success: true, allowlist: arr }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('agent:setAllowlist', async (event: any, list: any) => {
    try {
      if (typeof executor.saveAllowlist === 'function') return await executor.saveAllowlist(list)
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const allowPath = path.join(path.dirname(dbPath), 'agent-allowlist.json')
      await fs.writeFile(allowPath, JSON.stringify(list || [], null, 2)).catch(() => {})
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('agent:addAllow', async (event: any, cmd: string) => {
    try {
      if (typeof executor.addAllowed === 'function') return await executor.addAllowed(cmd)
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const allowPath = path.join(path.dirname(dbPath), 'agent-allowlist.json')
      const raw = await fs.readFile(allowPath, 'utf-8').catch(() => '')
      const arr = raw ? JSON.parse(raw) : []
      if (!arr.includes(cmd)) arr.push(cmd)
      await fs.writeFile(allowPath, JSON.stringify(arr, null, 2)).catch(() => {})
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('agent:removeAllow', async (event: any, cmd: string) => {
    try {
      if (typeof executor.removeAllowed === 'function') return await executor.removeAllowed(cmd)
      const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
      const allowPath = path.join(path.dirname(dbPath), 'agent-allowlist.json')
      const raw = await fs.readFile(allowPath, 'utf-8').catch(() => '')
      const arr = raw ? JSON.parse(raw) : []
      const filtered = arr.filter((c: any) => c !== cmd)
      await fs.writeFile(allowPath, JSON.stringify(filtered, null, 2)).catch(() => {})
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

module.exports = { registerAgentIpc }

export {}
