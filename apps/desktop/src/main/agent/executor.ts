// ────────────────────────────────────────────────────────────────────────────
// DORMANT: this file is NOT wired into the current agent path.
//
// Today the renderer agent tools call the unified handlers in ipc/terminal.ts
// and ipc/filesystem.ts. Those handlers do NOT consult the allowlist or audit
// log implemented here. Destructive-command gating lives in ipc/terminal.ts
// (DESTRUCTIVE_PATTERNS + dialog.showMessageBox).
//
// Keeping this module around because the allowlist + JSONL audit log are a
// solid starting point if we later want a stricter "ask" / corporate mode.
// To re-wire: replace the bodies of terminal:exec / fs:* IPC handlers to call
// runCommand / readFile / writeFile from here instead of the direct calls.
// ────────────────────────────────────────────────────────────────────────────

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

/**
 * Decode HTML character references in a single pass to avoid double-unescaping
 * (e.g. &amp;lt; → &lt;, not → <). Call this once, after all tag removal is done.
 */
function decodeHtmlEntities(str: string): string {
  return str.replace(/&(?:amp|quot|apos|#39|lt|gt|nbsp|#x[\da-fA-F]+|#\d+);/gi, (entity) => {
    const lower = entity.toLowerCase()
    if (lower === '&amp;') return '&'
    if (lower === '&quot;') return '"'
    if (lower === '&apos;' || lower === '&#39;') return "'"
    if (lower === '&lt;') return '<'
    if (lower === '&gt;') return '>'
    if (lower === '&nbsp;') return ' '
    if (lower.startsWith('&#x')) return String.fromCharCode(parseInt(entity.slice(3, -1), 16))
    if (lower.startsWith('&#')) return String.fromCharCode(parseInt(entity.slice(2, -1), 10))
    return entity
  })
}

function tagNameAt(value: string, start: number): { closing: boolean; name: string; nameEnd: number } | null {
  let i = start + 1
  while (i < value.length && /\s/.test(value[i])) i += 1

  const closing = value[i] === '/'
  if (closing) {
    i += 1
    while (i < value.length && /\s/.test(value[i])) i += 1
  }

  const nameStart = i
  while (i < value.length && /[a-z0-9]/i.test(value[i])) i += 1
  if (i === nameStart) return null

  return { closing, name: value.slice(nameStart, i).toLowerCase(), nameEnd: i }
}

function isEndTagBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === '>' || ch === '/' || /\s/.test(ch)
}

function findRawTextBlockEnd(value: string, from: number, tagName: 'script' | 'style'): number {
  const lower = value.toLowerCase()
  let searchFrom = from

  while (searchFrom < value.length) {
    const closeStart = lower.indexOf(`</${tagName}`, searchFrom)
    if (closeStart === -1) return value.length

    const nameEnd = closeStart + tagName.length + 2
    if (isEndTagBoundary(value[nameEnd])) {
      const closeEnd = value.indexOf('>', nameEnd)
      return closeEnd === -1 ? value.length : closeEnd + 1
    }

    searchFrom = closeStart + 2
  }

  return value.length
}

function textFromHtml(value: string): string {
  let out = ''
  let i = 0

  while (i < value.length) {
    if (value[i] !== '<') {
      out += value[i]
      i += 1
      continue
    }

    const tag = tagNameAt(value, i)
    const tagEnd = value.indexOf('>', tag?.nameEnd ?? i + 1)
    if (!tag || tagEnd === -1) {
      i += 1
      continue
    }

    if (!tag.closing && (tag.name === 'script' || tag.name === 'style')) {
      out += ' '
      i = findRawTextBlockEnd(value, tagEnd + 1, tag.name)
      continue
    }

    if (tag.closing && /^(?:p|div|h[1-6]|li|tr|section|article)$/.test(tag.name)) {
      out += '\n'
    } else if (!tag.closing && tag.name === 'br') {
      out += '\n'
    } else if (!tag.closing && tag.name === 'li') {
      out += '- '
    } else if (!tag.closing && /^h[1-6]$/.test(tag.name)) {
      out += '\n## '
    }

    i = tagEnd + 1
  }

  return out
}

