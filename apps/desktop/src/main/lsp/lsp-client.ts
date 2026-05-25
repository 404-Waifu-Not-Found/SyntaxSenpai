/**
 * Minimal Language Server Protocol client for the Electron main process.
 *
 * This is the engine behind the `lsp_diagnostics` and `lsp_hover` agent tools.
 * It speaks LSP JSON-RPC over a child process's stdio (Content-Length framing,
 * hand-rolled — no external dependency) and manages a small pool of long-lived
 * language-server sessions keyed by project root + server id.
 *
 * Supported servers (auto-detected on PATH or in the project's node_modules):
 *   - typescript-language-server  → .ts .tsx .mts .cts .js .jsx .mjs .cjs
 *   - pyright-langserver          → .py .pyi
 *   - gopls                       → .go
 *   - rust-analyzer               → .rs
 *
 * If a server binary is missing the call fails with a precise install hint
 * rather than hanging — the agent surfaces that to the user.
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

// ── Server registry ───────────────────────────────────────────────────────────

interface ServerDef {
  id: string
  bin: string
  args: string[]
  installHint: string
}

const TS_SERVER: ServerDef = {
  id: 'typescript',
  bin: 'typescript-language-server',
  args: ['--stdio'],
  installHint: 'npm install -g typescript-language-server typescript',
}
const PY_SERVER: ServerDef = {
  id: 'pyright',
  bin: 'pyright-langserver',
  args: ['--stdio'],
  installHint: 'npm install -g pyright',
}
const GO_SERVER: ServerDef = {
  id: 'gopls',
  bin: 'gopls',
  args: [],
  installHint: 'go install golang.org/x/tools/gopls@latest',
}
const RUST_SERVER: ServerDef = {
  id: 'rust-analyzer',
  bin: 'rust-analyzer',
  args: [],
  installHint: 'rustup component add rust-analyzer',
}

const EXT_SERVER: Record<string, ServerDef> = {
  '.ts': TS_SERVER, '.tsx': TS_SERVER, '.mts': TS_SERVER, '.cts': TS_SERVER,
  '.js': TS_SERVER, '.jsx': TS_SERVER, '.mjs': TS_SERVER, '.cjs': TS_SERVER,
  '.py': PY_SERVER, '.pyi': PY_SERVER,
  '.go': GO_SERVER,
  '.rs': RUST_SERVER,
}

const EXT_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
}

const ROOT_MARKERS = [
  '.git', 'package.json', 'tsconfig.json', 'jsconfig.json',
  'go.mod', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'setup.cfg',
]

/** Walk up from a file to the nearest directory containing a project marker. */
function findProjectRoot(filePath: string): string {
  let dir = path.dirname(path.resolve(filePath))
  const { root } = path.parse(dir)
  while (dir && dir !== root) {
    for (const marker of ROOT_MARKERS) {
      if (fs.existsSync(path.join(dir, marker))) return dir
    }
    dir = path.dirname(dir)
  }
  return path.dirname(path.resolve(filePath))
}

/** Prefer a project-local server binary (node_modules/.bin) over a global one. */
function resolveBin(root: string, bin: string): string {
  let dir = root
  const { root: fsRoot } = path.parse(dir)
  const candidates = process.platform === 'win32' ? [bin + '.cmd', bin + '.exe', bin] : [bin]
  while (dir) {
    for (const name of candidates) {
      const full = path.join(dir, 'node_modules', '.bin', name)
      if (fs.existsSync(full)) return full
    }
    if (dir === fsRoot) break
    dir = path.dirname(dir)
  }
  return bin // fall back to PATH lookup
}

// ── LSP session ───────────────────────────────────────────────────────────────

interface PendingRequest { resolve: (v: any) => void; reject: (e: any) => void; timer: any }

class LspSession {
  private proc: any = null
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private diagnostics = new Map<string, any[]>()
  private openDocs = new Map<string, number>()
  private publishListeners: Array<(uri: string) => void> = []
  private startPromise: Promise<void> | null = null
  private exited = false
  private stderr = ''
  lastUsed = Date.now()

  constructor(private def: ServerDef, private root: string) {}

