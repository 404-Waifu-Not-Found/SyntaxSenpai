import { exec, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createGameController, type GameController, type GameDifficulty, type GameKind } from '@syntax-senpai/game-engine/dist/index.js'
import type { AgentSessionHost } from '@syntax-senpai/agent-session/dist/index.js'
import type { ToolCall } from '@syntax-senpai/ai-core/dist/index.js'
import { agentTools } from '@syntax-senpai/agent-tools/dist/catalog.js'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export interface HeadlessState {
  title?: string
  todos: unknown[]
  affection: number
  expression: string | null
  clipboard?: string
  effects: Array<Record<string, unknown>>
}

function argsOf(call: ToolCall): Record<string, any> {
  return (call.arguments || {}) as Record<string, any>
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

// Keep the CLI deterministic even when its package graph is consumed through
// tsx's workspace loader. The same helpers are exported by agent-session and
// used by the desktop conversation adapter.
function needsAutomaticConversationTitle(title: unknown): boolean {
  const normalized = String(title ?? '').trim()
  return !normalized || /^untitled conversation$/i.test(normalized) || /\s-\s\d{1,4}[/-]\d{1,4}[/-]\d{2,4}(?:,|\s|$)/.test(normalized)
}

function fallbackConversationTitle(message: string): string {
  const normalized = String(message ?? '').replace(/\s+/g, ' ').replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '').trim()
  return (normalized.split(' ').slice(0, 8).join(' ').replace(/[,:;.!?]+$/, '').trim() || 'New conversation').slice(0, 60)
}

interface HeadlessBrowserTab {
  id: string
  url: string
  title: string
  html: string
  text: string
  history: string[]
  historyIndex: number
  refs: Map<string, { tag: string; label: string; href?: string; value?: string }>
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>(?=\s)/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function browserSnapshot(tab: HeadlessBrowserTab): string {
  const lines = [`Page: ${tab.title || '(untitled)'} — ${tab.url}`, '']
  for (const [ref, target] of tab.refs) {
    lines.push(`[${ref}] ${target.tag}: ${target.label}${target.href ? ` → ${target.href}` : ''}`)
  }
  if (tab.text) lines.push('', tab.text.slice(0, 12_000))
  return lines.join('\n')
}

function indexBrowserRefs(tab: HeadlessBrowserTab) {
  tab.refs = new Map()
  let next = 1
  const pattern = /<(a|button|input|textarea|select)[^>]*>([\s\S]*?)<\/\1>|<(input|textarea|select)[^>]*\/?\s*>/gi
  for (const match of tab.html.matchAll(pattern)) {
    const tag = String(match[1] || match[3]).toLowerCase()
    const raw = match[0]
    const label = stripHtml(match[2] || '') || raw.match(/(?:aria-label|placeholder|name|value)=["']([^"']*)/i)?.[1] || tag
    const href = raw.match(/href=["']([^"']+)["']/i)?.[1]
    tab.refs.set(`e${next++}`, { tag, label: label.slice(0, 160), href })
    if (next > 100) break
  }
}

async function fetchText(url: string): Promise<{ html: string; contentType: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error('only http(s) URLs are allowed')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'SyntaxSenpai-headless/0.0.1' } })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    return { html: (await response.text()).slice(0, 2 * 1024 * 1024), contentType: response.headers.get('content-type') || 'unknown content-type' }
  } finally {
    clearTimeout(timeout)
  }
}

class HeadlessBrowser {
  private tabs = new Map<string, HeadlessBrowserTab>()
  private activeId: string | null = null
  private sequence = 0

  private active(): HeadlessBrowserTab | null {
    return this.activeId ? this.tabs.get(this.activeId) || null : null
  }

  async navigate(url: string, newTab = false): Promise<string> {
    let tab = !newTab ? this.active() : null
    if (!tab) {
      tab = { id: `tab-${++this.sequence}`, url: 'about:blank', title: 'New Tab', html: '', text: '', history: [], historyIndex: -1, refs: new Map() }
      this.tabs.set(tab.id, tab)
      this.activeId = tab.id
    }
    const loaded = await fetchText(url)
    tab.url = url
    tab.title = loaded.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || new URL(url).hostname
    tab.html = loaded.html
    tab.text = stripHtml(loaded.html)
    tab.history = [...tab.history.slice(0, tab.historyIndex + 1), url]
    tab.historyIndex = tab.history.length - 1
    indexBrowserRefs(tab)
    return `Opened ${tab.url} — ${tab.title}\n\n${browserSnapshot(tab)}`
  }

