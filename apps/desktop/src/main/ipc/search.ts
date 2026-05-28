/**
 * Search & patch IPC — opencode-parity file tools for the renderer agent.
 *
 * Exposes:
 *  - fs:glob   find files by glob pattern (mtime-sorted, newest first)
 *  - fs:grep   regex content search (ripgrep when available, JS fallback)
 *  - fs:list   directory tree listing to a bounded depth
 *  - fs:patch  apply a unified diff across one or more files
 *
 * Same trust domain as filesystem.ts — the agent already has shell access,
 * so file I/O carries no extra sandboxing beyond `~` expansion.
 */

const { ipcMain } = require('electron')
const os = require('os')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const { execFile } = require('child_process')

let registered = false

/** Directories never worth walking for an agent code search. */
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'dist_electron', 'build', 'out',
  '.expo', '.turbo', '.next', '.nuxt', '.cache', '.parcel-cache',
  'coverage', '.venv', 'venv', '__pycache__', '.idea', '.gradle',
  'target', 'vendor', '.pnpm-store',
])

function resolvePath(p?: string): string {
  if (!p) return process.cwd()
  let resolved = p
  if (resolved.startsWith('~')) resolved = path.join(os.homedir(), resolved.slice(1))
  return path.resolve(resolved)
}

/** Forward-slash a path so glob regexes behave the same on Windows. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/**
 * Compile a glob pattern (supporting `*`, `**`, `?`, `{a,b}`, char classes)
 * into an anchored RegExp matched against forward-slash relative paths.
 */
function globToRegExp(glob: string): RegExp {
  let pattern = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` crosses directories; bare `**` matches anything.
        if (glob[i + 2] === '/') { pattern += '(?:.*/)?'; i += 3; continue }
        pattern += '.*'; i += 2; continue
      }
      pattern += '[^/]*'; i += 1; continue
    }
    if (c === '?') { pattern += '[^/]'; i += 1; continue }
    if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end !== -1) {
        const opts = glob
          .slice(i + 1, end)
          .split(',')
          .map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        pattern += '(?:' + opts.join('|') + ')'
        i = end + 1
        continue
      }
    }
    if (c === '[') {
      const end = glob.indexOf(']', i)
      if (end !== -1) { pattern += glob.slice(i, end + 1); i = end + 1; continue }
    }
    if ('.+^$()|\\'.includes(c)) { pattern += '\\' + c; i += 1; continue }
    pattern += c
    i += 1
  }
  return new RegExp('^' + pattern + '$')
}

/** Recursively collect file paths under `root`, skipping IGNORED_DIRS. */
async function walkFiles(root: string, maxEntries = 50000): Promise<string[]> {
  const out: string[] = []
  async function recurse(dir: string): Promise<void> {
    if (out.length >= maxEntries) return
    let entries: any[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= maxEntries) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        await recurse(full)
      } else if (entry.isFile()) {
        out.push(full)
      }
    }
  }
  await recurse(root)
  return out
}

// ── glob ────────────────────────────────────────────────────────────────────

async function handleGlob(rawPattern: string, rawCwd?: string, rawLimit?: number) {
  let pattern = String(rawPattern || '').trim()
  if (!pattern) return { success: false, error: 'pattern is required' }
  const cwd = resolvePath(rawCwd)
  const limit = Math.max(1, Math.min(1000, Number(rawLimit) || 200))
  // A pattern with no slash is matched at any depth (`*.ts` → `**/*.ts`).
  if (!pattern.includes('/')) pattern = '**/' + pattern
  const re = globToRegExp(pattern)
  const files = await walkFiles(cwd)
  const matched: Array<{ path: string; mtime: number }> = []
  for (const file of files) {
    const rel = toPosix(path.relative(cwd, file))
    if (!re.test(rel)) continue
    try {
      const st = await fsp.stat(file)
      matched.push({ path: file, mtime: st.mtimeMs })
    } catch {
      /* file vanished between walk and stat */
    }
  }
  matched.sort((a, b) => b.mtime - a.mtime)
  return {
    success: true,
    cwd,
    count: matched.length,
    truncated: matched.length > limit,
    files: matched.slice(0, limit).map((m) => m.path),
  }
}

// ── grep ──────────────────────────────────────────────────────────────────────

let rgChecked = false
let rgAvailable = false

function ripgrepAvailable(): Promise<boolean> {
  if (rgChecked) return Promise.resolve(rgAvailable)
  return new Promise((resolve) => {
    execFile('rg', ['--version'], (err: any) => {
      rgChecked = true
      rgAvailable = !err
      resolve(rgAvailable)
    })
  })
}

interface GrepMatch { file: string; line: number; text: string }

