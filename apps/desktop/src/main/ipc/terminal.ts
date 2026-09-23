import { runTerminalCommand, getActiveShellName } from '../terminal-shell'
import { registerHostHandler, resolveWorkspacePath } from '../agent/host'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
let registered = false

async function appendExecutionLog(entry: Record<string, unknown>) {
  const database = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
  const target = path.join(path.dirname(database), 'agent-audit.jsonl')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.appendFile(target, JSON.stringify(entry) + '\n', 'utf8')
}

export function registerTerminalIpc() {
  if (registered) return
  registered = true
  registerHostHandler('terminal:systemInfo', () => ({ platform: process.platform, homedir: os.homedir(), username: os.userInfo().username, shell: getActiveShellName() }))
  registerHostHandler('terminal:exec', async (_event: any, command: string, cwd?: string) => {
    const workingDirectory = cwd ? resolveWorkspacePath(cwd) : resolveWorkspacePath('.')
    const startedAt = Date.now()
    try {
      const result = await runTerminalCommand(command, { cwd: workingDirectory, timeout: 600_000 })
      await appendExecutionLog({ timestamp: new Date(startedAt).toISOString(), event: 'terminal', command, cwd: workingDirectory, durationMs: Date.now() - startedAt, ...result }).catch(() => {})
      return { success: true, ...result }
    } catch (error) {
      const result = { success: false, error: String(error), stdout: '', stderr: '', code: 1 }
      await appendExecutionLog({ timestamp: new Date(startedAt).toISOString(), event: 'terminal', command, cwd: workingDirectory, durationMs: Date.now() - startedAt, ...result }).catch(() => {})
      return result
    }
  })
}
