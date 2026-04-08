const { spawn } = require('child_process')
const fs = require('fs').promises
const fssync = require('fs')
const path = require('path')
const { shell } = require('electron')

// Persistent allowlist & auditing for agent commands
const DEFAULT_ALLOWLIST = ['ls','pwd','cat','echo','open','whoami','uptime','date','id']
let allowlistCache: Set<string> | null = null

function getLogDir() {
  const dbPath = process.env.CHAT_DB_PATH
  return dbPath ? path.dirname(dbPath) : process.cwd()
}

function loadAllowlistSync(): Set<string> {
  if (allowlistCache) return allowlistCache
  try {
    const allowPath = path.join(getLogDir(), 'agent-allowlist.json')
    if (fssync.existsSync(allowPath)) {
      const raw = fssync.readFileSync(allowPath, 'utf-8')
      const arr = JSON.parse(raw)
      allowlistCache = new Set(Array.isArray(arr) ? arr.map(String) : [])
    } else {
      allowlistCache = new Set(DEFAULT_ALLOWLIST)
    }
  } catch (e) {
    allowlistCache = new Set(DEFAULT_ALLOWLIST)
  }
  return allowlistCache
}

export async function getAllowlist(): Promise<string[]> {
  return Array.from(loadAllowlistSync())
}

export async function saveAllowlist(list: string[]) {
  try {
    const allowPath = path.join(getLogDir(), 'agent-allowlist.json')
    await fs.writeFile(allowPath, JSON.stringify(list, null, 2), 'utf-8')
    allowlistCache = new Set(Array.isArray(list) ? list.map(String) : [])
    // audit the change
    try {
      const auditPath = path.join(getLogDir(), 'agent-audit.jsonl')
      const entry = { timestamp: new Date().toISOString(), event: 'allowlist:set', list }
      fs.appendFile(auditPath, JSON.stringify(entry) + '\n').catch(() => {})
    } catch (e) {}
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err && err.message ? err.message : String(err) }
  }
}

export async function addAllowed(cmd: string) {
  if (!cmd || typeof cmd !== 'string') return { success: false, error: 'Invalid command' }
  try {
    const set = loadAllowlistSync()
    if (set.has(cmd)) return { success: true, added: false }
    const arr = Array.from(set)
    arr.push(cmd)
    const res = await saveAllowlist(arr)
    if (res && res.success) {
      try {
        const auditPath = path.join(getLogDir(), 'agent-audit.jsonl')
        const entry = { timestamp: new Date().toISOString(), event: 'allowlist:add', command: cmd }
        fs.appendFile(auditPath, JSON.stringify(entry) + '\n').catch(() => {})
      } catch (e) {}
    }
    return res
  } catch (err: any) {
    return { success: false, error: err && err.message ? err.message : String(err) }
  }
}

export async function removeAllowed(cmd: string) {
  if (!cmd || typeof cmd !== 'string') return { success: false, error: 'Invalid command' }
  try {
    const set = loadAllowlistSync()
    if (!set.has(cmd)) return { success: true, removed: false }
    const arr = Array.from(set).filter((c) => c !== cmd)
    const res = await saveAllowlist(arr)
    if (res && res.success) {
      try {
        const auditPath = path.join(getLogDir(), 'agent-audit.jsonl')
        const entry = { timestamp: new Date().toISOString(), event: 'allowlist:remove', command: cmd }
        fs.appendFile(auditPath, JSON.stringify(entry) + '\n').catch(() => {})
      } catch (e) {}
    }
    return res
  } catch (err: any) {
    return { success: false, error: err && err.message ? err.message : String(err) }
  }
}

