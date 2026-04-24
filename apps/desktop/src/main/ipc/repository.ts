/**
 * Repository IPC — scans the filesystem for local git repos and fetches
 * per-repo metadata for the /code coding-mode feature.
 *
 * Handlers:
 *   repo:scan — broad walk of common seed dirs with a 5s wall-clock deadline
 *   repo:info — per-repo git metadata + language / package-manager detection
 */

const { ipcMain } = require('electron')
const os = require('os')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const { spawn } = require('child_process')

let registered = false

const SCAN_TIMEOUT_MS = 5000
const MAX_DEPTH = 6
const SKIP_DIRS = new Set([
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  'target',
  '.cache',
  '.git',
  '.idea',
  '.vscode',
  '__pycache__',
  '.pytest_cache',
])

type ScanRepoHit = {
  path: string
  name: string
  parentDir: string
  lastCommitTimestamp: number | null
  branch: string | null
}

function seedRoots(): string[] {
  const home = os.homedir()
  const candidates = [
    // GitHub Desktop defaults first so those repos rank high
    path.join(home, 'Documents', 'GitHub'),
    path.join(home, 'Desktop', 'GitHub'),
    path.join(home, 'GitHub'),
    // Then common dev-folder conventions
    path.join(home, 'Projects'),
    path.join(home, 'code'),
    path.join(home, 'Code'),
    path.join(home, 'dev'),
    path.join(home, 'Dev'),
    path.join(home, 'repos'),
    path.join(home, 'Repos'),
    path.join(home, 'src'),
    // Broader catch-alls last
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    home,
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of candidates) {
    try {
      const resolved = fs.realpathSync(path.resolve(c))
      if (seen.has(resolved)) continue
      const stat = fs.statSync(resolved)
      if (!stat.isDirectory()) continue
      seen.add(resolved)
      out.push(resolved)
    } catch {
      /* ignore missing/symlink-broken roots */
    }
  }
  return out
}

async function containsGitEntry(dir: string): Promise<boolean> {
  try {
    const gitPath = path.join(dir, '.git')
    const stat = await fsp.lstat(gitPath)
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

function runGit(cwd: string, args: string[], timeoutMs = 500): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* noop */ }
        resolve(null)
      }, timeoutMs)
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      child.on('error', () => { clearTimeout(timer); resolve(null) })
      child.on('close', (code: number) => {
        clearTimeout(timer)
        resolve(code === 0 ? stdout.trim() : null)
      })
    } catch {
      resolve(null)
    }
  })
}

async function walkForRepos(
  root: string,
  deadline: number,
  seen: Set<string>,
  hits: ScanRepoHit[],
): Promise<void> {
  type Frame = { dir: string; depth: number }
  const stack: Frame[] = [{ dir: root, depth: 0 }]

  while (stack.length > 0) {
    if (Date.now() > deadline) return
    const { dir, depth } = stack.pop()!

    let resolved: string
    try {
      resolved = fs.realpathSync(dir)
    } catch {
      continue
    }
    if (seen.has(resolved)) continue
    seen.add(resolved)

    if (await containsGitEntry(resolved)) {
      hits.push({
        path: resolved,
        name: path.basename(resolved),
        parentDir: path.dirname(resolved),
        lastCommitTimestamp: null,
        branch: null,
      })
      continue
    }

    if (depth >= MAX_DEPTH) continue

    let entries: any[]
    try {
      entries = await fsp.readdir(resolved, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith('.') && entry.name !== '.config') continue
      stack.push({ dir: path.join(resolved, entry.name), depth: depth + 1 })
    }
  }
}

async function enrichHit(hit: ScanRepoHit): Promise<ScanRepoHit> {
  const [tsRaw, branch] = await Promise.all([
    runGit(hit.path, ['log', '-1', '--format=%ct'], 500),
    runGit(hit.path, ['rev-parse', '--abbrev-ref', 'HEAD'], 500),
  ])
  const ts = tsRaw ? Number(tsRaw) : NaN
  return {
    ...hit,
    lastCommitTimestamp: Number.isFinite(ts) ? ts * 1000 : null,
    branch: branch || null,
  }
}

async function scanRepos(): Promise<ScanRepoHit[]> {
  const deadline = Date.now() + SCAN_TIMEOUT_MS
  const seen = new Set<string>()
  const hits: ScanRepoHit[] = []

  for (const root of seedRoots()) {
    if (Date.now() > deadline) break
    await walkForRepos(root, deadline, seen, hits)
  }

  const enriched = await Promise.all(hits.map((h) => enrichHit(h)))
  enriched.sort((a, b) => {
    const ta = a.lastCommitTimestamp ?? -1
    const tb = b.lastCommitTimestamp ?? -1
    return tb - ta
  })
  return enriched
}

