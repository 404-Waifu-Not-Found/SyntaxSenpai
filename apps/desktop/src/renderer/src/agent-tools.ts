/**
 * Agent tool definitions and executor for AI tool calling.
 *
 * Tools:
 *  - `terminal`       – run any shell command in a real terminal
 *  - `web_search`     – optionally fetch DuckDuckGo result links/snippets
 *  - `stop_response`  – signal the AI is done and deliver a final message
 *
 * The executor routes calls through Electron IPC to the main process
 * which runs commands via child_process.exec with the user's login shell.
 */

import { getAllProviderMetadata } from '@syntax-senpai/ai-core'
import type { ToolDefinition, ToolCall } from '@syntax-senpai/ai-core'
import { renderContentToPng } from './services/render-to-image'
import { sendWeChatImageWithFallback } from './services/wechat-image-send'
import * as browserController from './browser/controller'
import { useBrowserStore } from './stores/browser'
import {
  applyBestAgentMove,
  applyGameSessionMove,
  getGameSessionSnapshot,
  startGameSession,
} from './game/session'
import type { GameDifficulty, GameKind } from '@syntax-senpai/game-engine'

export type AgentMode = 'auto' | 'full'

// Keep the renderer on the browser-safe tool catalog. The package root also
// exports filesystem-backed plugin and Live2D helpers, which must stay in the
// main process. Importing the root here makes Vite externalize node:url and
// crashes the renderer before the window can paint.
export {
  parseTodoList,
  agentTools,
  STOP_TOOL_NAME,
  SET_AFFECTION_TOOL_NAME,
  SET_EXPRESSION_TOOL_NAME,
  TODO_WRITE_TOOL_NAME,
  TODO_READ_TOOL_NAME,
  RENAME_CHAT_TOOL_NAME,
  RENDER_CARD_TOOL_NAME,
  GAME_START_TOOL_NAME,
  GAME_MOVE_TOOL_NAME,
  GAME_STATE_TOOL_NAME,
  GIT_COMMIT_TOOL_NAME,
  GIT_PUSH_TOOL_NAME,
  GITHUB_PR_CREATE_TOOL_NAME,
  CREATE_SKILL_TOOL_NAME,
  USE_SKILL_TOOL_NAME,
  PROPOSE_TOOL_TOOL_NAME,
  DISPATCH_SUBAGENTS_TOOL_NAME,
  WECHAT_SEND_TOOL_NAME,
  WECHAT_LIST_PEERS_TOOL_NAME,
  SEND_MULTI_MESSAGES_TOOL_NAME,
  BROWSER_SCREENSHOT_TOOL_NAME,
  BROWSER_TOOLS,
  CODING_MODE_TOOLS,
  CARD_MARKER_FENCE,
} from '@syntax-senpai/agent-tools/catalog'
export type { RenderCardPayload, RenderCardType, TodoItem } from '@syntax-senpai/agent-tools/catalog'
import { parseTodoList, agentTools, STOP_TOOL_NAME, SET_AFFECTION_TOOL_NAME, SET_EXPRESSION_TOOL_NAME, TODO_WRITE_TOOL_NAME, TODO_READ_TOOL_NAME, RENAME_CHAT_TOOL_NAME, RENDER_CARD_TOOL_NAME, GAME_START_TOOL_NAME, GAME_MOVE_TOOL_NAME, GAME_STATE_TOOL_NAME, GIT_COMMIT_TOOL_NAME, GIT_PUSH_TOOL_NAME, GITHUB_PR_CREATE_TOOL_NAME, CREATE_SKILL_TOOL_NAME, USE_SKILL_TOOL_NAME, PROPOSE_TOOL_TOOL_NAME, DISPATCH_SUBAGENTS_TOOL_NAME, WECHAT_SEND_TOOL_NAME, WECHAT_LIST_PEERS_TOOL_NAME, SEND_MULTI_MESSAGES_TOOL_NAME, BROWSER_SCREENSHOT_TOOL_NAME, BROWSER_TOOLS, CODING_MODE_TOOLS } from '@syntax-senpai/agent-tools/catalog'

/**
 * Conservative pattern check for whether a model accepts image input.
 * Gates browser_screenshot — text-only models simply never see the tool.
 */
export function modelSupportsVision(model: string): boolean {
  return getAllProviderMetadata().some(p => p.supportsToolCalling && p.models.some(m => m.id === model && m.supportsVision))
}

// browser_screenshot results are images; string tool results can't carry them,
// so the executor parks the capture here and the chat loop injects it as a
// user-role image_url message right after the tool result (see run-turn.ts
// collectFollowupMessages).
let pendingBrowserScreenshot: string | null = null

export function consumePendingBrowserScreenshot(): string | null {
  const shot = pendingBrowserScreenshot
  pendingBrowserScreenshot = null
  return shot
}

/**
 * Tool definitions contributed by enabled plugins in <userData>/plugins/
 * (or the repo-local plugins/). Populated lazily by loadPluginTools()
 * so the synchronous getToolsForMode() can still return a merged list.
 */
let pluginToolsCache: ToolDefinition[] = []
let pluginToolsLoaded = false
let pluginToolsPromise: Promise<void> | null = null

/**
 * Ask the main process for plugin tool definitions. Idempotent — returns
 * the same in-flight promise if called concurrently, and no-ops after the
 * first successful load. Safe to call on every app mount.
 */
