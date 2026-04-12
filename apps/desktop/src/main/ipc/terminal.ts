/**
 * Terminal IPC – exposes shell command execution to the renderer via Electron IPC.
 */

const { ipcMain } = require('electron')
const os = require('os')
import { runTerminalCommand, getActiveShellName } from '../terminal-shell'

let registered = false

export function registerTerminalIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('terminal:systemInfo', async () => ({
    platform: process.platform,
    homedir: os.homedir(),
    username: os.userInfo().username,
    shell: getActiveShellName(),
  }))

  ipcMain.handle(
    'terminal:exec',
    async (_event: any, command: string, cwd?: string) => {
      try {
        const result = await runTerminalCommand(command, { cwd: cwd || os.homedir() })
        return { success: true, ...result }
      } catch (err: any) {
        return {
          success: false,
          stdout: '',
          stderr: '',
          code: 1,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )
}

module.exports = { registerTerminalIpc }

export {}
