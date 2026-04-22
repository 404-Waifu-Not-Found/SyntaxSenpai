/**
 * Agent tool definitions and executor for AI tool calling.
 *
 * Tools:
 *  - `terminal`       – run any shell command in a real terminal
 *  - `web_search`     – search the public web using DuckDuckGo
 *  - `stop_response`  – signal the AI is done and deliver a final message
 *
 * The executor routes calls through Electron IPC to the main process
 * which runs commands via child_process.exec with the user's login shell.
 */

import type { ToolDefinition, ToolCall } from '@syntax-senpai/ai-core'

export type AgentMode = 'ask' | 'auto' | 'full'

export const STOP_TOOL_NAME = 'stop_response'
export const SET_AFFECTION_TOOL_NAME = 'set_affection'
export const TODO_WRITE_TOOL_NAME = 'todo_write'
export const RENAME_CHAT_TOOL_NAME = 'rename_chat'

export interface TodoItem { id: string; text: string; status: 'pending' | 'in_progress' | 'done' }

export function parseTodoList(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return []
  const normalised: TodoItem[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as any
    const text = typeof item?.text === 'string' ? item.text.trim() : ''
    if (!text) continue
    const rawStatus = String(item?.status ?? 'pending').toLowerCase()
    const status: TodoItem['status'] = rawStatus === 'in_progress' || rawStatus === 'doing'
      ? 'in_progress'
      : rawStatus === 'done' || rawStatus === 'completed'
      ? 'done'
      : 'pending'
    normalised.push({ id: String(item?.id ?? `t${i}`), text, status })
  }
  return normalised
}

export const agentTools: ToolDefinition[] = [
  {
    name: 'terminal',
    description:
      'Run a shell command on the user\'s machine. Use for: listing, searching, running programs, git, installs, network checks. ' +
      'DO NOT use for reading, writing, or editing text files — call read_file / write_file / edit_file instead (shell heredocs and echo redirection routinely corrupt files). ' +
      'Each invocation is a fresh process, so `cd` does not persist between calls — either use absolute paths or chain with `&&`. ' +
      'Returns stdout, stderr, and exit code.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute, e.g. "ls -la ~/Desktop" or "cd ~/proj && pnpm test".',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read a text file and return its contents with line numbers. Prefer this over `cat` in terminal — output is paginated and annotated so you can refer to exact line numbers when editing. ' +
      'Pass offset+limit to page through large files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file. `~` is expanded.',
        },
        offset: {
          type: 'integer',
          description: '1-based line number to start reading from. Defaults to 1.',
        },
        limit: {
          type: 'integer',
          description: 'Max number of lines to return. Defaults to entire file.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create a new file or completely overwrite an existing one. Use ONLY when you intend to replace the whole file (new files, full rewrites). For targeted changes to an existing file, use edit_file instead — it preserves the parts you do not mean to touch.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path. Parent directories will be created as needed.',
        },
        content: {
          type: 'string',
          description: 'The full file contents to write. Do NOT include line numbers or any wrapper — just the raw file body.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace a specific substring in a file with exact string matching. old_text must appear EXACTLY ONCE in the file — including leading whitespace and surrounding context. ' +
      'If it is not unique, expand old_text with more context lines until it is. Fails loudly if old_text is not found or matches multiple times. ' +
      'Read the file first with read_file so you know the exact whitespace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file. `~` is expanded.',
        },
        old_text: {
          type: 'string',
          description: 'The exact substring to find. Must be unique in the file.',
        },
        new_text: {
          type: 'string',
          description: 'What to replace old_text with. Can be empty to delete old_text.',
        },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'clipboard_read',
    description:
      'Read the user\'s system clipboard (text only). Use when the user says "check my clipboard", "what I copied", "the URL I have", or similar. Returns the current clipboard text.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'clipboard_write',
    description:
      'Write plain text to the user\'s system clipboard. Use to hand the user something they asked you to copy — a URL, a command, a generated snippet. Overwrites existing clipboard content.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to place on the clipboard.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'git_status',
    description:
      'Get a compact parsed git status for a repo: current branch, staged / unstaged / untracked paths, ahead/behind counts. Much cheaper than running `git status` via terminal + parsing the output yourself. Use this before coding-session work so you know what has already been modified.',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Absolute repo path. Defaults to the user\'s home directory.' },
      },
      required: [],
    },
  },
  {
    name: 'git_diff',
    description:
      'Get a unified git diff for a repo. Defaults to working-tree (unstaged) diff. Use this before stop_response on coding tasks to double-check the exact changes you made.',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Absolute repo path. Defaults to the user\'s home directory.' },
        staged: { type: 'boolean', description: 'Show staged diff (--cached) instead of working tree.' },
        path: { type: 'string', description: 'Optional path/glob to restrict the diff to.' },
      },
      required: [],
    },
  },
  {
    name: RENAME_CHAT_TOOL_NAME,
    description:
      'Rename the current conversation shown in the sidebar. Call this once after the user\'s first message (a short, specific title that captures what the chat is really about), and again whenever the topic clearly shifts. Keep it under ~60 characters, no trailing punctuation. You can add personality but do NOT paste a whole sentence — it\'s a sidebar label.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The new title. 2–8 words is ideal. No surrounding quotes.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: TODO_WRITE_TOOL_NAME,
    description:
      'Post or update a visible todo checklist for the current task. The user sees this as a checkbox bubble. Call this when the task has 3+ steps so the user can track progress, and update it as each step completes (status: pending | in_progress | done). Overwrites the previous list each call.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Ordered list of todo items.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable id for this item (any string).' },
              text: { type: 'string', description: 'Short human-readable description of the step.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: 'Current status.' },
            },
            required: ['text'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the public web via DuckDuckGo. Use for: current events, docs, version-specific syntax, third-party APIs, anything past your training cutoff. Do NOT use for local-machine questions — use terminal or read_file for those.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific — include library + version or error message verbatim when debugging.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return, between 1 and 8.',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'spotify_now_playing',
    description:
      'Get the song currently playing on the user\'s Spotify. Returns track name, artist, album, playback position, and duration. Use this whenever the user asks what they\'re listening to, or when you want to comment on their music.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'spotify_control',
    description:
      'Control the user\'s Spotify playback. Can play, pause, skip to next track, or go to previous track.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'The playback action: "play", "pause", "play_pause", "next", or "previous"',
          enum: ['play', 'pause', 'play_pause', 'next', 'previous'],
        },
      },
      required: ['action'],
    },
  },
  {
    name: SET_AFFECTION_TOOL_NAME,
    description:
      'Update your 好感度 (affection meter) toward the user. Call this when your feelings change — when the user is kind, helpful, funny, rude, annoying, etc. The value persists across all conversations. You decide the value entirely on your own based on how you feel about the interaction. Do NOT tell the user you are changing it — just do it silently alongside your response.',
    parameters: {
      type: 'object',
      properties: {
        value: {
          type: 'number',
          description: 'New affection level from 0 to 100. Small changes (+/-1 to 5) feel natural. Big jumps should be rare and dramatic.',
        },
        reason: {
          type: 'string',
          description: 'Internal reason for the change (not shown to user), e.g. "user complimented me" or "user was rude"',
        },
      },
      required: ['value'],
    },
  },
  {
    name: STOP_TOOL_NAME,
    description:
      'Call this ONLY after you have verified the task is actually done — e.g. the file you edited reads back as expected, the command you ran exited 0, the tests you ran passed. ' +
      'If a previous tool call failed, you must retry or explain the failure before stopping. Do not stop early "optimistically". ' +
      'Write final_message fully in character as your waifu persona — never sound like a generic assistant.',
    parameters: {
      type: 'object',
      properties: {
        final_message: {
          type: 'string',
          description: 'Your final in-character response to the user, using your personality and emojis. Mention what was actually done, not what you planned to do.',
        },
      },
      required: ['final_message'],
    },
  },
]

