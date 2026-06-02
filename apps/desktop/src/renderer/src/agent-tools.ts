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

import type { ToolDefinition, ToolCall } from '@syntax-senpai/ai-core'
import { renderContentToPng } from './services/render-to-image'

export type AgentMode = 'ask' | 'auto' | 'full'

export const STOP_TOOL_NAME = 'stop_response'
export const SET_AFFECTION_TOOL_NAME = 'set_affection'
export const SET_EXPRESSION_TOOL_NAME = 'set_expression'
export const TODO_WRITE_TOOL_NAME = 'todo_write'
export const TODO_READ_TOOL_NAME = 'todoread'
export const RENAME_CHAT_TOOL_NAME = 'rename_chat'
export const RENDER_CARD_TOOL_NAME = 'render_card'
export const GIT_COMMIT_TOOL_NAME = 'git_commit'
export const GIT_PUSH_TOOL_NAME = 'git_push'
export const GITHUB_PR_CREATE_TOOL_NAME = 'github_pr_create'
export const CREATE_SKILL_TOOL_NAME = 'create_skill'
export const USE_SKILL_TOOL_NAME = 'use_skill'
export const PROPOSE_TOOL_TOOL_NAME = 'propose_tool'
export const DISPATCH_SUBAGENTS_TOOL_NAME = 'dispatch_subagents'
export const WECHAT_SEND_TOOL_NAME = 'wechat_send'
export const WECHAT_LIST_PEERS_TOOL_NAME = 'wechat_list_peers'
export const SEND_MULTI_MESSAGES_TOOL_NAME = 'send_multi_messages'

const CODING_MODE_TOOLS = new Set<string>([
  GIT_COMMIT_TOOL_NAME,
  GIT_PUSH_TOOL_NAME,
  GITHUB_PR_CREATE_TOOL_NAME,
])

export const CARD_MARKER_FENCE = 'syntax-senpai-card'

export type RenderCardType = 'weather' | 'table' | 'link_preview' | 'code_comparison'