function detectLanguagesAndPm(repoPath: string): Promise<{
  languages: string[]
  packageManager: string | null
  defaultStartCommand: string | null
}> {
  return (async () => {
    const out = {
      languages: [] as string[],
      packageManager: null as string | null,
      defaultStartCommand: null as string | null,
    }

    // Package manager + start command
    const pkgJsonPath = path.join(repoPath, 'package.json')
    try {
      const raw = await fsp.readFile(pkgJsonPath, 'utf8')
      const pkg = JSON.parse(raw) as { packageManager?: string; scripts?: Record<string, string> }

      let pm: string | null = null
      if (typeof pkg.packageManager === 'string') {
        pm = pkg.packageManager.split('@')[0] || null
      }
      if (!pm) {
        const lockfiles: Array<[string, string]> = [
          ['pnpm-lock.yaml', 'pnpm'],
          ['bun.lockb', 'bun'],
          ['bun.lock', 'bun'],
          ['yarn.lock', 'yarn'],
          ['package-lock.json', 'npm'],
        ]
        for (const [file, name] of lockfiles) {
          try {
            await fsp.access(path.join(repoPath, file))
            pm = name
            break
          } catch { /* next */ }
        }
      }
      out.packageManager = pm

      if (pm && pkg.scripts) {
        if (pkg.scripts.dev) out.defaultStartCommand = `${pm} dev`
        else if (pkg.scripts.start) out.defaultStartCommand = `${pm} start`
      }
    } catch {
      // Not a JS project, try other ecosystems
      const markers: Array<[string, string, string]> = [
        ['Cargo.toml', 'cargo', 'cargo run'],
        ['go.mod', 'go', 'go run .'],
        ['pyproject.toml', 'poetry', 'poetry run python -m .'],
        ['requirements.txt', 'pip', 'python -m .'],
        ['Gemfile', 'bundler', 'bundle exec'],
      ]
      for (const [file, pm, start] of markers) {
        try {
          await fsp.access(path.join(repoPath, file))
          out.packageManager = pm
          out.defaultStartCommand = start
          break
        } catch { /* next */ }
      }
    }

    // Language detection via extension counts (shallow, depth 2)
    const counts = new Map<string, number>()
    const extToLang: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.mjs': 'JavaScript',
      '.cjs': 'JavaScript',
      '.vue': 'Vue',
      '.svelte': 'Svelte',
      '.py': 'Python',
      '.rs': 'Rust',
      '.go': 'Go',
      '.java': 'Java',
      '.kt': 'Kotlin',
      '.swift': 'Swift',
      '.c': 'C',
      '.h': 'C',
      '.cc': 'C++',
      '.cpp': 'C++',
      '.cs': 'C#',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.sh': 'Shell',
      '.lua': 'Lua',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
    }

    async function countExts(dir: string, depth: number): Promise<void> {
      if (depth > 2) return
      let entries: any[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch { return }
      for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue
        if (e.name.startsWith('.')) continue
        if (e.isDirectory()) {
          await countExts(path.join(dir, e.name), depth + 1)
        } else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase()
          const lang = extToLang[ext]
          if (lang) counts.set(lang, (counts.get(lang) || 0) + 1)
        }
      }
    }
    await countExts(repoPath, 0)
    out.languages = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([lang]) => lang)

    return out
  })()
}

async function fetchRepoInfo(repoPath: string) {
  const resolved = path.resolve(repoPath)

  const [branch, status, aheadBehindRaw, remoteUrl, lastCommit] = await Promise.all([
    runGit(resolved, ['rev-parse', '--abbrev-ref', 'HEAD'], 1500),
    runGit(resolved, ['status', '--porcelain=v1'], 2000),
    runGit(resolved, ['rev-list', '--left-right', '--count', '@{u}...HEAD'], 1500),
    runGit(resolved, ['remote', 'get-url', 'origin'], 1500),
    runGit(resolved, ['log', '-1', '--format=%s%n%cr'], 1500),
  ])

  let aheadBehind: { ahead: number; behind: number } | null = null
  if (aheadBehindRaw) {
    const parts = aheadBehindRaw.split(/\s+/)
    if (parts.length === 2) {
      const behind = Number(parts[0])
      const ahead = Number(parts[1])
      if (Number.isFinite(ahead) && Number.isFinite(behind)) {
        aheadBehind = { ahead, behind }
      }
    }
  }

  let lastCommitSubject: string | null = null
  let lastCommitRelative: string | null = null
  if (lastCommit) {
    const lines = lastCommit.split('\n')
    lastCommitSubject = lines[0] || null
    lastCommitRelative = lines[1] || null
  }

  const detected = await detectLanguagesAndPm(resolved)

  return {
    path: resolved,
    name: path.basename(resolved),
    branch: branch || null,
    isDirty: (status ?? '').trim().length > 0,
    aheadBehind,
    remoteUrl: remoteUrl || null,
    languages: detected.languages,
    packageManager: detected.packageManager,
    defaultStartCommand: detected.defaultStartCommand,
    lastCommitSubject,
    lastCommitRelative,
  }
}

export function registerRepositoryIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('repo:scan', async () => {
    try {
      const repos = await scanRepos()
      return { success: true, repos }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('repo:info', async (_event: any, rawPath: string) => {
    try {
      if (!rawPath || typeof rawPath !== 'string') {
        return { success: false, error: 'path is required' }
      }
      let target = rawPath
      if (target.startsWith('~')) {
        target = path.join(os.homedir(), target.slice(1))
      }
      const stat = await fsp.stat(target)
      if (!stat.isDirectory()) {
        return { success: false, error: `${target} is not a directory` }
      }
      const info = await fetchRepoInfo(target)
      return { success: true, info }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}

module.exports = { registerRepositoryIpc }

export {}