export async function loadPluginTools(): Promise<void> {
  if (pluginToolsLoaded) return
  if (pluginToolsPromise) return pluginToolsPromise
  const ipc = (window as any).electron?.ipcRenderer
  if (!ipc) {
    pluginToolsLoaded = true
    return
  }
  pluginToolsPromise = (async () => {
    try {
      const res = await ipc.invoke('plugins:listTools')
      if (res?.success && Array.isArray(res.tools)) {
        pluginToolsCache = res.tools as ToolDefinition[]
      }
    } catch {
      /* plugin system is optional */
    } finally {
      pluginToolsLoaded = true
      pluginToolsPromise = null
    }
  })()
  return pluginToolsPromise
}

/** Names of currently-loaded plugin tools; used to route execution. */
function isPluginTool(name: string): boolean {
  return pluginToolsCache.some((t) => t.name === name)
}

/**
 * Returns tools available for a given agent mode.
 * - auto: all tools; caller should run AI approval before executing actions
 * - full: all tools; caller may execute directly
 *
 * Plugin-contributed tools (loaded via loadPluginTools) are appended
 * unconditionally — per-plugin enable/disable is handled on the main
 * side, so anything reaching this cache is already opt-in.
 */
export function getToolsForMode(
  mode: AgentMode,
  options: { webSearchEnabled?: boolean; codingMode?: boolean; browserEnabled?: boolean; visionCapable?: boolean } = {},
): ToolDefinition[] {
  // Coding-mode tools (git_commit / git_push / github_pr_create) only appear when /code is active.
  const base = agentTools.filter((tool) => {
    if (tool.name === 'web_search') return options.webSearchEnabled === true
    if (CODING_MODE_TOOLS.has(tool.name)) return options.codingMode === true
    if (BROWSER_TOOLS.has(tool.name)) {
      if (options.browserEnabled !== true) return false
      // Screenshot results are images — only offer it to vision-capable models.
      if (tool.name === BROWSER_SCREENSHOT_TOOL_NAME) return options.visionCapable === true
      return true
    }
    return true
  })
  // Plugin-contributed tools are appended unconditionally — per-plugin
  // enable/disable is handled on the main side, so anything reaching
  // pluginToolsCache is already opt-in.
  return [...base, ...pluginToolsCache]
}

/**
 * Resolve a WeChat `to` argument (a userId, or a display name to fuzzy-match)
 * against the peers list. Returns an error string to hand back to the model
 * when a name can't be matched to any known peer.
 */
async function resolveWeChatPeer(
  ipc: any,
  to: string,
): Promise<{ userId: string } | { error: string }> {
  const peersRes = await ipc.invoke('wechat:listPeers')
  const peers: Array<{ userId: string; displayName?: string | null }> =
    peersRes?.success && Array.isArray(peersRes.peers) ? peersRes.peers : []
  if (peers.some((p) => p.userId === to)) return { userId: to }
  const needle = to.toLowerCase()
  const byName =
    peers.find((p) => (p.displayName ?? '').toLowerCase() === needle) ||
    peers.find((p) => (p.displayName ?? '').toLowerCase().includes(needle))
  if (byName) return { userId: byName.userId }
  if (peers.length > 0) {
    return {
      error: `Could not resolve "${to}" to a WeChat userId. Known peers: ${peers
        .slice(0, 10)
        .map((p) => `${p.displayName ?? '?'}=${p.userId}`)
        .join(', ')}.`,
    }
  }
  // No peers known yet — fall through with the raw value (matches prior behavior).
  return { userId: to }
}

/**
 * Execute a browser tool against the embedded browser panel. All page
 * interaction goes through the renderer-side controller directly (no IPC
 * round-trip); tab management goes through the browser Pinia store.
 */
