/**
 * Terminal IPC – exposes shell command execution to the renderer via Electron IPC.
 */

const { ipcMain, dialog, BrowserWindow } = require('electron')
const os = require('os')
import { runTerminalCommand, getActiveShellName } from '../terminal-shell'

let registered = false

/**
 * Commands that are flagged as genuinely destructive — not just "writes to
 * disk" but "irreversibly destroys data, wipes the box, or escalates privs".
 * If any of these patterns match, we prompt the user via a native dialog
 * before executing (regardless of agent mode — the agent always has shell
 * access today, and the scout report flagged this as the highest-risk gap).
 */
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-rf|-fr)\b/, why: 'Recursive forced deletion (rm -rf)' },
  { pattern: /\bsudo\b/, why: 'Privilege escalation (sudo)' },
  { pattern: /\bdoas\b/, why: 'Privilege escalation (doas)' },
  { pattern: /\bsu\s+-/, why: 'Switch user (su -)' },
  { pattern: /\bmkfs[\s.]/, why: 'Filesystem format (mkfs)' },
  { pattern: /\bdd\s+[^\n]*\bof=\/dev\//, why: 'Raw block-device write (dd of=/dev/…)' },
  { pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+[^\n]*--force)/, why: 'Destructive git (reset --hard / clean -f / push --force)' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: 'Fork bomb' },
  { pattern: /\brm\s+-[a-zA-Z]*\s+\/(?:\s|$|\*)/, why: 'rm targeting filesystem root' },
  { pattern: /\bchmod\s+-R\s+[0-7]+\s+\//, why: 'Recursive chmod on filesystem root' },
  { pattern: /\bshred\b/, why: 'Shred (irreversible overwrite)' },
  { pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/, why: 'Power command' },
  { pattern: />\s*\/dev\/sd[a-z]/, why: 'Redirect to raw disk device' },
]

function matchDestructive(command: string): string | null {
  for (const { pattern, why } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) return why
  }
  return null
}

async function confirmDestructive(command: string, reason: string): Promise<boolean> {
  try {
    const focused = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showMessageBox(focused, {
      type: 'warning',
      buttons: ['Run anyway', 'Block'],
      defaultId: 1,
      cancelId: 1,
      title: 'Destructive command detected',
      message: `The AI wants to run a potentially destructive command:\n\n$ ${command}`,
      detail: `Reason: ${reason}\n\nOnly allow this if you're sure.`,
    })
    return result.response === 0
  } catch {
    return false
  }
}

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
        const destructive = matchDestructive(String(command ?? ''))
        if (destructive) {
          const allow = await confirmDestructive(command, destructive)
          if (!allow) {
            return {
              success: true,
              stdout: '',
              stderr: `BLOCKED by user: ${destructive}. Ask the user before retrying this exact command.`,
              code: 126,
            }
          }
        }
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