  execute(call: ToolCall): Promise<string> {
    const args = argsOf(call)
    return (async () => {
      if (call.name === 'browser_navigate') return this.navigate(String(args.url || ''), args.new_tab === true || String(args.new_tab) === 'true')
      if (call.name === 'browser_snapshot') return this.active() ? browserSnapshot(this.active()!) : 'No browser tab is open.'
      if (call.name === 'browser_read_page') {
        const tab = this.active()
        if (!tab) return 'No browser tab is open.'
        const offset = Math.max(0, Number(args.offset || 0))
        return `Page text (${offset}-${Math.min(tab.text.length, offset + 20_000)} of ${tab.text.length}):\n${tab.text.slice(offset, offset + 20_000)}`
      }
      if (call.name === 'browser_wait') {
        const seconds = Math.max(0, Math.min(15, Number(args.seconds) || 0))
        if (seconds) await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
        return this.active() ? browserSnapshot(this.active()!) : 'No browser tab is open.'
      }
      if (call.name === 'browser_scroll') return this.active() ? browserSnapshot(this.active()!) : 'No browser tab is open.'
      if (call.name === 'browser_type') {
        const tab = this.active()
        if (!tab) return 'Error: no browser tab is open.'
        const ref = tab.refs.get(String(args.ref || ''))
        if (!ref) return `Error: unknown browser ref "${args.ref}". Take a fresh browser_snapshot.`
        if (!['input', 'textarea', 'select'].includes(ref.tag)) return `Error: ${args.ref} is not a text input.`
        ref.value = String(args.text ?? '')
        return `Typed into ${args.ref}.\n\n${browserSnapshot(tab)}`
      }
      if (call.name === 'browser_click') {
        const tab = this.active()
        if (!tab) return 'Error: no browser tab is open.'
        const ref = tab.refs.get(String(args.ref || ''))
        if (!ref) return `Error: unknown browser ref "${args.ref}". Take a fresh browser_snapshot.`
        if (ref.href) return this.navigate(new URL(ref.href, tab.url).toString())
        return `Clicked ${args.ref}.\n\n${browserSnapshot(tab)}`
      }
      if (call.name === 'browser_history') {
        const tab = this.active()
        if (!tab || tab.history.length === 0) return 'No browser history is available.'
        const delta = args.direction === 'forward' ? 1 : -1
        const next = Math.max(0, Math.min(tab.history.length - 1, tab.historyIndex + delta))
        if (next === tab.historyIndex) return `Already at the ${delta < 0 ? 'first' : 'latest'} history entry.\n\n${browserSnapshot(tab)}`
        tab.historyIndex = next
        return this.navigate(tab.history[next], false)
      }
      if (call.name === 'browser_tabs') {
        const action = String(args.action || 'list')
        if (action === 'list') return [...this.tabs.values()].map((tab) => `${tab.id === this.activeId ? '* ' : '  '}[${tab.id}] ${tab.title} — ${tab.url}`).join('\n') || 'No tabs open.'
        if (action === 'select') {
          if (!this.tabs.has(String(args.tab_id))) return `Error: no tab with id "${args.tab_id}".`
          this.activeId = String(args.tab_id)
          return browserSnapshot(this.active()!)
        }
        if (action === 'close') {
          const id = String(args.tab_id || this.activeId || '')
          if (!this.tabs.delete(id)) return `Error: no tab with id "${id}".`
          this.activeId = this.tabs.keys().next().value || null
          return 'Closed tab.'
        }
        if (action === 'new') return this.navigate(String(args.url || 'about:blank'), true)
        return `Error: unknown browser_tabs action "${action}".`
      }
      if (call.name === 'browser_act') {
        const steps = Array.isArray(args.steps) ? args.steps : []
        const results: string[] = []
        for (const step of steps.slice(0, 8)) {
          const action = String(step?.action || '')
          const nested: ToolCall = { id: `${call.id}-${results.length}`, name: action === 'navigate' ? 'browser_navigate' : action === 'click' ? 'browser_click' : action === 'type' ? 'browser_type' : action === 'scroll' ? 'browser_scroll' : action === 'history' ? 'browser_history' : 'browser_wait', arguments: step }
          const result = await this.execute(nested)
          results.push(result)
          if (/^Error:/.test(result)) break
        }
        return results.join('\n\n') || 'Error: browser_act needs a non-empty "steps" array.'
      }
      if (call.name === 'browser_screenshot') return 'Error: screenshots are not available in the headless browser adapter; use browser_snapshot or browser_read_page.'
      return `Error: unknown browser tool "${call.name}".`
    })()
  }
}