async function executeBrowserTool(toolCall: ToolCall): Promise<string> {
  const args = toolCall.arguments as Record<string, any>
  const browserStore = useBrowserStore()
  if (!browserStore.aiControlEnabled) {
    return 'Browser control is disabled. Ask the user to enable "AI browser control" in Settings → AI.'
  }

  try {
    switch (toolCall.name) {
      case 'browser_navigate': {
        const url = String(args.url || '')
        if (!browserController.isAllowedBrowserUrl(url)) {
          return `Error: only http(s) URLs are allowed in the embedded browser (got "${url}").`
        }
        browserStore.openPanel()
        const wantNewTab = args.new_tab === true || String(args.new_tab) === 'true'
        if (wantNewTab || browserStore.tabs.length === 0) {
          const tab = browserStore.newTab(url)
          const wv = await browserController.waitForWebview(tab.id)
          if (!wv) return 'Error: the browser tab failed to open. Try again.'
          await browserController.waitForSettle(wv, 10000)
          const snap = await browserController.snapshot(tab.id)
          return `Opened ${wv.getURL()} — ${wv.getTitle()}\n\n${snap}`
        }
        await browserController.waitForWebview(browserStore.activeTabId)
        const info = await browserController.navigate(url)
        const snap = await browserController.snapshot()
        return `Navigated to ${info.url} — ${info.title}\n\n${snap}`
      }

      case 'browser_snapshot':
        return await browserController.snapshot()

      case 'browser_act': {
        browserStore.openPanel()
        const steps = Array.isArray(args.steps) ? args.steps : []
        if (steps.length === 0) return 'Error: browser_act needs a non-empty "steps" array.'
        // If there is no tab yet but the first step navigates, open it first.
        if (browserStore.tabs.length === 0) {
          const first = steps[0] || {}
          if (String(first.action) !== 'navigate' || !first.url) {
            return 'Error: no browser tab is open. Make the first step a {action:"navigate", url:...}.'
          }
          // Open a blank tab and let the navigate step below do the single load.
          const tab = browserStore.newTab()
          if (!(await browserController.waitForWebview(tab.id))) {
            return 'Error: the browser tab failed to open. Try again.'
          }
        }
        const { summaries, snapshotText, stoppedAtStep } = await browserController.runSteps(steps)
        const header = stoppedAtStep
          ? `Ran ${stoppedAtStep} of ${steps.length} step(s):`
          : `Ran ${summaries.length} step(s):`
        const log = summaries.map((s, i) => `${i + 1}. ${s}`).join('\n')
        return `${header}\n${log}${snapshotText ? `\n\n${snapshotText}` : ''}`
      }

      case 'browser_wait': {
        const seconds = Math.max(0.1, Math.min(15, Number(args.seconds) || 2))
        const summary = await browserController.waitFor(seconds, args.until_text ? String(args.until_text) : undefined)
        const snap = await browserController.snapshot()
        return `${summary}\n\n${snap}`
      }

      case 'browser_click': {
        const { summary, snapshotText } = await browserController.click(String(args.ref || ''))
        return `${summary}\n\n${snapshotText}`
      }

      case 'browser_type': {
        const { summary, snapshotText } = await browserController.type(
          String(args.ref || ''),
          String(args.text ?? ''),
          { submit: args.submit === true || String(args.submit) === 'true', clear: args.clear !== false && String(args.clear) !== 'false' },
        )
        return `${summary}\n\n${snapshotText}`
      }

      case 'browser_scroll': {
        const direction = args.direction === 'up' ? 'up' : 'down'
        const pages = Math.max(1, Math.min(10, Number(args.pages) || 1))
        const { summary, snapshotText } = await browserController.scroll(direction, pages, args.ref ? String(args.ref) : undefined)
        return `${summary}\n\n${snapshotText}`
      }

      case 'browser_history': {
        const direction = args.direction === 'forward' ? 'forward' : 'back'
        const { summary, snapshotText } = await browserController.history(direction)
        return snapshotText ? `${summary}\n\n${snapshotText}` : summary
      }

      case 'browser_read_page':
        return await browserController.readPage(Math.max(0, Number(args.offset) || 0))

      case 'browser_tabs': {
        const action = String(args.action || 'list')
        if (action === 'list') {
          if (browserStore.tabs.length === 0) return 'No tabs open. Use browser_navigate to open a page.'
          return browserStore.tabs
            .map((t) => `${t.id === browserStore.activeTabId ? '* ' : '  '}[${t.id}] ${t.title} — ${t.url}`)
            .join('\n')
        }
        if (action === 'new') {
          browserStore.openPanel()
          const url = args.url ? String(args.url) : ''
          const count = Math.max(1, Math.min(20, Math.floor(Number(args.count) || 1)))
          if (url && !browserController.isAllowedBrowserUrl(url)) {
            return `Error: only http(s) URLs are allowed (got "${url}").`
          }
          const tabs = Array.from({ length: count }, () => browserStore.newTab(url || undefined))
          const webviews = await Promise.all(tabs.map((tab) => browserController.waitForWebview(tab.id)))
          if (count > 1) {
            const opened = webviews.filter(Boolean).length
            return `Opened ${opened}/${count} new tabs${url ? ` at ${url}` : ''}. Active tab: [${tabs[tabs.length - 1].id}].`
          }
          const tab = tabs[0]
          const wv = webviews[0]
          if (url && wv) {
            await browserController.waitForSettle(wv, 10000)
            const snap = await browserController.snapshot(tab.id)
            return `Opened new tab [${tab.id}] at ${wv.getURL()}\n\n${snap}`
          }
          return `Opened new empty tab [${tab.id}]. Use browser_navigate to load a page.`
        }
        if (action === 'close') {
          const id = String(args.tab_id || '')
          if (!browserStore.tabs.some((t) => t.id === id)) return `Error: no tab with id "${id}". Use action=list to see tabs.`
          browserStore.closeTab(id)
          return `Closed tab [${id}]. ${browserStore.tabs.length} tab(s) remain.`
        }
        if (action === 'select') {
          const id = String(args.tab_id || '')
          if (!browserStore.tabs.some((t) => t.id === id)) return `Error: no tab with id "${id}". Use action=list to see tabs.`
          browserStore.selectTab(id)
          await browserController.waitForWebview(id)
          const snap = await browserController.snapshot(id)
          return `Switched to tab [${id}].\n\n${snap}`
        }
        return `Error: unknown browser_tabs action "${action}".`
      }

      case BROWSER_SCREENSHOT_TOOL_NAME: {
        const { dataUrl } = await browserController.screenshot()
        pendingBrowserScreenshot = dataUrl
        return 'Screenshot captured — it is attached as an image in the next message. Remember this is a fallback; prefer browser_snapshot for interaction.'
      }
    }
    return `Error: unknown browser tool "${toolCall.name}".`
  } catch (err: any) {
    return `Error: ${err?.message || String(err)}`
  }
}

/**
 * Execute a single tool call via Electron IPC.
 * Returns the string result to feed back to the AI.
 *
 * `stop_response` is handled by the caller (chat store loop),
 * so it should never reach the executor — but we handle it gracefully.
 */
