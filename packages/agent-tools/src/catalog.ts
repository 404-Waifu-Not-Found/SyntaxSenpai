import type { ToolDefinition } from '@syntax-senpai/ai-core'
export const STOP_TOOL_NAME = 'stop_response'
export const SET_AFFECTION_TOOL_NAME = 'set_affection'
export const SET_EXPRESSION_TOOL_NAME = 'set_expression'
export const TODO_WRITE_TOOL_NAME = 'todo_write'
export const TODO_READ_TOOL_NAME = 'todoread'
export const RENAME_CHAT_TOOL_NAME = 'rename_chat'
export const RENDER_CARD_TOOL_NAME = 'render_card'
export const GAME_START_TOOL_NAME = 'game_start'
export const GAME_MOVE_TOOL_NAME = 'game_move'
export const GAME_STATE_TOOL_NAME = 'game_state'
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

export const CODING_MODE_TOOLS = new Set<string>([
  GIT_COMMIT_TOOL_NAME,
  GIT_PUSH_TOOL_NAME,
  GITHUB_PR_CREATE_TOOL_NAME,
])

export const BROWSER_SCREENSHOT_TOOL_NAME = 'browser_screenshot'

/** Tools that drive the embedded browser panel. Gated by the
 * "AI browser control" setting; excluded from subagents (one webview, one driver). */