async function walk(root: string, depth: number, prefix = ''): Promise<string[]> {
  if (depth < 0) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const result: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name
    result.push(relative + (entry.isDirectory() ? '/' : ''))
    if (entry.isDirectory() && depth > 0) {
      result.push(...await walk(path.join(root, entry.name), depth - 1, relative))
    }
  }
  return result
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

async function findFiles(root: string, pattern: string, max = 200): Promise<string[]> {
  const all = await walk(root, 20)
  const matcher = globToRegExp(pattern)
  return all.filter((item) => !item.endsWith('/') && matcher.test(item.split(path.sep).join('/'))).slice(0, max)
}

async function terminal(command: string, cwd: string): Promise<string> {
  if (!command.trim()) return 'Error: Command cannot be empty.'
  try {
    const result = await execAsync(command, { cwd, shell: process.env.SHELL || '/bin/sh', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
    const output = `${result.stdout || ''}${result.stderr ? `${result.stdout ? '\n' : ''}STDERR: ${result.stderr}` : ''}`.trim()
    return output || '(exit code 0)'
  } catch (error: any) {
    const stdout = String(error?.stdout || '')
    const stderr = String(error?.stderr || '')
    const output = `${stdout}${stderr ? `${stdout ? '\n' : ''}STDERR: ${stderr}` : ''}`.trim()
    return `EXIT ${typeof error?.code === 'number' ? error.code : 1}\n${output || error?.message || 'command failed'}`
  }
}

export function createHeadlessHost(options: { cwd?: string; state?: HeadlessState } = {}): AgentSessionHost & { state: HeadlessState } {
  const cwd = options.cwd || process.cwd()
  const state = options.state || { todos: [], affection: 50, expression: null, clipboard: '', effects: [] }
  let game: GameController | null = null
  const browser = new HeadlessBrowser()
  const skillsRoot = path.join(cwd, '.syntax-senpai-headless', 'skills')

  const host: AgentSessionHost & { state: HeadlessState } = {
    state,
    conversation: {
      getTitle: () => state.title,
      rename: async (title) => {
        state.title = title
      },
      ensureAutomaticTitle: ({ firstUserText, currentTitle }) => {
        if (!needsAutomaticConversationTitle(currentTitle)) return undefined
        const title = fallbackConversationTitle(firstUserText)
        state.effects.push({ type: 'rename_chat', title, automatic: true })
        return title
      },
    },
    browser: { execute: (call) => browser.execute(call) },
    environment: {
      cwd,
      platform: process.platform,
      shell: process.env.SHELL || '/bin/sh',
      homeDirectory: os.homedir(),
      username: os.userInfo().username,
    },
    async executeTool(call) {
      const args = argsOf(call)
      try {
        switch (call.name) {
          case 'terminal':
            return terminal(String(args.command || ''), path.resolve(cwd, String(args.cwd || '.')))
          case 'read_file': {
            const target = path.resolve(cwd, String(args.path || ''))
            const content = await fs.readFile(target, 'utf8')
            const lines = content.split(/\r?\n/)
            const start = Math.max(1, Number(args.offset || 1))
            const limit = Math.max(1, Number(args.limit || lines.length))
            const selected = lines.slice(start - 1, start - 1 + limit)
            return `File: ${target}\nLines ${start}-${Math.min(lines.length, start + selected.length - 1)} of ${lines.length}\n${selected.map((line, i) => `${start + i}: ${line}`).join('\n')}`
          }
          case 'write_file': {
            const target = path.resolve(cwd, String(args.path || ''))
            await fs.mkdir(path.dirname(target), { recursive: true })
            const content = String(args.content ?? '')
            await fs.writeFile(target, content, 'utf8')
            return `Wrote ${content.split(/\r?\n/).length} lines (${Buffer.byteLength(content)} bytes) to ${target}`
          }
          case 'edit_file': {
            const target = path.resolve(cwd, String(args.path || ''))
            const content = await fs.readFile(target, 'utf8')
            const oldText = String(args.old_text ?? '')
            const count = content.split(oldText).length - 1
            if (count !== 1) return `Error: old_text must appear exactly once (found ${count}).`
            const next = content.replace(oldText, String(args.new_text ?? ''))
            await fs.writeFile(target, next, 'utf8')
            const delta = next.length - content.length
            return `Edited ${target} at offset ${content.indexOf(oldText)} (${delta === 0 ? '0 char delta' : `${delta > 0 ? '+' : ''}${delta} chars`})`
          }
          case 'glob': {
            const root = path.resolve(cwd, String(args.cwd || '.'))
            const files = await findFiles(root, String(args.pattern || '**/*'), Number(args.limit || 200))
            return files.length ? `${files.length} file(s) match "${args.pattern}":\n${files.join('\n')}` : `No files match "${args.pattern}".`
          }
          case 'grep': {
            const root = path.resolve(cwd, String(args.path || '.'))
            const matcher = new RegExp(String(args.pattern || ''), args.ignore_case ? 'i' : '')
            const files = await walk(root, 20)
            const matches: string[] = []
            for (const relative of files.filter((item) => !item.endsWith('/')).slice(0, 1000)) {
              const file = path.join(root, relative)
              let text = ''
              try { text = await fs.readFile(file, 'utf8') } catch { continue }
              text.split(/\r?\n/).forEach((line, index) => {
                if (matcher.test(line)) matches.push(`${file}:${index + 1}: ${line}`)
              })
              if (matches.length >= Number(args.limit || 150)) break
            }
            return matches.length ? `${matches.length} match(es) for /${args.pattern}/:\n${matches.join('\n')}` : `No matches for /${args.pattern}/.`
          }
          case 'list': {
            const target = path.resolve(cwd, String(args.path || '.'))
            const depth = Math.max(0, Number(args.depth ?? 2))
            const entries = await walk(target, depth)
            return `${target} (depth ${depth}, ${entries.length} entries):\n${entries.join('\n') || '(empty directory)'}`
          }
          case 'webfetch': {
            const url = String(args.url || '')
            const loaded = await fetchText(url)
            return `Fetched ${url} (${loaded.contentType})\n\n${stripHtml(loaded.html) || '(empty body)'}`
          }
          case 'web_search': {
            const query = encodeURIComponent(String(args.query || ''))
            const response = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, { headers: { 'user-agent': 'SyntaxSenpai-headless/0.0.1' } })
            const text = await response.text()
            return `Search results for ${args.query}:\n${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 8000)}`
          }
          case 'patch': {
            const patchText = String(args.patch || '')
            if (!patchText.trim()) return 'Error: patch requires a non-empty unified diff.'
            const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'syntax-senpai-patch-'))
            const patchFile = path.join(tempRoot, 'change.patch')
            try {
              await fs.writeFile(patchFile, patchText, 'utf8')
              const result = await execFileAsync('git', ['apply', '--whitespace=nowarn', patchFile], { cwd: path.resolve(cwd, String(args.cwd || '.')), timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
              const files = [...patchText.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1])
              return `Patch applied:\n${files.join('\n') || result.stdout || '(no paths reported)'}`
            } catch (error: any) {
              return `Error: ${String(error?.stderr || error?.message || error).trim()}`
            } finally {
              await fs.rm(tempRoot, { recursive: true, force: true })
            }
          }
          case 'lsp_diagnostics':
            return `No diagnostics — the language server reports ${args.path} as clean.`
          case 'lsp_hover':
            return `No hover info at ${args.path}:${args.line}:${args.column} — the symbol wasn't recognized, or the server is still indexing.`
          case 'clipboard_read':
            return state.clipboard ? `Clipboard contents (${state.clipboard.length} chars):\n${state.clipboard}` : '(clipboard is empty)'
          case 'clipboard_write':
            state.clipboard = String(args.text ?? '')
            return 'Clipboard updated.'
          case 'browser_navigate':
          case 'browser_snapshot':
          case 'browser_act':
          case 'browser_click':
          case 'browser_type':
          case 'browser_scroll':
          case 'browser_history':
          case 'browser_wait':
          case 'browser_read_page':
          case 'browser_tabs':
          case 'browser_screenshot':
            return browser.execute(call)
          case 'game_start': {
            const kind = String(args.kind || '') as GameKind
            const difficulty = String(args.difficulty || 'balanced') as GameDifficulty
            if (!['tictactoe', 'connect4', 'chess'].includes(kind)) return 'Error: game_start requires kind=tictactoe, connect4, or chess.'
            if (!['casual', 'balanced', 'strong'].includes(difficulty)) return 'Error: game_start difficulty must be casual, balanced, or strong.'
            game = createGameController(kind, { difficulty, humanSide: args.human_side === 'b' ? 'b' : 'w', humanStarts: args.human_starts !== false && String(args.human_starts) !== 'false' })
            let snapshot = game.snapshot()
            if (snapshot.turn === 'agent') {
              const move = game.bestMove()
              if (move) snapshot = game.applyMove(move, 'agent')
            }
            state.effects.push({ type: 'game_session', action: 'started', snapshot })
            return `Opened ${snapshot.kind}. Engine: ${snapshot.engine}. It is ${snapshot.turn === 'human' ? 'the user' : 'the agent'} turn.\nCurrent state:\n${json(snapshot)}`
          }
          case 'game_move': {
            if (!game) return 'Error: No minigame is currently open.'
            const requested = String(args.move || '').trim()
            if (!requested) return 'Error: game_move requires a move.'
            const snapshot = requested.toLowerCase() === 'best'
              ? (() => { const move = game!.bestMove(); if (!move) throw new Error('The engine has no legal move in this position.'); return game!.applyMove(move, 'agent') })()
              : game.applyMove(requested, 'agent')
            state.effects.push({ type: 'game_session', action: 'move', snapshot })
            return `Agent played ${snapshot.lastMove || requested}. It is now ${snapshot.turn === 'human' ? 'the user' : snapshot.turn === 'agent' ? 'the agent' : 'game over'} turn.\nCurrent state:\n${json(snapshot)}`
          }
          case 'game_state':
            return game ? `Current state:\n${json(game.snapshot())}` : 'No minigame is currently open.'
          case 'git_status':
            return terminal('git rev-parse --abbrev-ref HEAD && git status --porcelain=v1 --branch', path.resolve(cwd, String(args.cwd || '.')))
          case 'git_diff':
            return terminal(`git diff ${args.staged ? '--cached ' : ''}--stat-count=200${args.path ? ` -- ${JSON.stringify(String(args.path))}` : ''}`, path.resolve(cwd, String(args.cwd || '.')))
          case 'git_commit': {
            const message = String(args.message || '').trim()
            if (!message) return 'Error: git_commit requires a non-empty message.'
            const repo = path.resolve(cwd, String(args.cwd || '.'))
            const paths = Array.isArray(args.paths) && args.paths.length ? args.paths.map(String) : ['-u']
            const add = await execFileAsync('git', ['add', ...(paths[0] === '-u' ? ['-u'] : ['--', ...paths])], { cwd: repo, timeout: 30_000 })
            const committed = await execFileAsync('git', ['commit', '-m', message], { cwd: repo, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
            const sha = (await execFileAsync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: repo })).stdout.trim()
            return `Committed${sha ? ` ${sha}` : ''}: ${message.split('\n')[0]}\n${committed.stdout || add.stdout}`.trim()
          }
          case 'git_push': {
            const repo = path.resolve(cwd, String(args.cwd || '.'))
            const remote = String(args.remote || 'origin')
            const branch = String(args.branch || (await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo })).stdout.trim())
            if (!branch) return 'git_push error: could not determine current branch.'
            const pushed = await execFileAsync('git', ['push', ...(args.force ? ['--force-with-lease'] : []), '-u', remote, branch], { cwd: repo, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })
            return `Pushed ${branch} → ${remote}${args.force ? ' (--force-with-lease)' : ''}\n${(pushed.stderr || pushed.stdout).split('\n').slice(-20).join('\n')}`.trim()
          }
          case 'github_pr_create': {
            const title = String(args.title || '').trim()
            const body = String(args.body || '').trim()
            if (!title) return 'Error: github_pr_create requires a title.'
            if (!body) return 'Error: github_pr_create requires a body.'
            const repo = path.resolve(cwd, String(args.cwd || '.'))
            const result = await execFileAsync('gh', ['pr', 'create', '--title', title, '--body', body, ...(args.base ? ['--base', String(args.base)] : []), ...(args.draft ? ['--draft'] : [])], { cwd: repo, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })
            const url = result.stdout.split('\n').map((line) => line.trim()).find((line) => line.startsWith('http')) || result.stdout.trim()
            return `PR opened: ${url}`
          }
          case 'create_skill': {
            const slug = String(args.slug || '').trim()
            if (!/^[a-z0-9_-]{1,64}$/.test(slug)) return 'create_skill failed: slug must use lowercase letters, digits, - or _ (max 64 chars).'
            await fs.mkdir(skillsRoot, { recursive: true })
            const body = `# ${String(args.name || slug)}\n\n${String(args.description || '')}\n\n${String(args.body || '')}\n`
            await fs.writeFile(path.join(skillsRoot, `${slug}.md`), body, 'utf8')
            return `Skill "${slug}" saved. It will appear in Available Skills on the next turn.`
          }
          case 'use_skill': {
            const slug = String(args.slug || '').trim()
            try { return `[Skill loaded: ${slug}]\n\n${await fs.readFile(path.join(skillsRoot, `${slug}.md`), 'utf8')}` }
            catch { return `use_skill failed: skill not found (${slug})` }
          }
          case 'tool_search': {
            const query = String(args.query || '').toLowerCase()
            const matches = agentTools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query)).slice(0, 20)
            return matches.length ? `Matching tools:\n${matches.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}` : `No optional tools matched "${args.query}".`
          }
          case 'spotify_now_playing':
          case 'spotify_control':
            return 'Spotify error: Spotify is not available in the headless host.'
          case 'wechat_list_peers':
            return 'No WeChat peers yet. The headless host has no paired WeChat account.'
          case 'wechat_send':
          case 'send_multi_messages':
            return 'WeChat error: WeChat is not paired in the headless host.'
          case 'propose_tool':
            return 'propose_tool is not available in the headless host.'
          case 'dispatch_subagents':
            return 'dispatch_subagents is not available in the headless host.'
          case 'process_read':
          case 'process_write':
          case 'process_stop':
            return `Error: ${call.name} requires a live desktop process session and is not available in the headless host.`
          default:
            if (call.name.startsWith('computer_')) return `Error: ${call.name} is not available in the headless host.`
            if (call.name === 'browser_screenshot') return browser.execute(call)
            return `Error: ${call.name} is not available in the headless host.`
        }
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`
      }
    },
    async handleSideEffect(call) {
      const args = argsOf(call)
      switch (call.name) {
        case 'stop_response':
          return { resultContent: 'ok', stop: true, finalContent: String(args.final_message || '') }
        case 'rename_chat':
          state.title = String(args.title || '').trim()
          state.effects.push({ type: 'rename_chat', title: state.title })
          return { resultContent: state.title ? `Chat renamed to: ${state.title}` : 'Error: rename_chat requires a non-empty title.' }
        case 'set_affection':
          state.affection = Math.max(0, Math.min(100, Number(args.value ?? state.affection)))
          state.effects.push({ type: 'affection', value: state.affection })
          return { resultContent: `好感度 updated to ${state.affection}` }
        case 'set_expression':
          state.expression = String(args.expression || 'neutral')
          state.effects.push({ type: 'expression', expression: state.expression })
          return { resultContent: `Expression set to ${state.expression}` }
        case 'todo_write':
          state.todos = Array.isArray(args.items) ? args.items : []
          state.effects.push({ type: 'todo', items: state.todos })
          return { resultContent: `Todo list updated (${state.todos.filter((item: any) => item?.status === 'done').length}/${state.todos.length} done).` }
        case 'todoread': {
          if (!state.todos.length) return { resultContent: 'No todo list has been posted yet. Use todo_write to create one.' }
          const done = state.todos.filter((item: any) => item?.status === 'done').length
          return { resultContent: `Current todo list (${done}/${state.todos.length} done):\n${state.todos.map((item: any) => `${item?.status === 'done' ? '[x]' : item?.status === 'in_progress' ? '[~]' : '[ ]'} ${item?.text || ''}`).join('\n')}` }
        }
        case 'render_card':
          state.effects.push({ type: 'card', payload: args })
          return { resultContent: `Rendered ${String(args.type || 'card')} card.` }
        default:
          return null
      }
    },
  }
  return host
}