function grepWithRipgrep(
  pattern: string,
  searchPath: string,
  include: string,
  ignoreCase: boolean,
  limit: number,
): Promise<GrepMatch[]> {
  return new Promise((resolve, reject) => {
    const args = ['--line-number', '--no-heading', '--color=never', '--max-columns=400']
    if (ignoreCase) args.push('--ignore-case')
    if (include) args.push('--glob', include)
    args.push('--regexp', pattern, '--', searchPath)
    execFile('rg', args, { maxBuffer: 16 * 1024 * 1024 }, (err: any, stdout: string) => {
      // ripgrep exits 1 when there are simply no matches — not an error.
      if (err && err.code !== 1 && !stdout) {
        reject(new Error(err.message || 'ripgrep failed'))
        return
      }
      const matches: GrepMatch[] = []
      for (const raw of String(stdout || '').split('\n')) {
        if (!raw || matches.length >= limit) break
        // <file>:<line>:<text> — file paths may contain colons, so split carefully.
        const m = raw.match(/^(.*?):(\d+):(.*)$/)
        if (!m) continue
        matches.push({ file: m[1], line: Number(m[2]), text: m[3] })
      }
      resolve(matches)
    })
  })
}

async function grepWithJs(
  pattern: string,
  searchPath: string,
  include: string,
  ignoreCase: boolean,
  limit: number,
): Promise<GrepMatch[]> {
  const re = new RegExp(pattern, ignoreCase ? 'i' : '')
  const includeRe = include ? globToRegExp(include.includes('/') ? include : '**/' + include) : null
  const stat = await fsp.stat(searchPath).catch(() => null)
  const files = stat?.isFile() ? [searchPath] : await walkFiles(searchPath)
  const matches: GrepMatch[] = []
  for (const file of files) {
    if (matches.length >= limit) break
    if (includeRe && !includeRe.test(toPosix(path.relative(searchPath, file)))) continue
    let content: string
    try {
      content = await fsp.readFile(file, 'utf8')
    } catch {
      continue
    }
    if (content.includes(String.fromCharCode(0))) continue // skip binary files
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= limit) break
      if (re.test(lines[i])) {
        matches.push({ file, line: i + 1, text: lines[i].slice(0, 400) })
      }
    }
  }
  return matches
}

async function handleGrep(
  rawPattern: string,
  rawPath: string | undefined,
  opts: { include?: string; ignoreCase?: boolean; limit?: number } = {},
) {
  const pattern = String(rawPattern || '').trim()
  if (!pattern) return { success: false, error: 'pattern is required' }
  try {
    new RegExp(pattern)
  } catch (err: any) {
    return { success: false, error: `invalid regex: ${err?.message || String(err)}` }
  }
  const searchPath = resolvePath(rawPath)
  const include = opts.include ? String(opts.include) : ''
  const ignoreCase = !!opts.ignoreCase
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 150))
  try {
    const useRg = await ripgrepAvailable()
    const matches = useRg
      ? await grepWithRipgrep(pattern, searchPath, include, ignoreCase, limit)
      : await grepWithJs(pattern, searchPath, include, ignoreCase, limit)
    return {
      success: true,
      engine: useRg ? 'ripgrep' : 'js',
      count: matches.length,
      truncated: matches.length >= limit,
      matches,
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

// ── list ──────────────────────────────────────────────────────────────────────

async function handleList(rawPath: string | undefined, rawDepth?: number) {
  const root = resolvePath(rawPath)
  const depth = Math.max(1, Math.min(6, Number(rawDepth) || 2))
  const maxEntries = 800
  let count = 0
  let truncated = false
  const lines: string[] = []

  async function recurse(dir: string, level: number, prefix: string): Promise<void> {
    if (level > depth || truncated) return
    let entries: any[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const entry of entries) {
      if (count >= maxEntries) { truncated = true; return }
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
        lines.push(`${prefix}${entry.name}/ (skipped)`)
        count++
        continue
      }
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`)
        count++
        await recurse(path.join(dir, entry.name), level + 1, prefix + '  ')
      } else {
        lines.push(`${prefix}${entry.name}`)
        count++
      }
    }
  }

  try {
    const stat = await fsp.stat(root)
    if (!stat.isDirectory()) return { success: false, error: `${root} is not a directory` }
    await recurse(root, 1, '')
    return { success: true, path: root, depth, count, truncated, tree: lines.join('\n') }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

// ── patch (unified diff) ──────────────────────────────────────────────────────

interface DiffHunk { oldStart: number; lines: string[]; oldLeft: number; newLeft: number }
interface FilePatch { oldPath: string; newPath: string; hunks: DiffHunk[] }

/** Parse a unified diff into per-file patches. Tolerates git-style headers. */
function parseUnifiedDiff(diff: string): FilePatch[] {
  const lines = diff.split('\n')
  const patches: FilePatch[] = []
  let current: FilePatch | null = null
  let hunk: DiffHunk | null = null

  const stripPrefix = (p: string): string => {
    const t = p.trim().replace(/\t.*$/, '')
    if (t === '/dev/null') return t
    return t.replace(/^[ab]\//, '')
  }

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      if (current) patches.push(current)
      current = { oldPath: stripPrefix(line.slice(4)), newPath: '', hunks: [] }
      hunk = null
      continue
    }
    if (line.startsWith('+++ ') && current) {
      current.newPath = stripPrefix(line.slice(4))
      continue
    }
    if (line.startsWith('@@') && current) {
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      hunk = {
        oldStart: m ? Number(m[1]) : 1,
        oldLeft: m && m[2] !== undefined ? Number(m[2]) : 1,
        newLeft: m && m[4] !== undefined ? Number(m[4]) : 1,
        lines: [],
      }
      current.hunks.push(hunk)
      continue
    }
    // Only consume lines while the hunk still expects them — this stops
    // blank separator lines between hunks from being absorbed as context.
    if (hunk && (hunk.oldLeft > 0 || hunk.newLeft > 0)) {
      const tag = line[0]
      if (tag === ' ' || tag === '+' || tag === '-') {
        hunk.lines.push(line)
        if (tag !== '+') hunk.oldLeft--
        if (tag !== '-') hunk.newLeft--
      } else if (line === '') {
        // A truly empty line is treated as an empty context line — models
        // routinely drop the leading space on blank context lines.
        hunk.lines.push(' ')
        hunk.oldLeft--
        hunk.newLeft--
      }
      // `\ No newline at end of file` and stray text are ignored.
    }
  }
  if (current) patches.push(current)
  return patches.filter((p) => p.hunks.length > 0 || p.oldPath === '/dev/null')
}

/** Apply parsed hunks to file content; tolerant of small line-offset drift. */
function applyHunks(original: string, hunks: DiffHunk[]): { content: string; error?: string } {
  let lines = original.split('\n')
  let drift = 0
  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h]
    const oldBlock: string[] = []
    const newBlock: string[] = []
    for (const l of hunk.lines) {
      const tag = l[0]
      const body = l.slice(1)
      if (tag === ' ') { oldBlock.push(body); newBlock.push(body) }
      else if (tag === '-') { oldBlock.push(body) }
      else if (tag === '+') { newBlock.push(body) }
    }
    const matchesAt = (idx: number): boolean => {
      if (idx < 0 || idx + oldBlock.length > lines.length) return false
      for (let k = 0; k < oldBlock.length; k++) {
        if (lines[idx + k] !== oldBlock[k]) return false
      }
      return true
    }
    let at = hunk.oldStart - 1 + drift
    if (!matchesAt(at)) {
      let found = -1
      for (let radius = 1; radius <= 200 && found === -1; radius++) {
        if (matchesAt(at - radius)) found = at - radius
        else if (matchesAt(at + radius)) found = at + radius
      }
      if (found === -1) {
        return { content: original, error: `hunk #${h + 1} did not match the file (context drifted too far)` }
      }
      at = found
    }
    lines = [...lines.slice(0, at), ...newBlock, ...lines.slice(at + oldBlock.length)]
    drift += newBlock.length - oldBlock.length
  }
  return { content: lines.join('\n') }
}