export const BROWSER_TOOLS = new Set<string>([
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_history',
  'browser_wait',
  'browser_read_page',
  'browser_tabs',
  BROWSER_SCREENSHOT_TOOL_NAME,
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
      'Fetch top public DuckDuckGo result links/snippets for a query. Use it to find source candidates, including for unfamiliar or possibly recent memes, slang, internet phrases, and references. This is not a realtime data source; do not use it to answer weather, stocks, scores, prices, or other live facts directly. Prefer terminal for problem solving, diagnostics, local searches, installs, and verification.',
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
    name: 'browser_navigate',
    description:
      'Open a URL in the embedded browser panel (visible to the user inside the app). Returns a text snapshot of the page with interactive elements labeled [e1], [e2], … — act on those refs with browser_click / browser_type. Use this (not web_search) when you need to actually visit, interact with, or read a live page.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full http(s) URL to open, e.g. "https://en.wikipedia.org".' },
        new_tab: { type: 'boolean', description: 'Open in a new tab instead of the current one.', default: false },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_snapshot',
    description:
      'Take a fresh text snapshot of the current browser page: title, URL, scroll position, interactive elements with [eN] refs, and a content outline. Refs are invalidated whenever the page changes — take a new snapshot instead of reusing old refs.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'browser_act',
    description:
      'Run several browser steps in ONE call, back-to-back, returning a single snapshot of the final page. Use this whenever you can predict the next few moves from the current snapshot — it is much faster than one tool call per step because it skips the model round-trip between steps. Each step is {action, ...}: navigate {url}, click {ref}, type {ref,text,submit?,clear?}, scroll {direction,pages?,ref?}, history {direction}, wait {seconds,until_text?}. Refs come from the latest snapshot; if a step navigates to a new page, refs from before that step are stale, so only chain ref-based steps that stay on the same page (e.g. fill a form then submit). Stops at the first failing step and returns progress + a snapshot so you can recover. Max 8 steps.',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Ordered list of steps to execute (max 8).',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['navigate', 'click', 'type', 'scroll', 'history', 'wait'] },
              url: { type: 'string', description: 'For navigate: full http(s) URL.' },
              ref: { type: 'string', description: 'For click/type/scroll: element ref from the latest snapshot.' },
              text: { type: 'string', description: 'For type: the text to enter.' },
              submit: { type: 'boolean', description: 'For type: press Enter afterwards.' },
              clear: { type: 'boolean', description: 'For type: clear the field first (default true).' },
              direction: { type: 'string', description: 'For scroll: up/down. For history: back/forward.' },
              pages: { type: 'integer', description: 'For scroll: viewport-heights to scroll.' },
              seconds: { type: 'number', description: 'For wait: seconds to pause (max 15).' },
              until_text: { type: 'string', description: 'For wait: resolve early once this text appears on the page.' },
            },
            required: ['action'],
          },
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'browser_click',
    description:
      'Click an element in the browser by its snapshot ref (e.g. "e3"). The element flashes a highlight so the user sees what you did. Returns a fresh snapshot reflecting the result (including any navigation).',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from the latest snapshot, e.g. "e3".' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'browser_type',
    description:
      'Type text into an input/textarea by its snapshot ref. Set submit=true to press Enter afterwards (e.g. search boxes). Refuses password fields — the user must type credentials themselves. Returns a fresh snapshot.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref of a textbox/searchbox from the latest snapshot.' },
        text: { type: 'string', description: 'The text to type.' },
        submit: { type: 'boolean', description: 'Press Enter after typing.', default: false },
        clear: { type: 'boolean', description: 'Clear the field first (default) or append.', default: true },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'browser_scroll',
    description:
      'Scroll the browser page up or down by viewport pages, or scroll a specific ref into view. Returns a fresh snapshot of the newly visible region.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction.' },
        pages: { type: 'integer', description: 'How many viewport-heights to scroll.', default: 1 },
        ref: { type: 'string', description: 'Optional: scroll this element ref into view instead.' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'browser_history',
    description: 'Go back or forward in the active browser tab\'s history. Returns a fresh snapshot.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['back', 'forward'], description: 'History direction.' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'browser_wait',
    description:
      'Pause before reading the page again — for content that loads after navigation (spinners, lazy lists, async results). Prefer until_text: it polls and returns as soon as that text appears, so you do not over-wait. Without until_text it sleeps for the given seconds. Returns a fresh snapshot. Max 15 seconds.',
    parameters: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'How long to wait (max 15). With until_text, this is the timeout.', default: 2 },
        until_text: { type: 'string', description: 'Optional: resolve early as soon as this text appears on the page.' },
      },
      required: [],
    },
  },
  {
    name: 'browser_read_page',
    description:
      'Extract the readable text of the current browser page (article-style). Use this to actually read long content instead of scroll+snapshot loops. Long pages are chunked — call again with the returned offset for more.',
    parameters: {
      type: 'object',
      properties: {
        offset: { type: 'integer', description: 'Character offset to continue reading from.', default: 0 },
      },
      required: [],
    },
  },
  {
    name: 'browser_tabs',
    description:
      'Manage browser tabs: list open tabs, open one or more new tabs (optionally with a URL), close one, or switch the active tab. Use one action=new call with count=N when the user asks for duplicate tabs; do not issue N separate tool calls.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'new', 'close', 'select'], description: 'The tab operation.' },
        tab_id: { type: 'string', description: 'Tab id (from action=list) for close/select.' },
        url: { type: 'string', description: 'URL to open when action=new.' },
        count: { type: 'integer', description: 'Number of tabs to open for action=new, from 1 to 20.', default: 1 },
      },
      required: ['action'],
    },
  },
  {
    name: BROWSER_SCREENSHOT_TOOL_NAME,
    description:
      'LAST RESORT: capture a screenshot of the current browser page, attached as an image. Only use when the text snapshot cannot describe the page (canvas, maps, image-heavy layouts). Prefer browser_snapshot / browser_read_page — they are much faster and cheaper.',
    parameters: { type: 'object', properties: {}, required: [] },
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
    name: GAME_START_TOOL_NAME,
    description:
      'Open a playable desktop minigame when the user asks to play Tic-Tac-Toe, Connect Four, or chess. ' +
      'The game panel is controlled by the user and you through game_move. Rules, legal moves, and engine search are enforced by the app. ' +
      'Choose a difficulty that matches the user request, then make a short in-character remark explaining the opening position. ' +
      'If human_starts is false, the engine opens automatically and the result includes that move.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['tictactoe', 'connect4', 'chess'],
          description: 'The game to open: tictactoe, connect4, or chess.',
        },
        difficulty: {
          type: 'string',
          enum: ['casual', 'balanced', 'strong'],
          description: 'Engine strength. Use strong when the user asks for a serious challenge.',
        },
        human_side: {
          type: 'string',
          enum: ['w', 'b'],
          description: 'Chess side for the user. Ignored for Tic-Tac-Toe and Connect Four.',
        },
        human_starts: {
          type: 'boolean',
          description: 'Whether the user moves first. Defaults to true.',
        },
      },
      required: ['kind'],
    },
  },
  {
    name: GAME_MOVE_TOOL_NAME,
    description:
      'Make one move in the active minigame as the agent. Use move="best" to ask the built-in game engine to choose the strongest legal move for the current position. ' +
      'You may also pass an exact legal move: Tic-Tac-Toe square 0-8, Connect Four column 0-6, or chess SAN/LAN such as Nf3 or e2e4. ' +
      'Only call this when the tool result says it is the agent turn. After the result, make a brief remark about the move or position.',
    parameters: {
      type: 'object',
      properties: {
        move: {
          type: 'string',
          description: 'Use "best" for engine selection, or an exact legal move for the active game.',
        },
      },
      required: ['move'],
    },
  },
  {
    name: GAME_STATE_TOOL_NAME,
    description:
      'Read the current minigame state, including board, turn, legal move count, result, and engine. Use this when you need to comment on or reason about the position before moving.',
    parameters: {
      type: 'object',
      properties: {},
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
      'Create and activate a JavaScript plugin under the current execution policy. Export activate({registerTool}) and registerTool({definition:{name,description,parameters},requiresPermission,async execute(input,context){...}}). Available permission keys: fileRead, fileWrite, shellExec, networkAccess. The result reports whether activation succeeded; discover the resulting tool before using it.',

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


for (const tool of agentTools) {
  if (['terminal','git_status','git_diff','patch'].includes(tool.name)) tool.parameters.properties!.cwd = { type: 'string', description: 'Working directory; defaults to the active workspace.' }
  if (['write_file','edit_file'].includes(tool.name)) tool.parameters.properties!.expected_hash = { type: 'string', description: 'Revision hash returned by read_file. Stale edits are rejected.' }
  if (tool.name === 'terminal') {
    tool.description = 'Run a shell command in the active workspace. Returns a process handle and output; long commands keep running. Use process_read to inspect completion and process_stop to terminate. Prefer dedicated file tools for edits.'
    tool.parameters.properties!.timeout_ms = { type: 'number', description: 'Timeout in milliseconds. Default 600000; 0 keeps running until stopped.' }
  }
}
agentTools.push(
  { name: 'process_read', description: 'Read new output and status of a command session. A running status is not a successful exit.', parameters: { type: 'object', properties: { id: { type: 'string' }, cursor: { type: 'number' }, wait_ms: { type: 'number' } }, required: ['id'] } },
  { name: 'process_write', description: 'Write stdin to a running command session.', parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id','text'] } },
  { name: 'process_stop', description: 'Stop a command and its process tree.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'tool_search', description: 'Find optional tools by name or capability. Matching definitions become available on the next model turn.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
)

const observed = { observation_id: { type: 'string' as const, description: 'ID from the latest computer_observe; every action invalidates it.' } }
const point = { element_id: { type: 'string' as const }, x: { type: 'number' as const, description: 'X in current screenshot pixels' }, y: { type: 'number' as const, description: 'Y in current screenshot pixels' } }
const computerDefinitions: Array<[string, string, Record<string, any>, string[]]> = [
  ['observe', 'Inspect running applications and the requested or focused window. Returns observed accessibility targets and optional screenshot.', { app_id: { type: 'string' }, screenshot: { type: 'boolean' }, display_id: { type: 'string' }, crop: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, required: ['x', 'y', 'width', 'height'] } }, []],
  ['focus', 'Focus an application discovered in the observation. Re-observe after focusing.', { ...observed, app_id: { type: 'string' } }, ['observation_id', 'app_id']],
  ['click', 'Click an observed accessibility target or screenshot-grounded point. Observe afterward.', { ...observed, ...point, button: { type: 'string', enum: ['left', 'right'] }, count: { type: 'integer', enum: [1, 2] } }, ['observation_id']],
  ['type', 'Type Unicode text in the focused control. Observe afterward.', { ...observed, text: { type: 'string' } }, ['observation_id', 'text']],
  ['key', 'Send a key or shortcut, e.g. cmd+s, shift+tab, enter, escape. Observe afterward.', { ...observed, key: { type: 'string' } }, ['observation_id', 'key']],
  ['scroll', 'Scroll pixels (negative dy scrolls down), optionally targeting an observed element. Observe afterward.', { ...observed, ...point, dy: { type: 'integer' }, dx: { type: 'integer' } }, ['observation_id', 'dy']],
  ['drag', 'Drag from an observed element or screenshot point to another screenshot point. Observe afterward.', { ...observed, ...point, to_x: { type: 'number' }, to_y: { type: 'number' } }, ['observation_id', 'to_x', 'to_y']],
  ['wait', 'Wait up to 15 seconds for visible accessibility text or focused application; returns observed state.', { until_text: { type: 'string' }, app_id: { type: 'string' }, timeout_ms: { type: 'integer' } }, []],
]
for (const [name, description, properties, required] of computerDefinitions) agentTools.push({ name: 'computer_' + name, description, parameters: { type: 'object', properties, required } })
const terminalDefinition = agentTools.find(t => t.name === 'terminal')!
terminalDefinition.parameters.properties!.purpose = { type: 'string', enum: ['task', 'check'], description: 'Use check for verification commands; results are bound to the current file revision.' }

// Execution contracts are owned by the tool catalog; unknown plugins are exclusive writes.
for (const tool of agentTools) tool.execution = { access: 'write', scope: 'workspace' }
for (const name of ['read_file','lsp_hover','lsp_diagnostics']) agentTools.find(t => t.name === name)!.execution = { access: 'read', scope: 'file' }
for (const name of ['write_file','edit_file']) agentTools.find(t => t.name === name)!.execution = { access: 'write', scope: 'file' }
for (const name of ['list','glob','grep','git_status','git_diff','use_skill','todoread']) agentTools.find(t => t.name === name)!.execution = { access: 'read', scope: 'workspace' }
for (const name of ['webfetch','web_search','tool_search']) agentTools.find(t => t.name === name)!.execution = { access: 'read', scope: 'network' }
for (const tool of agentTools) {
  if (tool.name.startsWith('computer_') || tool.name.startsWith('browser_')) tool.execution = { access: 'write', scope: 'desktop', lane: 'desktop' }
  if (tool.name.startsWith('process_')) tool.execution = { access: tool.name === 'process_read' ? 'read' : 'write', scope: 'process' }
  if (tool.name === 'terminal' || tool.name.startsWith('git_') || tool.name === 'github_pr_create') tool.execution!.lane = 'process'
}
