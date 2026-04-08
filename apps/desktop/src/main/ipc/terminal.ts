/**
 * Terminal IPC – gives the AI a real shell to execute commands in.
 *
 * Uses child_process.exec so every command runs in a proper login shell
 * with full expansion (~, $ENV, pipes, redirects, etc.).
 */

const { ipcMain } = require('electron')
const { exec } = require('child_process')
const os = require('os')

let registered = false

function runShell(
  command: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: cwd || os.homedir(),
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024, // 2 MB
        shell: process.env.SHELL || '/bin/zsh',
      },
      (error: any, stdout: string, stderr: string) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          code: error ? error.code ?? 1 : 0,
        })
      },
    )
  })
}

export function registerTerminalIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('terminal:systemInfo', async () => {
    return {
      platform: process.platform,
      homedir: os.homedir(),
      username: os.userInfo().username,
    }
  })

  ipcMain.handle(
    'terminal:exec',
    async (_event: any, command: string, cwd?: string) => {
      try {
        const result = await runShell(command, cwd)
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