function stripHtml(value: string): string {
  // Strip tags first, then decode entities in a single pass to prevent
  // cascaded double-unescaping (e.g. &amp;lt; → &lt; → <).
  return decodeHtmlEntities(
    textFromHtml(value)
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function decodeDuckDuckGoRedirect(url: string): string {
  try {
    const parsed = new URL(url, 'https://duckduckgo.com')
    const uddg = parsed.searchParams.get('uddg')
    return uddg || parsed.toString()
  } catch {
    return url
  }
}

// ── Tavily remote MCP server (https://github.com/tavily-ai/tavily-mcp) ────────
// Preferred web-search backend when an API key is configured. We talk to Tavily's
// hosted MCP endpoint (https://mcp.tavily.com/mcp/?tavilyApiKey=…) over the MCP
// Streamable-HTTP transport — initialize → notifications/initialized → tools/call
// for the `tavily-search` tool — instead of the bare REST API. Falls back to the
// keyless DuckDuckGo scraping path below when no key is present or the MCP call errors.
const TAVILY_MCP_BASE = 'https://mcp.tavily.com/mcp/'

let keytarModule: any = null
function loadKeytar(): any {
  if (keytarModule !== null) return keytarModule || null
  try {
    keytarModule = require('keytar')
  } catch {
    keytarModule = false // sentinel: tried and unavailable
  }
  return keytarModule || null
}

async function getTavilyApiKey(): Promise<string> {
  const fromEnv = String(process.env.TAVILY_API_KEY || '').trim()
  if (fromEnv) return fromEnv
  const kt = loadKeytar()
  if (kt) {
    try {
      const stored = await kt.getPassword('syntax-senpai-keys', 'tavily')
      if (stored && String(stored).trim()) return String(stored).trim()
    } catch {
      // keytar read failed — treat as no key, fall back to DuckDuckGo
    }
  }
  return ''
}

// A Streamable-HTTP MCP response is either a single JSON-RPC object
// (application/json) or an SSE stream (text/event-stream) whose `data:` frames
// each carry one JSON-RPC message. Pull the frame matching our request id.
function parseMcpHttpBody(contentType: string, body: string, wantId: number | null): any {
  if (!body) return null
  if (/text\/event-stream/i.test(contentType)) {
    let fallback: any = null
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const msg = JSON.parse(payload)
        if (wantId !== null && msg?.id === wantId) return msg
        if (fallback === null) fallback = msg
      } catch {
        // skip non-JSON keep-alive frames
      }
    }
    return fallback
  }
  return JSON.parse(body)
}