  /** Spawn the server and run the LSP initialize handshake. Idempotent. */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = new Promise<void>((resolve, reject) => {
      const bin = resolveBin(this.root, this.def.bin)
      try {
        this.proc = spawn(bin, this.def.args, {
          cwd: this.root,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        })
      } catch (err: any) {
        reject(new Error(`failed to launch ${this.def.bin}: ${err?.message || err}`))
        return
      }

      this.proc.on('error', (err: any) => {
        this.exited = true
        const why = err?.code === 'ENOENT'
          ? `language server "${this.def.bin}" is not installed. Install it with: ${this.def.installHint}`
          : `language server "${this.def.bin}" failed: ${err?.message || err}`
        reject(new Error(why))
        this.failAllPending(why)
      })
      this.proc.on('exit', (code: number) => {
        this.exited = true
        this.failAllPending(`language server exited (code ${code})${this.stderr ? `: ${this.stderr.slice(-400)}` : ''}`)
      })
      this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
      this.proc.stderr.on('data', (chunk: Buffer) => { this.stderr += chunk.toString('utf8') })

      const rootUri = pathToFileURL(this.root).href
      this.request('initialize', {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true },
            publishDiagnostics: { relatedInformation: true, versionSupport: false },
            hover: { contentFormat: ['markdown', 'plaintext'] },
          },
          workspace: { workspaceFolders: true, configuration: true },
        },
      }, 30000)
        .then(() => {
          this.notify('initialized', {})
          resolve()
        })
        .catch(reject)
    })
    return this.startPromise
  }

  private failAllPending(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()
  }

  private write(message: Record<string, unknown>): void {
    if (this.exited || !this.proc?.stdin?.writable) return
    const body = JSON.stringify(message)
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
  }

  private request(method: string, params: unknown, timeoutMs = 20000): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`LSP request "${method}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private respond(id: number, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  /** Accumulate stdout and dispatch every complete Content-Length frame. */
  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk] as any)
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.slice(0, headerEnd).toString('utf8')
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.slice(bodyStart, bodyStart + length).toString('utf8')
      this.buffer = this.buffer.slice(bodyStart + length)
      try {
        this.dispatch(JSON.parse(body))
      } catch {
        /* ignore malformed frame */
      }
    }
  }

  private dispatch(msg: any): void {
    // Response to one of our requests.
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(msg.id)
      if (msg.error) pending.reject(new Error(msg.error.message || 'LSP error'))
      else pending.resolve(msg.result)
      return
    }
    // Server-to-client request — answer minimally so the server keeps going.
    if (msg.id !== undefined && msg.method) {
      if (msg.method === 'workspace/configuration') {
        const items = Array.isArray(msg.params?.items) ? msg.params.items : []
        this.respond(msg.id, items.map(() => ({})))
      } else {
        this.respond(msg.id, null)
      }
      return
    }
    // Notification.
    if (msg.method === 'textDocument/publishDiagnostics') {
      const uri = msg.params?.uri
      if (typeof uri === 'string') {
        this.diagnostics.set(uri, Array.isArray(msg.params?.diagnostics) ? msg.params.diagnostics : [])
        for (const listener of this.publishListeners) listener(uri)
      }
    }
  }

  private openOrUpdate(uri: string, languageId: string, text: string): void {
    const version = this.openDocs.get(uri)
    if (version === undefined) {
      this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId, version: 1, text },
      })
      this.openDocs.set(uri, 1)
    } else {
      const next = version + 1
      this.notify('textDocument/didChange', {
        textDocument: { uri, version: next },
        contentChanges: [{ text }],
      })
      this.openDocs.set(uri, next)
    }
  }

  /** Resolve once diagnostics for `uri` settle (debounced) or the timeout hits. */
  private waitForPublish(uri: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      let debounce: any = null
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(hard)
        if (debounce) clearTimeout(debounce)
        const idx = this.publishListeners.indexOf(listener)
        if (idx !== -1) this.publishListeners.splice(idx, 1)
        resolve()
      }
      const hard = setTimeout(finish, timeoutMs)
      const listener = (publishedUri: string): void => {
        if (publishedUri !== uri) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(finish, 700)
      }
      this.publishListeners.push(listener)
    })
  }

  async getDiagnostics(filePath: string, ext: string): Promise<any[]> {
    await this.start()
    this.lastUsed = Date.now()
    const uri = pathToFileURL(filePath).href
    const text = fs.readFileSync(filePath, 'utf8')
    const languageId = EXT_LANGUAGE[ext] || 'plaintext'
    this.diagnostics.delete(uri)
    this.openOrUpdate(uri, languageId, text)
    // rust-analyzer / gopls index the whole workspace before reporting.
    const timeout = this.def.id === 'rust-analyzer' || this.def.id === 'gopls' ? 25000 : 12000
    await this.waitForPublish(uri, timeout)
    return this.diagnostics.get(uri) || []
  }

  async getHover(filePath: string, ext: string, line: number, character: number): Promise<any> {
    await this.start()
    this.lastUsed = Date.now()
    const uri = pathToFileURL(filePath).href
    const text = fs.readFileSync(filePath, 'utf8')
    const languageId = EXT_LANGUAGE[ext] || 'plaintext'
    this.openOrUpdate(uri, languageId, text)
    const position = { line, character }
    let result = await this.request('textDocument/hover', { textDocument: { uri }, position })
    if (!result) {
      // The server may still be indexing; give it one more chance.
      await new Promise((r) => setTimeout(r, 900))
      result = await this.request('textDocument/hover', { textDocument: { uri }, position })
    }
    return result
  }

  dispose(): void {
    if (this.exited || !this.proc) return
    try {
      this.request('shutdown', null, 2000).catch(() => {})
      this.notify('exit', null)
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        if (!this.exited) this.proc.kill()
      } catch {
        /* ignore */
      }
    }, 600)
    this.exited = true
  }

  get crashed(): boolean {
    return this.exited
  }
}

// ── Session pool ──────────────────────────────────────────────────────────────

const sessions = new Map<string, LspSession>()
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
let sweeper: any = null

function ensureSweeper(): void {
  if (sweeper) return
  sweeper = setInterval(() => {
    const now = Date.now()
    for (const [key, session] of sessions) {
      if (session.crashed || now - session.lastUsed > IDLE_TIMEOUT_MS) {
        session.dispose()
        sessions.delete(key)
      }
    }
  }, 60000)
  if (typeof sweeper.unref === 'function') sweeper.unref()
}

function sessionFor(filePath: string): { session: LspSession; ext: string } {
  const ext = path.extname(filePath).toLowerCase()
  const def = EXT_SERVER[ext]
  if (!def) {
    throw new Error(`no language server is configured for "${ext || 'this file type'}". Supported: .ts .tsx .js .jsx .py .go .rs`)
  }
  const root = findProjectRoot(filePath)
  const key = `${root}::${def.id}`
  let session = sessions.get(key)
  if (!session || session.crashed) {
    session = new LspSession(def, root)
    sessions.set(key, session)
  }
  ensureSweeper()
  return { session, ext }
}

/** Run `tsc`/`pyright`-grade diagnostics for a file. Returns LSP Diagnostic[]. */
export async function lspDiagnostics(filePath: string): Promise<{ diagnostics: any[]; root: string }> {
  const resolved = path.resolve(filePath.startsWith('~')
    ? path.join(require('os').homedir(), filePath.slice(1))
    : filePath)
  if (!fs.existsSync(resolved)) throw new Error(`file not found: ${resolved}`)
  const { session, ext } = sessionFor(resolved)
  const diagnostics = await session.getDiagnostics(resolved, ext)
  return { diagnostics, root: findProjectRoot(resolved) }
}

/** Get LSP hover info (type/signature/docs) at a 0-based line/character. */
export async function lspHover(filePath: string, line: number, character: number): Promise<any> {
  const resolved = path.resolve(filePath.startsWith('~')
    ? path.join(require('os').homedir(), filePath.slice(1))
    : filePath)
  if (!fs.existsSync(resolved)) throw new Error(`file not found: ${resolved}`)
  const { session, ext } = sessionFor(resolved)
  return await session.getHover(resolved, ext, line, character)
}

/** Tear down every language server. Call on app quit. */
export function shutdownAllLsp(): void {
  for (const [, session] of sessions) session.dispose()
  sessions.clear()
  if (sweeper) {
    clearInterval(sweeper)
    sweeper = null
  }
}

module.exports = { lspDiagnostics, lspHover, shutdownAllLsp }

export {}
