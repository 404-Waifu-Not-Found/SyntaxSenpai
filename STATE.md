# SyntaxSenpai — Current State

_Consolidates NEXT_STEPS.md, PROJECT_STATUS.md, STATUS_CHECKLIST.md, PHASE_1_COMPLETE.md, IMPLEMENTATION_PLAN.md, IMPLEMENTATION_COMPLETE.md, TODAY_COMPLETED.txt, SESSION_SUMMARY.md (all frozen at an earlier point in development) into a single accurate snapshot. This file is the current source of truth; the older docs remain in the repo for historical reference but should not be trusted for current status._

## Product

SyntaxSenpai is an Electron desktop app ("waifu"-themed AI chatbot) with:

- Multi-provider chat with tool calling and streaming
- An agent tier (ask / auto / full modes) with file + shell + web-search tools
- 17 theme presets including a live hue-cycling Rainbow mode and a Sakura petals overlay
- Near-fullscreen Claude-Mac-style settings window (sidebar nav)
- QR-pair mobile companion (scan a QR to use your phone as a remote)
- Memory system, group chat with multiple waifus, per-waifu affection meter

## Apps & packages

- `apps/desktop` — Electron + Vue 3 + UnoCSS (primary product)
- `apps/mobile` — React Native client (pairs via QR to desktop)
- `packages/ai-core` — provider abstraction, runtime, retry, trace, planner
- `packages/storage` — JSON-backed chat store + memory store
- `packages/agent-tools` — shared agent-tool built-ins (currently unused by the desktop renderer, which re-implements its own in `apps/desktop/src/renderer/src/agent-tools.ts`)
- `packages/ui`, `packages/ui-loading-screens`, `packages/ui-transitions` — shared Vue UI
- `packages/waifu-core` — waifu personas + prompt builders
- `packages/ws-protocol` — shared WS types for mobile pairing

## Providers

### Fully implemented (work end-to-end)

| ID | File |
|---|---|
| `anthropic` | providers/anthropic.ts |
| `openai` | providers/openai.ts |
| `openai-codex` | providers/openai-codex.ts |
| `gemini` | providers/google-gemini.ts |
| `mistral` | providers/mistral.ts |
| `groq` | providers/groq.ts |
| `deepseek` | providers/deepseek.ts |
| `perplexity` | providers/perplexity.ts |
| `together` | providers/together-ai.ts |
| `xai` / `xai-grok` | providers/xai.ts, xai-grok.ts |
| `huggingface` | providers/huggingface.ts |
| `github-models` | providers/github-models.ts |
| `minimax-global` / `minimax-cn` | providers/minimax-*.ts |
| `fireworks` | providers/fireworks-ai.ts |
| `azure-openai` | providers/azure-openai.ts |
| `ollama` (keyless) | providers/ollama.ts |
| `lmstudio` (keyless) | providers/lmstudio.ts |

### Stubs (throw on call — not exposed in the desktop UI picker)

- `cohere` — providers/cohere.ts
- `replicate` — providers/replicate.ts
- `aws-bedrock` — providers/aws-bedrock.ts

## Agent tools (renderer-side)

Defined in `apps/desktop/src/renderer/src/agent-tools.ts`. All routed through Electron IPC.

- `terminal` — shell command runner with native-dialog confirmation for destructive patterns (`rm -rf`, `sudo`, `dd of=/dev/…`, `git reset --hard`, fork bombs, etc.)
- `read_file` / `write_file` / `edit_file` — precise file I/O with line-numbered reads and unique-match edits
- `web_search` — DuckDuckGo HTML scrape via `agent:webSearch`
- `clipboard_read` / `clipboard_write` — system clipboard through `clipboard:read` / `clipboard:write`
- `git_status` / `git_diff` — convenience wrappers
- `todo_write` — first-class structured checklist rendered in the chat UI
- `spotify_now_playing` / `spotify_control` — Spotify desktop control
- `set_affection` — internal affection meter update
- `stop_response` — terminates the agent loop with a final in-character message

## Agent prompt

System prompt is composed in `stores/chat.ts` from:

1. `createWaifuSystemPrompt` (from `packages/waifu-core`)
2. `buildMemoryContext` — persistent memory
3. `buildAffectionPrompt` — affection meter rules
4. `buildApiTelemetryPrompt` — last-turn latency feedback
5. `buildGroupChatPromptBlock` (group chat only)
6. `buildAgentBehaviorPrompt` — plan → gather → do-one-thing → diagnose → retry-once → verify rules (appended when tools are enabled)
7. `buildCodingSessionPromptBlock` — auto-injected when the user's message looks like a coding task (code fence, file path, tool name, coding verb, error stack, etc.)

Iteration budget feedback is appended to every tool result (`annotateToolResult`) so the model knows how many iterations remain.

## Settings UI

Left sidebar with 7 tabs:

- **General** — language, waifu, group chat
- **AI** — provider, API key, Refresh models button
- **Data** — full JSON export/import, Markdown export of current conversation
- **Metrics** — max tool iterations, response-time spike threshold, live telemetry (latest / avg / p95 / alert count, bar chart, per-sample list) with auto-selected time units
- **Theme** — 17 presets including Rainbow (live hue cycle via `mix-blend-mode: color` overlay) and Sakura Dark + falling petals overlay
- **Interface** — UI density (cozy / compact), corner-radius scale, backdrop-blur slider, sakura-petals toggle
- **Mobile** — QR pairing + connection status

## Chat UX niceties

- Token + cost counter above the messages (cumulative per conversation, rough USD)
- Per-message Regenerate / Delete on hover
- Active todo-list strip above the messages
- Image attachments: paperclip button, clipboard paste, drag-drop overlay, inline thumbnails
- 429 / transient errors retry with a toast ("Rate limited — retrying in 3s")
- Keyboard shortcuts: Cmd/Ctrl-K new chat, Cmd/Ctrl-, settings, Esc close, `?` overlay
- Global tray icon + `Cmd/Ctrl-Shift-Space` toggle window

## Crash handling

- Main: `process.on('uncaughtException' | 'unhandledRejection')` → appends to `<userData>/crash.log`
- Renderer: `window.onerror` + `window.onunhandledrejection` → dispatches `app:error` → toast

## Dev

```sh
pnpm install
cd apps/desktop
pnpm dev      # electron-vite, with DevTools
pnpm build    # dist/{main,preload,renderer}
pnpm start    # runs dist/main/index.js via electron
pnpm typecheck
```

## Known gaps / intentional dormant code

- `apps/desktop/src/main/agent/executor.ts` — allowlist + JSONL audit log for agent commands exists but is NOT wired. The live path is `ipc/terminal.ts` + `ipc/filesystem.ts`, which gate destructive patterns with a native dialog. `executor.ts` is kept as a starting point for a future corporate / "strict ask" mode.
- `packages/agent-tools/src/builtin/*` (clipboard, fs-read, notify, web-search) are shared built-ins that the desktop renderer does not import — it re-implements its own tool defs. They're kept because mobile + future non-Electron clients may use them.
- Cohere / Replicate / AWS Bedrock providers are registered but throw on invocation. None are exposed in the desktop provider dropdown.