async function tavilyMcpRpc(
  endpoint: string,
  message: any,
  sessionId: string | null,
  signal: AbortSignal,
): Promise<{ result: any; sessionId: string | null }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
    signal,
  })

  const nextSession = response.headers.get('mcp-session-id') || sessionId
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Tavily MCP ${message?.method} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`)
  }

  // Notifications (no id) get a 202 with an empty body — nothing to parse.
  if (message?.id === undefined) {
    await response.text().catch(() => '')
    return { result: null, sessionId: nextSession }
  }

  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  const parsed = parseMcpHttpBody(contentType, text, message.id)
  if (parsed?.error) {
    throw new Error(`Tavily MCP ${message?.method} error: ${parsed.error?.message || JSON.stringify(parsed.error)}`)
  }
  return { result: parsed?.result, sessionId: nextSession }
}

// Extract Tavily's search payload from an MCP tools/call result. The server
// returns the data in structuredContent and/or as JSON inside a text content
// block, depending on version — try both, then normalize to { answer, results }.
function normalizeTavilyToolResult(toolResult: any, limit: number) {
  let data: any = toolResult?.structuredContent ?? null
  if (!data) {
    const textBlock = Array.isArray(toolResult?.content)
      ? toolResult.content.find((c: any) => c?.type === 'text' && typeof c.text === 'string')
      : null
    if (textBlock) {
      try {
        data = JSON.parse(textBlock.text)
      } catch {
        // Non-JSON text result — surface it as a single informational answer.
        data = { answer: textBlock.text, results: [] }
      }
    }
  }

  const results = (Array.isArray(data?.results) ? data.results : [])
    .map((item: any) => ({
      title: String(item?.title || item?.url || '').trim(),
      url: String(item?.url || '').trim(),
      snippet: String(item?.content || item?.snippet || '').trim(),
    }))
    .filter((r: { title: string; url: string }) => r.title && r.url)
    .slice(0, limit)

  return {
    answer: typeof data?.answer === 'string' ? data.answer : '',
    results,
  }
}

async function fetchTavilyResults(query: string, limit: number, apiKey: string) {
  const endpoint = `${TAVILY_MCP_BASE}?tavilyApiKey=${encodeURIComponent(apiKey)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    // 1) initialize handshake — establishes the MCP session.
    const init = await tavilyMcpRpc(
      endpoint,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'syntax-senpai', version: '0.0.1' },
        },
      },
      null,
      controller.signal,
    )
    const sessionId = init.sessionId

    // 2) initialized notification — required before tools/call.
    await tavilyMcpRpc(
      endpoint,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      sessionId,
      controller.signal,
    )

    // 3) call the tavily-search tool.
    const call = await tavilyMcpRpc(
      endpoint,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'tavily-search',
          arguments: {
            query,
            max_results: limit,
            search_depth: 'basic',
            include_answer: true,
          },
        },
      },
      sessionId,
      controller.signal,
    )

    if (call.result?.isError) {
      const errText = Array.isArray(call.result?.content)
        ? call.result.content.map((c: any) => c?.text).filter(Boolean).join(' ')
        : ''
      throw new Error(`Tavily MCP tavily-search returned an error${errText ? `: ${errText.slice(0, 200)}` : ''}`)
    }

    return normalizeTavilyToolResult(call.result, limit)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchDuckDuckGoHtmlResults(query: string, limit: number) {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      'user-agent': 'SyntaxSenpai/0.0.1 (+https://github.com/unoxyrich/SyntaxSenpai)',
    },
  })

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML search failed: ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html)) !== null && results.length < limit) {
    const url = decodeDuckDuckGoRedirect(match[1])
    const title = stripHtml(match[2])
    const snippet = stripHtml(match[3])
    if (!title || !url) continue
    results.push({ title, url, snippet })
  }

  return results
}

