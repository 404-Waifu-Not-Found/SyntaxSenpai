import { runTerminalCommand, getActiveShellName } from '../terminal-shell'
import { registerHostHandler, resolveWorkspacePath } from '../agent/host'
import os from 'node:os'
let registered = false
export function registerTerminalIpc() {
  if (registered) return
  registered = true
  registerHostHandler('terminal:systemInfo', () => ({ platform: process.platform, homedir: os.homedir(), username: os.userInfo().username, shell: getActiveShellName() }))
  registerHostHandler('terminal:exec', async (_event: any, command: string, cwd?: string) => {
    try { return { success: true, ...await runTerminalCommand(command, { cwd: cwd ? resolveWorkspacePath(cwd) : resolveWorkspacePath('.'), timeout: 600_000 }) } }
    catch (error) { return { success: false, error: String(error), stdout: '', stderr: '', code: 1 } }
  })
}