async function handlePatch(rawDiff: string, rawCwd?: string) {
  const diff = String(rawDiff || '')
  if (!diff.trim()) return { success: false, error: 'patch (a unified diff) is required' }
  const cwd = resolvePath(rawCwd)
  const patches = parseUnifiedDiff(diff)
  if (patches.length === 0) {
    return { success: false, error: 'no recognizable unified-diff hunks found in the patch' }
  }
  const applied: string[] = []
  for (const patch of patches) {
    const isCreate = patch.oldPath === '/dev/null'
    const isDelete = patch.newPath === '/dev/null'
    const targetRel = isDelete ? patch.oldPath : patch.newPath || patch.oldPath
    const target = path.resolve(cwd, targetRel)
    try {
      if (isDelete) {
        await fsp.rm(target, { force: true })
        applied.push(`deleted ${targetRel}`)
        continue
      }
      const original = isCreate ? '' : await fsp.readFile(target, 'utf8')
      const result = applyHunks(original, patch.hunks)
      if (result.error) {
        return { success: false, error: `${targetRel}: ${result.error}`, applied }
      }
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, result.content, 'utf8')
      applied.push(`${isCreate ? 'created' : 'patched'} ${targetRel}`)
    } catch (err: any) {
      return { success: false, error: `${targetRel}: ${err?.message || String(err)}`, applied }
    }
  }
  return { success: true, applied }
}

export function registerSearchIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('fs:glob', async (_e: any, pattern: string, cwd?: string, limit?: number) => {
    try {
      return await handleGlob(pattern, cwd, limit)
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('fs:grep', async (_e: any, pattern: string, searchPath?: string, opts?: any) => {
    return await handleGrep(pattern, searchPath, opts || {})
  })

  ipcMain.handle('fs:list', async (_e: any, dirPath?: string, depth?: number) => {
    return await handleList(dirPath, depth)
  })

  ipcMain.handle('fs:patch', async (_e: any, diff: string, cwd?: string) => {
    try {
      return await handlePatch(diff, cwd)
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}

module.exports = { registerSearchIpc }

export {}