async function fetchDuckDuckGoInstantAnswer(query: string) {
  const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
    headers: {
      'user-agent': 'SyntaxSenpai/0.0.1 (+https://github.com/unoxyrich/SyntaxSenpai)',
    },
  })

  if (!response.ok) {
    throw new Error(`DuckDuckGo instant answer failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const related = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : []
  const relatedItems = related
    .flatMap((item: any) => Array.isArray(item?.Topics) ? item.Topics : [item])
    .filter((item: any) => typeof item?.Text === 'string' && typeof item?.FirstURL === 'string')
    .slice(0, 5)
    .map((item: any) => ({
      title: item.Text.split(' - ')[0] || item.Text,
      url: item.FirstURL,
      snippet: item.Text,
    }))

  return {
    abstract: typeof data?.AbstractText === 'string' ? data.AbstractText : '',
    abstractUrl: typeof data?.AbstractURL === 'string' ? data.AbstractURL : '',
    heading: typeof data?.Heading === 'string' ? data.Heading : '',
    related: relatedItems,
  }
}

export async function webSearch(query: string, limit = 5) {
  try {
    const normalizedQuery = String(query || '').trim()
    if (!normalizedQuery) {
      return { success: false, error: 'Search query cannot be empty' }
    }

    const cappedLimit = Math.max(1, Math.min(8, Number(limit) || 5))

    // Prefer Tavily when configured; fall back to DuckDuckGo on missing key/error.
    const tavilyKey = await getTavilyApiKey()
    if (tavilyKey) {
      try {
        const tavily = await fetchTavilyResults(normalizedQuery, cappedLimit, tavilyKey)
        const lines: string[] = [`Tavily search results for: ${normalizedQuery}`]
        if (tavily.answer) {
          lines.push(`\nAnswer: ${tavily.answer}`)
        }
        if (tavily.results.length === 0) {
          lines.push('\nNo search results found.')
        } else {
          tavily.results.forEach((result: { title: string; url: string; snippet?: string }, index: number) => {
            lines.push(`\n${index + 1}. ${result.title}\nURL: ${result.url}${result.snippet ? `\nSnippet: ${result.snippet}` : ''}`)
          })
        }
        return {
          success: true,
          provider: 'tavily',
          query: normalizedQuery,
          results: tavily.results,
          instant: tavily.answer ? { abstract: tavily.answer, abstractUrl: '', heading: '', related: [] } : undefined,
          content: lines.join('\n'),
        }
      } catch {
        // Tavily failed (auth/quota/network) — silently degrade to DuckDuckGo.
      }
    }

    const instant = await fetchDuckDuckGoInstantAnswer(normalizedQuery).catch(() => null)
    const htmlResults = await fetchDuckDuckGoHtmlResults(normalizedQuery, cappedLimit).catch(() => [])
    const results = htmlResults.length > 0
      ? htmlResults
      : (instant?.related || []).slice(0, cappedLimit)

    const lines: string[] = [`DuckDuckGo search results for: ${normalizedQuery}`]

    if (instant?.abstract) {
      lines.push(`\nInstant answer: ${instant.abstract}${instant.abstractUrl ? ` (${instant.abstractUrl})` : ''}`)
    }

    if (results.length === 0) {
      lines.push('\nNo search results found.')
    } else {
      results.forEach((result: { title: string; url: string; snippet?: string }, index: number) => {
        lines.push(`\n${index + 1}. ${result.title}\nURL: ${result.url}${result.snippet ? `\nSnippet: ${result.snippet}` : ''}`)
      })
    }

    return {
      success: true,
      provider: 'duckduckgo',
      query: normalizedQuery,
      results,
      instant: instant || undefined,
      content: lines.join('\n'),
    }
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Fetch a single URL and return its body as text/markdown or raw HTML.
 * Unlike webSearch (DuckDuckGo result links), this retrieves the actual page
 * the model/user named. http(s) only; 15s timeout; 2 MB body cap.
 */
export async function webFetch(url: string, format = 'text') {
  try {
    const target = String(url || '').trim()
    if (!target) return { success: false, error: 'url is required' }
    let parsed: URL
    try {
      parsed = new URL(target)
    } catch {
      return { success: false, error: `invalid URL: ${target}` }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: 'only http(s) URLs are allowed' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    let response: Response
    try {
      response = await fetch(parsed.toString(), {
        headers: { 'user-agent': 'SyntaxSenpai/0.0.1 (+https://github.com/unoxyrich/SyntaxSenpai)' },
        signal: controller.signal,
        redirect: 'follow',
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status} ${response.statusText}` }
    }

    const contentType = response.headers.get('content-type') || ''
    const MAX_BYTES = 2 * 1024 * 1024
    const raw = await response.text()
    const body = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw
    const truncated = raw.length > MAX_BYTES

    const wantsHtml = format === 'html'
    const isHtml = /text\/html|application\/xhtml/i.test(contentType) || /^\s*<(?:!doctype|html)/i.test(body)
    let content: string
    if (wantsHtml || !isHtml) {
      content = body
    } else {
      // Strip scripts/styles, convert block tags to newlines, drop the rest —
      // a readable text/markdown view that keeps paragraph structure.
      // Entity decoding is done last in a single pass via decodeHtmlEntities to
      // prevent double-unescaping (e.g. &amp;lt; must not become <).
      content = decodeHtmlEntities(
        textFromHtml(body)
          .replace(/[ \t]+/g, ' ')
          .replace(/ *\n */g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      )
    }

    return {
      success: true,
      url: parsed.toString(),
      contentType,
      truncated,
      content,
    }
  } catch (err: any) {
    const aborted = err?.name === 'AbortError'
    return { success: false, error: aborted ? 'request timed out after 15s' : (err?.message || String(err)) }
  }
}

module.exports = { runCommand, readFile, writeFile, listDirectory, openExternal, webSearch, webFetch, getAllowlist, saveAllowlist, addAllowed, removeAllowed }

export {}