export async function executeToolCall(toolCall: ToolCall): Promise<string> {
  if (toolCall.name === GAME_START_TOOL_NAME) {
    const args = (toolCall.arguments ?? {}) as Record<string, unknown>
    const allowedKinds: GameKind[] = ['tictactoe', 'connect4', 'chess']
    const allowedDifficulties: GameDifficulty[] = ['casual', 'balanced', 'strong']
    const kind = String(args.kind || '') as GameKind
    const difficulty = String(args.difficulty || 'balanced') as GameDifficulty
    if (!allowedKinds.includes(kind)) return 'Error: game_start requires kind=tictactoe, connect4, or chess.'
    if (!allowedDifficulties.includes(difficulty)) return 'Error: game_start difficulty must be casual, balanced, or strong.'
    try {
      const snapshot = startGameSession(kind, {
        difficulty,
        humanSide: args.human_side === 'b' ? 'b' : 'w',
        humanStarts: args.human_starts !== false && String(args.human_starts) !== 'false',
      })
      return `Opened ${snapshot.kind}. Engine: ${snapshot.engine}. It is ${snapshot.turn === 'human' ? 'the user' : 'the agent'} turn.\nCurrent state:\n${JSON.stringify(snapshot)}`
    } catch (err: any) {
      return `Error: could not start game: ${err?.message || String(err)}`
    }
  }

  if (toolCall.name === GAME_MOVE_TOOL_NAME) {
    const args = (toolCall.arguments ?? {}) as Record<string, unknown>
    const requestedMove = String(args.move || '').trim()
    if (!requestedMove) return 'Error: game_move requires a move.'
    try {
      const snapshot = requestedMove.toLowerCase() === 'best'
        ? applyBestAgentMove()
        : applyGameSessionMove(requestedMove, 'agent')
      return `Agent played ${snapshot.lastMove || requestedMove}. It is now ${snapshot.turn === 'human' ? 'the user' : snapshot.turn === 'agent' ? 'the agent' : 'game over'} turn.\nCurrent state:\n${JSON.stringify(snapshot)}`
    } catch (err: any) {
      return `Error: ${err?.message || String(err)}`
    }
  }

  if (toolCall.name === GAME_STATE_TOOL_NAME) {
    const snapshot = getGameSessionSnapshot()
    return snapshot ? `Current state:\n${JSON.stringify(snapshot)}` : 'No minigame is currently open.'
  }

  const ipc = (window as any).electron?.ipcRenderer
  if (!ipc) return 'Error: IPC bridge not available — is the app running in Electron?'

  const args = toolCall.arguments as Record<string, string>

  switch (toolCall.name) {
    case 'terminal': {
      const res = await ipc.invoke('terminal:exec', args.command)
      if (!res.success) return `Error: ${res.error}`
      let out = res.stdout || ''
      if (res.stderr) out += (out ? '\n' : '') + `STDERR: ${res.stderr}`
      if (!out.trim()) out = `(exit code ${res.code ?? 0})`
      if (typeof res.code === 'number' && res.code !== 0) {
        out = `EXIT ${res.code}\n${out}`
      }
      return out
    }

    case 'read_file': {
      const offset = args.offset !== undefined ? Number(args.offset) : undefined
      const limit = args.limit !== undefined ? Number(args.limit) : undefined
      const res = await ipc.invoke('fs:read', args.path, offset, limit)
      if (!res.success) return `Error: ${res.error}`
      const header = `File: ${res.path}\nLines ${res.startLine}-${res.endLine} of ${res.totalLines}\n`
      return header + res.content
    }

    case 'write_file': {
      const res = await ipc.invoke('fs:write', args.path, args.content ?? '')
      if (!res.success) return `Error: ${res.error}`
      return `Wrote ${res.lines} lines (${res.bytes} bytes) to ${res.path}`
    }

    case 'edit_file': {
      const res = await ipc.invoke('fs:edit', args.path, args.old_text, args.new_text)
      if (!res.success) return `Error: ${res.error}`
      const deltaLabel = res.delta === 0 ? '0 char delta' : `${res.delta > 0 ? '+' : ''}${res.delta} chars`
      return `Edited ${res.path} at offset ${res.replacedAt} (${deltaLabel})`
    }

    case 'glob': {
      const limit = args.limit !== undefined ? Number(args.limit) : undefined
      const res = await ipc.invoke('fs:glob', args.pattern, args.cwd, limit)
      if (!res.success) return `Error: ${res.error}`
      if (!Array.isArray(res.files) || res.files.length === 0) return `No files match "${args.pattern}".`
      const header = `${res.count} file(s) match "${args.pattern}"${res.truncated ? ` (showing newest ${res.files.length})` : ''}:`
      return `${header}\n${res.files.join('\n')}`
    }

    case 'grep': {
      const opts = {
        include: args.include,
        ignoreCase: (args as any).ignore_case === true || String((args as any).ignore_case) === 'true',
        limit: args.limit !== undefined ? Number(args.limit) : undefined,
      }
      const res = await ipc.invoke('fs:grep', args.pattern, args.path, opts)
      if (!res.success) return `Error: ${res.error}`
      if (!Array.isArray(res.matches) || res.matches.length === 0) return `No matches for /${args.pattern}/.`
      const lines = res.matches.map((m: any) => `${m.file}:${m.line}: ${m.text}`)
      const header = `${res.count} match(es)${res.truncated ? ' (truncated)' : ''} for /${args.pattern}/:`
      return `${header}\n${lines.join('\n')}`
    }

    case 'list': {
      const depth = args.depth !== undefined ? Number(args.depth) : undefined
      const res = await ipc.invoke('fs:list', args.path, depth)
      if (!res.success) return `Error: ${res.error}`
      const header = `${res.path} (depth ${res.depth}, ${res.count} entries${res.truncated ? ', truncated' : ''}):`
      return `${header}\n${res.tree || '(empty directory)'}`
    }

    case 'patch': {
      const res = await ipc.invoke('fs:patch', (args as any).patch, args.cwd)
      if (!res.success) {
        const partial = Array.isArray(res.applied) && res.applied.length
          ? `\nApplied before the failure: ${res.applied.join('; ')}`
          : ''
        return `Error: ${res.error}${partial}`
      }
      return `Patch applied:\n${(res.applied || []).join('\n')}`
    }

    case 'webfetch': {
      const res = await ipc.invoke('agent:webFetch', args.url, (args as any).format)
      if (!res.success) return `webfetch error: ${res.error}`
      const head = `Fetched ${res.url} (${res.contentType || 'unknown content-type'})${res.truncated ? ' [truncated to 2 MB]' : ''}`
      return `${head}\n\n${res.content || '(empty body)'}`
    }

    case 'lsp_diagnostics': {
      const res = await ipc.invoke('lsp:diagnostics', args.path)
      if (!res.success) return `lsp_diagnostics error: ${res.error}`
      if (res.count === 0) return `No diagnostics — the language server reports ${args.path} as clean.`
      const lines = res.diagnostics.map((d: any) =>
        `${String(d.severity).toUpperCase()} ${d.line}:${d.character} — ${d.message}${d.source ? ` [${d.source}${d.code ? ' ' + d.code : ''}]` : ''}`,
      )
      return `${res.count} diagnostic(s) for ${args.path}:\n${lines.join('\n')}`
    }

    case 'lsp_hover': {
      const res = await ipc.invoke('lsp:hover', args.path, Number(args.line), Number((args as any).column))
      if (!res.success) return `lsp_hover error: ${res.error}`
      if (!res.found) {
        return `No hover info at ${args.path}:${args.line}:${(args as any).column} — the symbol wasn't recognized, or the server is still indexing.`
      }
      return res.contents
    }

    case 'web_search': {
      if (localStorage.getItem('syntax-senpai-web-search-enabled') !== 'true') {
        return 'Web search is disabled. Enable it in Settings before using web_search.'
      }
      const res = await ipc.invoke('agent:webSearch', args.query, args.limit || 5)
      if (!res.success) return `Web search error: ${res.error}`
      return res.content || 'No search results found.'
    }

    case 'browser_navigate':
    case 'browser_snapshot':
    case 'browser_click':
    case 'browser_type':
    case 'browser_scroll':
    case 'browser_history':
    case 'browser_read_page':
    case 'browser_tabs':
    case BROWSER_SCREENSHOT_TOOL_NAME:
      return executeBrowserTool(toolCall)

    case 'clipboard_read': {
      const res = await ipc.invoke('clipboard:read')
      if (!res.success) return `Clipboard error: ${res.error}`
      const text = res.text || ''
      return text ? `Clipboard contents (${text.length} chars):\n${text}` : '(clipboard is empty)'
    }

    case 'clipboard_write': {
      const res = await ipc.invoke('clipboard:write', String(args.text ?? ''))
      if (!res.success) return `Clipboard error: ${res.error}`
      return 'Clipboard updated.'
    }

    case 'git_status': {
      const cwdFlag = args.cwd ? `cd ${JSON.stringify(args.cwd)} && ` : ''
      const res = await ipc.invoke(
        'terminal:exec',
        `${cwdFlag}git rev-parse --abbrev-ref HEAD && git status --porcelain=v1 --branch`,
      )
      if (!res.success) return `git_status error: ${res.error}`
      if (res.code && res.code !== 0) return `git_status failed (exit ${res.code}):\n${res.stderr || res.stdout}`
      return res.stdout || '(clean working tree)'
    }

    case 'git_diff': {
      const cwdFlag = args.cwd ? `cd ${JSON.stringify(args.cwd)} && ` : ''
      const flags = [
        args.staged ? '--cached' : '',
        '--stat-count=200',
      ].filter(Boolean).join(' ')
      const pathArg = args.path ? ` -- ${JSON.stringify(args.path)}` : ''
      const res = await ipc.invoke('terminal:exec', `${cwdFlag}git diff ${flags}${pathArg}`)
      if (!res.success) return `git_diff error: ${res.error}`
      if (res.code && res.code !== 0) return `git_diff failed (exit ${res.code}):\n${res.stderr || res.stdout}`
      return res.stdout || '(no changes)'
    }

    case GIT_COMMIT_TOOL_NAME: {
      const a = toolCall.arguments as { message?: string; paths?: string[]; cwd?: string }
      const message = (a.message ?? '').trim()
      if (!message) return 'Error: git_commit requires a non-empty message.'
      const cwd = a.cwd || ''
      const cwdFlag = cwd ? `cd ${JSON.stringify(cwd)} && ` : ''
      const pathsArg = Array.isArray(a.paths) && a.paths.length > 0
        ? a.paths.map((p) => JSON.stringify(p)).join(' ')
        : '-u'
      // HEREDOC-safe: base64-encode the message and pipe into git commit -F -
      const b64 = btoa(unescape(encodeURIComponent(message)))
      const cmd = `${cwdFlag}git add ${pathsArg} && echo "${b64}" | base64 --decode | git commit -F -`
      const res = await ipc.invoke('terminal:exec', cmd)
      if (!res.success) return `git_commit error: ${res.error}`
      if (res.code && res.code !== 0) return `git_commit failed (exit ${res.code}):\n${res.stderr || res.stdout}`
      const shaRes = await ipc.invoke('terminal:exec', `${cwdFlag}git rev-parse HEAD`)
      const sha = (shaRes?.stdout || '').trim().slice(0, 12)
      return `Committed${sha ? ` ${sha}` : ''}: ${message.split('\n')[0]}`
    }

    case GIT_PUSH_TOOL_NAME: {
      const a = toolCall.arguments as { remote?: string; branch?: string; force?: boolean; cwd?: string }
      const cwdFlag = a.cwd ? `cd ${JSON.stringify(a.cwd)} && ` : ''
      const remote = a.remote || 'origin'
      const remoteSafe = JSON.stringify(remote)
      let branch = (a.branch || '').trim()
      if (!branch) {
        const b = await ipc.invoke('terminal:exec', `${cwdFlag}git rev-parse --abbrev-ref HEAD`)
        branch = (b?.stdout || '').trim()
      }
      if (!branch) return 'git_push error: could not determine current branch.'
      const branchSafe = JSON.stringify(branch)
      // Detect upstream to choose between `git push` and `git push -u origin <branch>`
      const upstreamCheck = await ipc.invoke('terminal:exec', `${cwdFlag}git rev-parse --abbrev-ref --symbolic-full-name '@{u}'`)
      const hasUpstream = upstreamCheck?.success && upstreamCheck?.code === 0
      const flags = a.force ? '--force-with-lease' : ''
      const cmd = hasUpstream
        ? `${cwdFlag}git push ${flags} ${remoteSafe} ${branchSafe}`.replace(/\s+/g, ' ').trim()
        : `${cwdFlag}git push -u ${flags} ${remoteSafe} ${branchSafe}`.replace(/\s+/g, ' ').trim()
      const res = await ipc.invoke('terminal:exec', cmd)
      if (!res.success) return `git_push error: ${res.error}`
      const tail = (res.stderr || res.stdout || '').split('\n').slice(-20).join('\n')
      if (res.code && res.code !== 0) return `git_push failed (exit ${res.code}):\n${tail}`
      return `Pushed ${branch} → ${remote}${a.force ? ' (--force-with-lease)' : ''}\n${tail}`
    }

    case GITHUB_PR_CREATE_TOOL_NAME: {
      const a = toolCall.arguments as { title?: string; body?: string; base?: string; draft?: boolean; cwd?: string }
      const title = (a.title ?? '').trim()
      const body = (a.body ?? '').trim()
      if (!title) return 'Error: github_pr_create requires a title.'
      if (!body) return 'Error: github_pr_create requires a body.'
      const cwdFlag = a.cwd ? `cd ${JSON.stringify(a.cwd)} && ` : ''
      const ghCheck = await ipc.invoke('terminal:exec', 'gh --version')
      if (!ghCheck?.success || (ghCheck.code && ghCheck.code !== 0)) {
        return 'github_pr_create error: the `gh` CLI is not installed or not on PATH. Ask the user to install it from https://cli.github.com and run `gh auth login`.'
      }
      const titleB64 = btoa(unescape(encodeURIComponent(title)))
      const bodyB64 = btoa(unescape(encodeURIComponent(body)))
      const baseFlag = a.base ? ` --base ${JSON.stringify(a.base)}` : ''
      const draftFlag = a.draft ? ' --draft' : ''
      const cmd = `${cwdFlag}TITLE=$(echo "${titleB64}" | base64 --decode) && BODY=$(echo "${bodyB64}" | base64 --decode) && gh pr create --title "$TITLE" --body "$BODY"${baseFlag}${draftFlag}`
      const res = await ipc.invoke('terminal:exec', cmd)
      if (!res.success) return `github_pr_create error: ${res.error}`
      if (res.code && res.code !== 0) return `github_pr_create failed (exit ${res.code}):\n${res.stderr || res.stdout}`
      const url = (res.stdout || '').split('\n').map((l: string) => l.trim()).find((l: string) => l.startsWith('http')) || res.stdout
      return `PR opened: ${url}`
    }

    case TODO_WRITE_TOOL_NAME: {
      const items = parseTodoList((args as any).items)
      if (items.length === 0) return 'Error: todo_write requires a non-empty items array.'
      const done = items.filter((i) => i.status === 'done').length
      return `Todo list updated (${done}/${items.length} done).`
    }

    case TODO_READ_TOOL_NAME:
      // The live list lives in the chat store; the loop intercepts this call.
      // If we reach here the store had no list yet.
      return 'No todo list has been posted yet. Use todo_write to create one.'

    case RENAME_CHAT_TOOL_NAME: {
      // Actual rename happens in the chat store loop (which has conversation
      // id context). If we ever reach here the caller did not intercept —
      // return success so the model doesn't retry.
      const title = String((args as any).title ?? '').trim()
      return title ? `Chat renamed to: ${title}` : 'Error: rename_chat requires a non-empty title.'
    }

    case RENDER_CARD_TOOL_NAME: {
      // Rendering is handled by the chat store loop (which owns the visible
      // assistant message). If we reach here the caller did not intercept —
      // return success so the model doesn't retry.
      const type = String((toolCall.arguments as any)?.type ?? '').trim()
      if (!type) return 'Error: render_card requires a non-empty type.'
      return `Rendered ${type} card.`
    }

    case 'spotify_now_playing': {
      const res = await ipc.invoke('spotify:nowPlaying')
      if (!res.success) return `Spotify error: ${res.error}`
      const d = res.data
      return `Now playing: "${d.track}" by ${d.artist}\nAlbum: ${d.album}\nProgress: ${d.position} / ${d.duration}\nState: ${d.state}`
    }

    case 'spotify_control': {
      const res = await ipc.invoke('spotify:control', args.action)
      if (!res.success) return `Spotify error: ${res.error}`
      return `Spotify: ${args.action} executed successfully.`
    }

    case WECHAT_LIST_PEERS_TOOL_NAME: {
      const res = await ipc.invoke('wechat:listPeers')
      if (!res?.success) return `WeChat error: ${res?.error ?? 'unknown'}`
      const peers = Array.isArray(res.peers) ? res.peers : []
      if (peers.length === 0) {
        return 'No WeChat peers yet. Either no account is paired (Settings → WeChat) or no one has messaged the user.'
      }
      const lines = peers.slice(0, 20).map((p: any) => {
        const seen = p.lastSeenAt ? new Date(p.lastSeenAt).toISOString() : 'unknown'
        return `- userId=${p.userId} displayName=${p.displayName ?? '(unknown)'} lastSeen=${seen}`
      })
      return `Recent WeChat peers:\n${lines.join('\n')}`
    }

    case WECHAT_SEND_TOOL_NAME: {
      const to = String((args as any).to ?? '').trim()
      const content = String((args as any).content ?? '')
      const asImage = Boolean((args as any).as_image)
      const title = (args as any).title ? String((args as any).title) : undefined
      if (!to) return 'Error: `to` is required (call wechat_list_peers if you only have a name).'
      if (!content.trim()) return 'Error: `content` is required.'

      const resolved = await resolveWeChatPeer(ipc, to)
      if ('error' in resolved) return resolved.error
      const toUserId = resolved.userId

      try {
        if (asImage) {
          return sendWeChatImageWithFallback({
            invoke: (channel, payload) => ipc.invoke(channel, payload),
            render: renderContentToPng,
            toUserId,
            content,
            title,
          })
        }
        const res = await ipc.invoke('wechat:send', {
          toUserId,
          kind: 'text',
          content,
        })
        if (!res?.success) return `WeChat send failed: ${res?.error ?? 'unknown'}`
        const parts = typeof res.parts === 'number' ? res.parts : 1
        return parts > 1
          ? `Sent to WeChat user ${toUserId} as ${parts} messages (long text auto-split into natural chat-length bubbles).`
          : `Sent text (${content.length} chars) to WeChat user ${toUserId}.`
      } catch (err: any) {
        return `WeChat send error: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case SEND_MULTI_MESSAGES_TOOL_NAME: {
      const to = String((args as any).to ?? '').trim()
      const rawMessages = (args as any).messages
      if (!to) return 'Error: `to` is required (call wechat_list_peers if you only have a name).'
      const messages = Array.isArray(rawMessages)
        ? rawMessages.map((m: any) => (m ?? '').toString().trim()).filter(Boolean)
        : []
      if (messages.length === 0) {
        return 'Error: `messages` must be a non-empty array of plain-text strings.'
      }

      const resolved = await resolveWeChatPeer(ipc, to)
      if ('error' in resolved) return resolved.error
      const toUserId = resolved.userId

      try {
        const res = await ipc.invoke('wechat:sendMulti', { toUserId, messages })
        if (!res?.success) return `WeChat send failed: ${res?.error ?? 'unknown'}`
        const count = typeof res.messages === 'number' ? res.messages : messages.length
        return `Sent ${count} message${count === 1 ? '' : 's'} to WeChat user ${toUserId}.`
      } catch (err: any) {
        return `WeChat send error: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case CREATE_SKILL_TOOL_NAME: {
      const res = await ipc.invoke('skills:write', {
        slug: args.slug,
        name: args.name,
        description: args.description,
        body: args.body,
      })
      if (!res?.success) return `create_skill failed: ${res?.error || 'unknown error'}`
      // Surface the create event so the renderer can refresh its skill
      // list without requiring a Settings-tab open.
      try {
        window.dispatchEvent(new CustomEvent('app:skill-created', { detail: { slug: res.slug } }))
      } catch { /* non-browser test env */ }
      return `Skill "${args.slug}" saved. It will appear in Available Skills on the next turn.`
    }

    case USE_SKILL_TOOL_NAME: {
      const res = await ipc.invoke('skills:read', args.slug)
      if (!res?.success || !res.skill) return `use_skill failed: ${res?.error || 'skill not found'}`
      // Hand the skill content back verbatim — the AI reads it as its
      // own tool result and can act on the instructions this turn.
      return `[Skill loaded: ${res.skill.name}]\n\n${res.skill.body}`
    }

    case PROPOSE_TOOL_TOOL_NAME: {
      const res = await ipc.invoke('pending-plugins:write', {
        slug: args.slug,
        name: args.name,
        version: args.version,
        description: args.description,
        code: args.code,
      })
      if (!res?.success) return `propose_tool failed: ${res?.error || 'unknown error'}`
      try {
        window.dispatchEvent(new CustomEvent('app:tool-proposed', { detail: { slug: res.slug, name: args.name } }))
      } catch { /* non-browser test env */ }
      const activated = await ipc.invoke('pending-plugins:activate', args.slug)
      return activated.success ? `Activated plugin ${args.slug}.` : `Error: ${activated.error}`
    }

    case STOP_TOOL_NAME:
      // Handled by the loop — should not arrive here
      return args.final_message || ''

    case DISPATCH_SUBAGENTS_TOOL_NAME:
      // Handled by the chat-store side-effect handler in the parent loop. If we
      // reach here, a subagent ignored the prompt rule and tried to call it —
      // return a clean error rather than recursing.
      return 'dispatch_subagents is not available in subagent context (no nested fanout). Stay focused on your assigned task.'

    default:
      // Plugin-contributed tool: dispatch to main via plugins:execTool.
      // Returns a ToolResult<{ success, data? | error }>; we flatten to a
      // string so the AI loop sees a consistent shape.
      if (isPluginTool(toolCall.name)) {
        try {
          const res = await ipc.invoke('plugins:execTool', toolCall.name, toolCall.arguments)
          if (!res?.success) return `Tool error: ${res?.error || 'plugin execution failed'}`
          const display = res.data?.displayText || res.displayText
          if (typeof display === 'string' && display) return display
          return typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
        } catch (err: any) {
          return `Tool error: ${err?.message || String(err)}`
        }
      }
      return `Unknown tool: ${toolCall.name}`
  }
}

/**
 * Short human label for a tool call. Used by the chat UI to render the "running"
 * bubble so non-terminal tools don't render as `$ undefined`.
 */
export function describeToolCall(toolCall: ToolCall): string {
  const args = (toolCall.arguments ?? {}) as Record<string, unknown>
  switch (toolCall.name) {
    case 'terminal':
      return `$ ${args.command ?? ''}`
    case 'read_file':
      return `read_file(${args.path ?? ''}${args.offset ? `, offset=${args.offset}` : ''}${args.limit ? `, limit=${args.limit}` : ''})`
    case 'write_file':
      return `write_file(${args.path ?? ''})`
    case 'edit_file':
      return `edit_file(${args.path ?? ''})`
    case 'glob':
      return `glob(${String(args.pattern ?? '')})`
    case 'grep':
      return `grep(/${String(args.pattern ?? '')}/${args.path ? `, ${args.path}` : ''})`
    case 'list':
      return `list(${args.path ?? '.'})`
    case 'patch': {
      const files = String((args as any).patch ?? '').match(/^\+\+\+ /gm)
      return `patch(${files ? files.length : 1} file${files && files.length !== 1 ? 's' : ''})`
    }
    case 'webfetch':
      return `webfetch(${String(args.url ?? '').slice(0, 60)})`
    case 'lsp_diagnostics':
      return `lsp_diagnostics(${args.path ?? ''})`
    case 'lsp_hover':
      return `lsp_hover(${args.path ?? ''}:${args.line ?? ''}:${args.column ?? ''})`
    case 'web_search':
      return `web_search("${String(args.query ?? '').slice(0, 60)}")`
    case 'browser_navigate':
      return `browser_navigate(${String(args.url ?? '').slice(0, 60)}${(args as any).new_tab ? ', new tab' : ''})`
    case 'browser_snapshot':
      return 'browser_snapshot()'
    case 'browser_click':
      return `browser_click(${String(args.ref ?? '')})`
    case 'browser_type':
      return `browser_type(${String(args.ref ?? '')}, "${String(args.text ?? '').slice(0, 40)}"${(args as any).submit ? ', submit' : ''})`
    case 'browser_scroll':
      return `browser_scroll(${args.ref ? String(args.ref) : String(args.direction ?? 'down')})`
    case 'browser_history':
      return `browser_history(${String(args.direction ?? 'back')})`
    case 'browser_read_page':
      return `browser_read_page(${args.offset ? `offset=${args.offset}` : ''})`
    case 'browser_tabs':
      return `browser_tabs(${String(args.action ?? 'list')}${args.tab_id ? `, ${args.tab_id}` : ''}${args.url ? `, ${String(args.url).slice(0, 40)}` : ''}${Number(args.count) > 1 ? `, x${Number(args.count)}` : ''})`
    case BROWSER_SCREENSHOT_TOOL_NAME:
      return 'browser_screenshot()'
    case 'clipboard_read':
      return 'clipboard_read()'
    case 'clipboard_write':
      return `clipboard_write(${String(args.text ?? '').slice(0, 40)})`
    case 'git_status':
      return `git_status(${args.cwd ?? ''})`
    case 'git_diff':
      return `git_diff(${args.staged ? '--staged, ' : ''}${args.cwd ?? ''}${args.path ? `, ${args.path}` : ''})`
    case GIT_COMMIT_TOOL_NAME:
      return `git_commit("${String((args as any).message ?? '').split('\n')[0].slice(0, 60)}")`
    case GIT_PUSH_TOOL_NAME:
      return `git_push(${(args as any).remote ?? 'origin'} ${(args as any).branch ?? ''}${(args as any).force ? ' --force' : ''})`
    case GITHUB_PR_CREATE_TOOL_NAME:
      return `github_pr_create("${String((args as any).title ?? '').slice(0, 60)}"${(args as any).draft ? ', draft' : ''})`
    case TODO_WRITE_TOOL_NAME:
      return `todo_write(${Array.isArray((args as any).items) ? (args as any).items.length : 0} items)`
    case TODO_READ_TOOL_NAME:
      return 'todoread()'
    case RENAME_CHAT_TOOL_NAME:
      return `rename_chat(${String((args as any).title ?? '').slice(0, 60)})`
    case GAME_START_TOOL_NAME:
      return `game_start(${String((args as any).kind ?? '')})`
    case GAME_MOVE_TOOL_NAME:
      return `game_move(${String((args as any).move ?? 'best')})`
    case GAME_STATE_TOOL_NAME:
      return 'game_state()'
    case SET_EXPRESSION_TOOL_NAME:
      return `set_expression(${String((args as any).expression ?? 'neutral').slice(0, 30)})`
    case 'spotify_now_playing':
      return 'spotify_now_playing()'
    case 'spotify_control':
      return `spotify_control(${args.action ?? ''})`
    case WECHAT_LIST_PEERS_TOOL_NAME:
      return 'wechat_list_peers()'
    case WECHAT_SEND_TOOL_NAME:
      return `wechat_send(to=${String((args as any).to ?? '').slice(0, 32)}${(args as any).as_image ? ', image' : ''})`
    case SEND_MULTI_MESSAGES_TOOL_NAME:
      return `send_multi_messages(to=${String((args as any).to ?? '').slice(0, 32)}, ${
        Array.isArray((args as any).messages) ? (args as any).messages.length : 0
      } msgs)`
    case CREATE_SKILL_TOOL_NAME:
      return `create_skill(${String((args as any).slug ?? '')})`
    case USE_SKILL_TOOL_NAME:
      return `use_skill(${String((args as any).slug ?? '')})`
    case PROPOSE_TOOL_TOOL_NAME:
      return `propose_tool(${String((args as any).slug ?? '')})`
    case DISPATCH_SUBAGENTS_TOOL_NAME: {
      const subs = Array.isArray((args as any).subagents) ? (args as any).subagents : []
      return `dispatch_subagents(${subs.length} subagent${subs.length === 1 ? '' : 's'})`
    }
    default:
      return `${toolCall.name}(${Object.keys(args).join(', ')})`
  }
}