// Run a shell command and capture output (with a persisted allowlist and logging)
function isCommandAllowed(cmd: string): boolean {
  if (!cmd || typeof cmd !== 'string') return false
  // Disallow shell meta-operators to reduce risk
  if (/[;&|<>`$]/.test(cmd)) return false
  const first = String(cmd).trim().split(/\s+/)[0]
  const allowSet = loadAllowlistSync()
  return allowSet.has(first) || allowSet.has(path.basename(first))
}

export function runCommand(opts: any = {}) {
  const { command, args = [], cwd = undefined, env = process.env } = opts
  return new Promise((resolve) => {
    try {
      // Normalize input into command name + args array
      let cmdName: string | null = null
      let cmdArgs: string[] = []

      if (Array.isArray(command)) {
        if (command.length === 0) return resolve({ success: false, error: 'No command provided' })
        cmdName = String(command[0])
        cmdArgs = command.slice(1).map(String)
      } else if (typeof command === 'string') {
        const tokens = (String(command).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map((t: string) => t.replace(/^['"]|['"]$/g, ''))
        if (tokens.length === 0) return resolve({ success: false, error: 'No command provided' })
        cmdName = tokens[0]
        if (Array.isArray(args) && args.length > 0) cmdArgs = args.map(String)
        else cmdArgs = tokens.slice(1)
      } else {
        return resolve({ success: false, error: 'Invalid command type' })
      }

      const dbPath = process.env.CHAT_DB_PATH
      const logDir = dbPath ? path.dirname(dbPath) : process.cwd()
      const logPath = path.join(logDir, 'agent.log')
      const auditPath = path.join(logDir, 'agent-audit.jsonl')
      const timestamp = new Date().toISOString()
      const baseEntry: any = { timestamp, command: String(cmdName), args: cmdArgs, cwd: cwd || null }

      // human-readable log
      try {
        const entry = `${timestamp} | CMD: ${[cmdName, ...cmdArgs].join(' ').replace(/\n/g, ' ')}\n`
        fs.appendFile(logPath, entry).catch(() => {})
      } catch (e) {
        // ignore
      }

      // Disallow meta-operators anywhere in the composed command
      const joined = [cmdName, ...cmdArgs].join(' ')
      if (/[;&|<>`$]/.test(joined)) {
        try {
          const auditEntry = { ...baseEntry, success: false, error: 'Command contains disallowed characters' }
          fs.appendFile(auditPath, JSON.stringify(auditEntry) + '\n').catch(() => {})
        } catch (e) {}
        return resolve({ success: false, error: 'Command contains disallowed characters' })
      }

      const allowed = isCommandAllowed(cmdName)
      baseEntry.allowed = allowed

      if (!allowed) {
        try {
          const auditEntry = { ...baseEntry, success: false, error: 'Command not allowed by security policy' }
          fs.appendFile(auditPath, JSON.stringify(auditEntry) + '\n').catch(() => {})
        } catch (e) {}
        resolve({ success: false, error: 'Command not allowed by security policy' })
        return
      }

      // Spawn without shell to avoid shell injection
      const child = spawn(cmdName, cmdArgs, { shell: false, cwd, env: Object.assign({}, process.env, env) })
      let stdout = ''
      let stderr = ''
      if (child.stdout) child.stdout.on('data', (chunk: any) => { stdout += chunk.toString() })
      if (child.stderr) child.stderr.on('data', (chunk: any) => { stderr += chunk.toString() })
      child.on('close', (code: any) => {
        const success = code === 0
        try {
          const auditEntry = { ...baseEntry, success, code, stdout, stderr }
          fs.appendFile(auditPath, JSON.stringify(auditEntry) + '\n').catch(() => {})
        } catch (e) {}
        resolve({ success: true, code, stdout, stderr })
      })
      child.on('error', (err: any) => {
        try {
          const auditEntry = { ...baseEntry, success: false, error: err && err.message ? err.message : String(err) }
          fs.appendFile(auditPath, JSON.stringify(auditEntry) + '\n').catch(() => {})
        } catch (e) {}
        resolve({ success: false, error: err && err.message ? err.message : String(err) })
      })
    } catch (err: any) {
      resolve({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}

export async function readFile(filePath: string) {
  try {
    const content = await fs.readFile(path.resolve(filePath), 'utf-8')
    return { success: true, content }
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function writeFile(filePath: string, content: string) {
  try {
    await fs.writeFile(path.resolve(filePath), content, 'utf-8')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function listDirectory(dirPath: string) {
  try {
    const resolved = path.resolve(dirPath)
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    const lines = entries.map((e: any) => {
      const type = e.isDirectory() ? 'DIR ' : e.isSymbolicLink() ? 'LINK' : 'FILE'
      return `${type}  ${e.name}`
    })
    return { success: true, listing: lines.join('\n') || '(empty directory)' }
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function openExternal(url: string) {
  try {
    await shell.openExternal(url)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

module.exports = { runCommand, readFile, writeFile, listDirectory, openExternal, getAllowlist, saveAllowlist, addAllowed, removeAllowed }

export {}