export interface RenderCardPayload {
  type: RenderCardType
  data: Record<string, unknown>
}

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
      'Run a shell command on the user\'s machine. Use for: listing, searching, running programs, git, installs, network checks, and realtime/current data from direct CLI/API sources such as wttr.in, worldtimeapi.org, ipinfo.io, npm view, or pnpm view. ' +
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
    name: 'glob',
    description:
      'Find files by glob pattern, fast. Returns matching file paths newest-first (by modification time). ' +
      'Use this to locate files when you know part of a name or an extension but not the location — e.g. "**/*.test.ts", "src/**/index.*", "package.json". ' +
      'A pattern with no slash matches at any depth. node_modules / .git / dist are skipped automatically. Prefer this over `find` or `ls -R` in the terminal.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern. Supports *, **, ?, {a,b}, [..]. A bare pattern like "*.ts" matches at any depth.' },
        cwd: { type: 'string', description: 'Directory to search from. Defaults to the active repo / current working directory.' },
        limit: { type: 'integer', description: 'Max paths to return (1-1000). Default 200.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description:
      'Search file contents by regular expression across a directory tree. Returns file:line:text matches. ' +
      'Uses ripgrep when available (fast), otherwise a built-in scanner. Use this to find where a symbol or string is defined or used before editing. ' +
      'Prefer this over `grep` / `rg` in the terminal — the output is parsed and capped.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for (NOT a glob). Escape regex metacharacters if you mean them literally.' },
        path: { type: 'string', description: 'File or directory to search. Defaults to the active repo / current working directory.' },
        include: { type: 'string', description: 'Optional glob restricting which files are searched, e.g. "*.ts" or "src/**/*.vue".' },
        ignore_case: { type: 'boolean', description: 'Case-insensitive match. Default false.' },
        limit: { type: 'integer', description: 'Max matches to return (1-500). Default 150.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list',
    description:
      'List a directory as an indented tree to a bounded depth. Use it to learn the shape of a project or folder. ' +
      'node_modules / .git / dist are shown as "(skipped)" rather than expanded. Prefer this over `ls` / `tree` in the terminal.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to list. Defaults to the active repo / current working directory.' },
        depth: { type: 'integer', description: 'How many levels deep to recurse (1-6). Default 2.' },
      },
      required: [],
    },
  },
  {
    name: 'patch',
    description:
      'Apply a unified diff to one or more files in a single call. Use this when you have several related edits across files, or multiple hunks in one file — it is more reliable than a long chain of edit_file calls. ' +
      'The diff must be standard unified-diff format (--- a/path, +++ b/path, @@ hunks). Use /dev/null as the old path to create a file, or as the new path to delete one. Paths resolve relative to cwd. ' +
      'For a single small change, edit_file is still simpler.',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'The unified diff text. Include ---/+++ headers and @@ hunk markers. Small line-offset drift is tolerated — context lines relocate hunks.' },
        cwd: { type: 'string', description: 'Directory the a/ b/ paths are relative to. Defaults to the active repo / current working directory.' },
      },
      required: ['patch'],
    },
  },
  {
    name: 'webfetch',
    description:
      'Fetch the contents of a specific URL. Unlike web_search (which only returns result links), this retrieves the actual page — use it to read documentation, an article, a raw file, or an API response the user named or that a search turned up. ' +
      'http(s) only, 15s timeout, 2 MB cap. HTML is converted to readable text unless format="html".',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The http(s) URL to fetch.' },
        format: { type: 'string', enum: ['text', 'markdown', 'html'], description: '"text"/"markdown" (default) strip HTML to readable text; "html" returns raw HTML.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'lsp_diagnostics',
    description:
      'Get real compiler / linter diagnostics (errors and warnings) for a source file from a language server — typescript-language-server, pyright, gopls, or rust-analyzer depending on the file type. ' +
      'Use this AFTER editing a .ts/.tsx/.js/.jsx/.py/.go/.rs file to verify your change actually type-checks, instead of (or before) running a full build. Returns each diagnostic with line/column, severity and message. ' +
      'If the required language server is not installed it returns an install hint — relay that to the user.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the source file to check. `~` is expanded.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'lsp_hover',
    description:
      'Ask the language server for the type, signature, and documentation of the symbol at a given position in a source file (.ts/.tsx/.js/.jsx/.py/.go/.rs). ' +
      'Use this to learn what a variable, function, or import actually is without guessing. line and column are 1-based, matching the numbers read_file shows.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the source file. `~` is expanded.' },
        line: { type: 'integer', description: '1-based line number of the symbol (as shown by read_file).' },
        column: { type: 'integer', description: '1-based column of the symbol on that line.' },
      },
      required: ['path', 'line', 'column'],
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
    name: GIT_COMMIT_TOOL_NAME,
    description:
      'Create a git commit in the active coding-mode repository. Stages the paths you pass (or all modified tracked files if paths is omitted) and commits with the given message. Call git_diff first to verify what will land. Do NOT commit lockfiles, .env, or secrets unless the user explicitly asked. Never amend or rewrite history with this tool — use terminal directly for those.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message. Subject line ≤ 60 chars, lowercase conventional style (feat:/fix:/refactor:/docs:/chore:). Body optional, separated by a blank line.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of paths to stage (relative to repo). Defaults to `git add -u` (all modified tracked files, no new untracked files).' },
        cwd: { type: 'string', description: 'Absolute repo path. Defaults to the active coding-mode repo.' },
      },
      required: ['message'],
    },
  },
  {
    name: GIT_PUSH_TOOL_NAME,
    description:
      'Push the current branch to the remote. Defaults to `origin <current-branch>`. Use force:true ONLY when the user explicitly typed "force" or "--force". If the branch has no upstream, -u is set automatically.',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'Remote name. Defaults to "origin".' },
        branch: { type: 'string', description: 'Branch to push. Defaults to the current branch.' },
        force: { type: 'boolean', description: 'Force push using --force-with-lease. Default false. Require explicit user confirmation before setting true.' },
        cwd: { type: 'string', description: 'Absolute repo path. Defaults to the active coding-mode repo.' },
      },
      required: [],
    },
  },
  {
    name: GITHUB_PR_CREATE_TOOL_NAME,
    description:
      'Open a GitHub pull request for the active coding-mode repo using the `gh` CLI. The branch must already be pushed. Requires gh to be installed and authenticated. Use for code review requests on GitHub-hosted repos only.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'PR title. ≤ 70 chars. No emoji unless the repo style uses them.' },
        body: { type: 'string', description: 'PR body as markdown. Include a "## Summary" section (1–3 bullets) and "## Test plan" section (checkboxes).' },
        base: { type: 'string', description: 'Base branch. Defaults to the repo default branch (often main or master).' },
        draft: { type: 'boolean', description: 'Open as draft. Default false.' },
        cwd: { type: 'string', description: 'Absolute repo path. Defaults to the active coding-mode repo.' },
      },
      required: ['title', 'body'],
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
    name: TODO_READ_TOOL_NAME,
    description:
      'Read the current visible todo checklist for this conversation (the one you post with todo_write). ' +
      'Use it at the start of a turn on a multi-step task to recall what is still pending before deciding the next action. ' +
      'Returns the items and their statuses, or a note that no list exists yet.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'web_search',
    description:
      'Fetch top public DuckDuckGo result links/snippets for a query. Use only to find links or source candidates. This is not a realtime data source; do not use it to answer weather, stocks, scores, prices, or other live facts directly. Prefer terminal for problem solving, diagnostics, local searches, installs, and verification.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The DuckDuckGo search query. Be specific — include library + version or error message verbatim when debugging.',
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
    name: WECHAT_LIST_PEERS_TOOL_NAME,
    description:
      'List recent WeChat contacts that have messaged the user (most-recently-active first). Use this when the user asks you to "send to WeChat" but only gives a name — match the name against `displayName` or `userId` from this list, then pass the chosen `userId` to wechat_send. Returns an empty list if no WeChat account is paired yet.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: WECHAT_SEND_TOOL_NAME,
    description:
      "Send a message to a WeChat contact through the user's paired WeChat. " +
      "Use this when the user asks to send/share/post something to WeChat, or to forward a result to a contact. " +
      "WeChat does NOT render tables, charts, or complex markdown — set `as_image: true` for any rich content (tables, long code, comparisons, multi-section answers) and pass plain prose for chat-style messages. " +
      "If you're unsure who to send to, call wechat_list_peers first.",
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Contact userId (from wechat_list_peers) or, as a fallback, a display name to fuzzy-match.',
        },
        content: {
          type: 'string',
          description: 'Text or markdown content. When as_image is true, fenced code blocks are rendered as styled monospace blocks in the image.',
        },
        as_image: {
          type: 'boolean',
          description: 'Render `content` to a PNG and send as an image (use for tables, long code, anything that needs layout). Default false.',
          default: false,
        },
        title: {
          type: 'string',
          description: 'Optional bold heading shown above the body when as_image is true.',
        },
      },
      required: ['to', 'content'],
    },
  },
  {
    name: SEND_MULTI_MESSAGES_TOOL_NAME,
    description:
      'Send several separate messages to a WeChat contact, delivered in order as distinct chat bubbles. ' +
      'Use this when chatting with someone on WeChat and your reply is naturally more than one message — ' +
      'e.g. a quick reaction then a follow-up thought, a few steps one bubble at a time, or back-to-back texts ' +
      'like a real person would send. Each entry in `messages` becomes its own bubble (and is itself auto-split ' +
      'if too long). For a single message use wechat_send; for rich/structured content use wechat_send with as_image=true.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Contact userId (from wechat_list_peers) or, as a fallback, a display name to fuzzy-match.',
        },
        messages: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Ordered list of plain-text messages to send, each delivered as its own WeChat bubble. ' +
            'Keep each one short and conversational, like real texting. Max 10.',
        },
      },
      required: ['to', 'messages'],
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
    name: SET_EXPRESSION_TOOL_NAME,
    description:
      'Set the Live2D model facial expression during conversation. Call this when you want to visually express an emotion to enhance your reply. The expression changes the model\'s face in real time. Available expressions: "neutral", "happy", "excited", "thinking", "confused", "embarrassed", "determined", "sad". Use this tastefully — once or twice per conversation turn at most. Do not explain that you are changing your expression; just set it alongside your reply.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          enum: ['neutral', 'happy', 'excited', 'thinking', 'confused', 'embarrassed', 'determined', 'sad'],
          description: 'The expression to show: neutral (default/resting), happy (warm smile), excited (wide-eyed joy), thinking (pondering), confused (puzzled), embarrassed (shy/blushing), determined (serious/focused), or sad (downcast/concerned).',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: RENDER_CARD_TOOL_NAME,
    description:
      'Render a rich visual card inline in the chat. Use for information that benefits from structured display: current weather, side-by-side comparisons, tabular data with >2 rows, and link previews. ' +
      'Do NOT use for plain prose, jokes, greetings, or simple yes/no answers. ' +
      'Supported types: "weather" (current + forecast), "table" (rows/columns), "link_preview" (title/url/description), "code_comparison" (before/after code snippets). ' +
      'Call this ONCE per piece of content you want visualized — then continue with normal text or call stop_response. The card is displayed to the user immediately; you do not need to repeat its contents in your final_message.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['weather', 'table', 'link_preview', 'code_comparison'],
          description: 'Which card template to render.',
        },
        data: {
          type: 'object',
          description:
            'Card payload. Schemas:\n' +
            '- weather: { location, temperature_c, conditions, emoji?, humidity_pct?, wind_kph?, forecast?: [{ day, high_c, low_c, conditions, emoji? }] }\n' +
            '- table: { title?, headers: string[], rows: string[][], caption? }\n' +
            '- link_preview: { url, title, description?, site?, image_url? }\n' +
            '- code_comparison: { title?, before: { label?, language?, code }, after: { label?, language?, code } }',
        },
      },
      required: ['type', 'data'],
    },
  },
  {
    name: CREATE_SKILL_TOOL_NAME,
    description:
      'Save a reusable skill to your personal skill library. Use this when you discover a recipe / procedure / style you want to remember across sessions — e.g. "how this user prefers Python code formatted", "debug ritual for their test suite", "the tone they like for PR descriptions". ' +
      'The slug must be lowercase letters, digits, - or _ (<= 64 chars). Body should be concrete instructions you can follow yourself later — include examples if they help. Do NOT duplicate skills the Available Skills list already shows; update the existing one by overwriting the same slug.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'URL-safe identifier, e.g. "python-style" or "user_onboarding".' },
        name: { type: 'string', description: 'Short human title for the skill.' },
        description: { type: 'string', description: 'One-sentence summary shown in the Available Skills list.' },
        body: { type: 'string', description: 'The full skill content. Markdown is fine. Write it so future-you can execute the skill without extra context.' },
      },
      required: ['slug', 'name', 'description', 'body'],
    },
  },
  {
    name: USE_SKILL_TOOL_NAME,
    description:
      'Load a saved skill\'s full content into your working context for this turn. Call this before acting on a task the skill covers. Only pull skills you actually need — each one costs tokens.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The skill slug (as shown in Available Skills).' },
      },
      required: ['slug'],
    },
  },
  {
    name: PROPOSE_TOOL_TOOL_NAME,
    description:
      'Propose a NEW plugin tool for the user to review and approve. Use this when you realize a repeated task would be cleaner with a dedicated tool (e.g. an API wrapper, a custom parser) that doesn\'t exist yet. ' +
      'You are writing untrusted JavaScript that the user must explicitly approve before it runs — write cautiously, include the same safety checks real plugins do (reject non-http(s) URLs, cap response sizes, handle errors). The code must `module.exports = { activate({ registerTool }) { registerTool({...}) } }` — the same shape as the shipped plugins. ' +
      'After calling this, tell the user you\'ve proposed a tool and ask them to approve it in Settings → Plugins → Pending. Do NOT imply the tool is active or try to use it in the current turn — it cannot run until they approve and restart the app.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'URL-safe plugin identifier, e.g. "weather-lookup".' },
        name: { type: 'string', description: 'Human-readable plugin name.' },
        version: { type: 'string', description: 'Semver string, default "0.1.0" if unsure.' },
        description: { type: 'string', description: 'What the plugin does and why it\'s useful.' },
        code: { type: 'string', description: 'Full JavaScript source of the plugin module. Limited to 64 KB.' },
      },
      required: ['slug', 'name', 'description', 'code'],
    },
  },
  {
    name: DISPATCH_SUBAGENTS_TOOL_NAME,
    description:
      'Spawn 1-8 worker subagents in parallel, each handling one slice of a repetitive task (reading many files, scanning many directories, auditing many configs). ' +
      'Each subagent runs its own short agent loop with the same tools you have, then reports back a free-form final message summarizing what it found. ' +
      'Use when the work decomposes into independent, similar sub-tasks. ' +
      'Examples: "summarize each of these 5 README files", "find usages of X across these directories", "audit each package.json for outdated deps". ' +
      'DO NOT use for sequential work where step N+1 depends on step N — that is one-by-one work for you, not for subagents. ' +
      'DO NOT assign subagents tasks that write to overlapping files — keep them in separate lanes. ' +
      'DO NOT call dispatch_subagents from inside a subagent (no nested fanout).',
    parameters: {
      type: 'object',
      properties: {
        rationale: {
          type: 'string',
          description: 'One sentence explaining why fanning out helps here (vs. doing the work inline).',
        },
        subagents: {
          type: 'array',
          description: 'Between 1 and 8 subagent specs. Each must have a distinct, self-contained task — the subagent does NOT see the parent chat history. Asking for more than 8 will be rejected.',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Short label shown in UI, e.g. "audit-readme-foo". Optional but helpful.',
              },
              task: {
                type: 'string',
                description: 'Specific, self-contained task description for this subagent. Include any file paths, search terms, or constraints it needs.',
              },
            },
            required: ['task'],
          },
        },
      },
      required: ['subagents', 'rationale'],
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
 * - ask:  all eligible tools; caller must request user approval before executing actions
 * - auto: all tools; caller should run AI approval before executing actions
 * - full: all tools; caller may execute directly
 *
 * Plugin-contributed tools (loaded via loadPluginTools) are appended
 * unconditionally — per-plugin enable/disable is handled on the main
 * side, so anything reaching this cache is already opt-in.
 */
export function getToolsForMode(
  mode: AgentMode,
  options: { webSearchEnabled?: boolean; codingMode?: boolean } = {},
): ToolDefinition[] {
  // Coding-mode tools (git_commit / git_push / github_pr_create) only appear when /code is active.
  const base = agentTools.filter((tool) => {
    if (tool.name === 'web_search') return options.webSearchEnabled === true
    if (CODING_MODE_TOOLS.has(tool.name)) return options.codingMode === true
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
          const rendered = await renderContentToPng(content, { title })
          const res = await ipc.invoke('wechat:send', {
            toUserId,
            kind: 'image',
            imageBase64: rendered.base64,
          })
          if (!res?.success) return `WeChat send failed: ${res?.error ?? 'unknown'}`
          return `Sent image (${rendered.width}x${rendered.height}px) to WeChat user ${toUserId}.`
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
      return `Proposed tool "${args.slug}" for user review. They must approve it in Settings → Plugins → Pending and restart before it becomes available. Do NOT attempt to call this tool this turn.`
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