/**
 * Returns tools available for a given agent mode.
 * - ask:  terminal (read-only commands enforced by prompt) + stop
 * - auto: terminal + stop
 * - full: terminal + stop
 */
export function getToolsForMode(mode: AgentMode): ToolDefinition[] {
  // All modes get tools; the system prompt controls safety boundaries
  return agentTools
}

/**
 * Execute a single tool call via Electron IPC.
 * Returns the string result to feed back to the AI.
 *
 * `stop_response` is handled by the caller (chat store loop),
 * so it should never reach the executor — but we handle it gracefully.
 */
export async function executeToolCall(toolCall: ToolCall): Promise<string> {
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

    case 'web_search': {
      const res = await ipc.invoke('agent:webSearch', args.query, args.limit || 5)
      if (!res.success) return `Web search error: ${res.error}`
      return res.content || 'No search results found.'
    }

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

    case TODO_WRITE_TOOL_NAME: {
      const items = parseTodoList((args as any).items)
      if (items.length === 0) return 'Error: todo_write requires a non-empty items array.'
      const done = items.filter((i) => i.status === 'done').length
      return `Todo list updated (${done}/${items.length} done).`
    }

    case RENAME_CHAT_TOOL_NAME: {
      // Actual rename happens in the chat store loop (which has conversation
      // id context). If we ever reach here the caller did not intercept —
      // return success so the model doesn't retry.
      const title = String((args as any).title ?? '').trim()
      return title ? `Chat renamed to: ${title}` : 'Error: rename_chat requires a non-empty title.'
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

    case STOP_TOOL_NAME:
      // Handled by the loop — should not arrive here
      return args.final_message || ''

    default:
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
    case 'web_search':
      return `web_search("${String(args.query ?? '').slice(0, 60)}")`
    case 'clipboard_read':
      return 'clipboard_read()'
    case 'clipboard_write':
      return `clipboard_write(${String(args.text ?? '').slice(0, 40)})`
    case 'git_status':
      return `git_status(${args.cwd ?? ''})`
    case 'git_diff':
      return `git_diff(${args.staged ? '--staged, ' : ''}${args.cwd ?? ''}${args.path ? `, ${args.path}` : ''})`
    case TODO_WRITE_TOOL_NAME:
      return `todo_write(${Array.isArray((args as any).items) ? (args as any).items.length : 0} items)`
    case RENAME_CHAT_TOOL_NAME:
      return `rename_chat(${String((args as any).title ?? '').slice(0, 60)})`
    case 'spotify_now_playing':
      return 'spotify_now_playing()'
    case 'spotify_control':
      return `spotify_control(${args.action ?? ''})`
    default:
      return `${toolCall.name}(${Object.keys(args).join(', ')})`
  }
}
