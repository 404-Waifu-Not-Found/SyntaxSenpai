/**
 * Cross-platform terminal command execution for the main process.
 *
 * Windows: commands run through PowerShell (pwsh > powershell) with forced
 *          UTF-8 output encoding via -EncodedCommand. If PowerShell is not
 *          available, the command is not executed — a setup prompt is returned
 *          so the AI agent can guide the user through installation.
 *
 * macOS/Linux: commands run through the user's login shell ($SHELL or /bin/zsh).
 */

import { exec, spawnSync } from 'child_process'

// ── Windows PowerShell resolution (cached after first probe) ────────────────

let _powershell: string | null | undefined

function findPowerShell(): string | null {
  if (process.platform !== 'win32') return null
  if (_powershell !== undefined) return _powershell

  for (const bin of ['pwsh', 'powershell']) {
    const r = spawnSync('where', [bin], { windowsHide: true, stdio: 'ignore' })
    if (r.status === 0) return (_powershell = bin)
  }
  return (_powershell = null)
}

// ── Shell selection ─────────────────────────────────────────────────────────

function getShell(): string {
  if (process.platform !== 'win32') {
    return process.env.SHELL || '/bin/zsh'
  }
  // On Windows, exec needs *some* shell host to launch the pwsh command line.
  // ComSpec (cmd.exe) serves that role; it is always present on any normal
  // Windows install and is NOT used to interpret user commands.
  return process.env.ComSpec || 'cmd.exe'
}

// ── Command wrapping ────────────────────────────────────────────────────────

const SETUP_PROMPT = [
  '[System Notice] PowerShell is required but was not found on this Windows machine.',
  'Guide the user through the following steps, then ask them to retry:',
  '',
  '1. Download & install PowerShell 7: https://aka.ms/powershell-release?tag=stable',
  '   (make sure "Add to PATH" is checked during installation)',
  '2. Restart the app so the new PATH takes effect.',
  '3. Verify by asking the user to type `pwsh -v` in a terminal.',
].join('\n')

function wrapCommand(command: string): string | null {
  if (process.platform !== 'win32') return command

  const ps = findPowerShell()
  if (!ps) return null

  const script = `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ${command}`
  return `${ps} -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the name of the shell that will actually run user commands,
 * e.g. "pwsh", "powershell", "/bin/zsh", "/bin/bash".
 * On Windows: the found PowerShell binary, or null if unavailable.
 * On other platforms: $SHELL or /bin/zsh.
 */
export function getActiveShellName(): string | null {
  if (process.platform === 'win32') return findPowerShell()
  return process.env.SHELL || '/bin/zsh'
}

export async function runTerminalCommand(
  command: string,
  options?: { cwd?: string; timeout?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const wrapped = wrapCommand(command)
  if (wrapped === null) {
    return { stdout: SETUP_PROMPT, stderr: '', code: 127 }
  }

  return new Promise((resolve) => {
    exec(wrapped, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 30_000,
      maxBuffer: options?.maxBuffer ?? 2 * 1024 * 1024,
      shell: getShell(),
    }, (error: any, stdout: string, stderr: string) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: error ? error.code ?? 1 : 0,
      })
    })
  })
}
