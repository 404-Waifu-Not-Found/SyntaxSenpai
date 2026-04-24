# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source-of-truth docs

- **[STATE.md](./STATE.md)** — authoritative snapshot of what is actually built/wired vs. dormant. Older status files were moved to `docs/archive/` and are NOT current.
- **[AGENT.MD](./AGENT.MD)** — short working agreement for agents: keep changes minimal and task-focused, prefer root-cause fixes, preserve public APIs in shared packages.
- **[agents.md](./agents.md)** — waifu persona/personality reference (different file from `AGENT.MD`; the casing matters).
- **[CHANGELOG.md](./CHANGELOG.md)** — historical log per PR; use it to trace when a subsystem was added/reworked.
- **[PROVIDERS.md](./PROVIDERS.md)** — older marketing-oriented provider doc; treat the status claims as out of date (see "Providers" below for the current truth).

## Repo layout

pnpm monorepo managed with Turborepo. Workspace globs (`pnpm-workspace.yaml`) only cover `apps/*` and `packages/*` — `plugins/*` is NOT a workspace, it is a runtime plugin directory loaded at startup.

- `apps/desktop` — Electron + Vue 3 + UnoCSS + Pinia (primary product). Split into `src/main`, `src/preload`, `src/renderer`. Package name: `syntax-senpai-desktop` (unscoped).
- `apps/mobile` — Expo / React Native client; pairs to desktop via QR + WebSocket. Package name: `syntax-senpai-mobile`.
- `apps/runtime` — plain Node (no bundler, no TS) HTTP service for health, Prometheus metrics, backups, plugin discovery. Package name: `syntax-senpai-runtime`.
- `packages/ai-core` — provider abstraction, runtime, retry, trace, planner. 20 providers under `src/providers/` (see "Providers" below).
- `packages/waifu-core` — 5 built-in waifus + prompt/memory/sentiment/voice/milestones/skills builders.
- `packages/agent-tools` — shared tool registry + plugin loader. Desktop uses the registry + loader for plugins but re-implements the per-call tool set in the renderer (see "Agent pipeline" below).
- `packages/storage` — chat + memory stores. Separate `index.native.ts` entry for RN (keystore + export only — no desktop SQLite).
- `packages/{ui,ui-loading-screens,ui-transitions}` — shared Vue UI.
- `packages/ws-protocol` — shared WS types for mobile pairing.
- `packages/logger` — zero-dep structured logger (plain JS + `.d.ts`), used by `apps/runtime` and desktop main.
- `plugins/echo-tool`, `plugins/http-fetch`, `plugins/github-api` — reference plugins (`plugin.json` manifest + entry exporting `activate({ manifest, registerTool })`).
- `infra/k8s`, `ops/` — Kubernetes base + overlays, Prometheus/Grafana configs.

**Package name gotcha:** the three apps are unscoped (`syntax-senpai-desktop`, `syntax-senpai-mobile`, `syntax-senpai-runtime`), while every shared workspace under `packages/` is scoped `@syntax-senpai/*`. `pnpm --filter` calls need to use the right form.

## Commands

Node 20 (`.nvmrc`) and pnpm 8 are required. Use root scripts whenever possible; they wrap Turbo with the right filters.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Desktop dev (full) | `pnpm dev:desktop` (electron-vite) |
| Desktop dev (quick, no Vite) | `pnpm desktop:quick` — minimal Electron entry, useful when the electron-vite env is broken |
| Mobile dev | `pnpm dev:mobile` (Expo) |
| Runtime dev | `pnpm dev:runtime` (`node src/server.js`, no build step) |
| Build everything | `pnpm build` (Turbo; `dev:desktop` and `dev:mobile` are cache=false/persistent) |
| Unit tests | `pnpm test:unit` — recurses via `pnpm -r --if-present run test:unit` (vitest, node env) |
| Turbo test | `pnpm test` — depends on `^build`; used in CI for runtime integration |
| Typecheck (root) | `pnpm typecheck` — runs `tsc -p tsconfig.base.json --noEmit` across the tree |
| Lint | `pnpm lint` |
| Docker runtime | `pnpm docker:build` / `pnpm docker:up` (runtime + Prometheus + Grafana) |

Package-scoped examples (note the scope difference between packages and apps):

```bash
# All vitest tests in one shared package
pnpm --filter @syntax-senpai/ai-core run test:unit

# A single test file (vitest filters by path substring)
pnpm --filter @syntax-senpai/ai-core exec vitest run retry

# Runtime's node --test suite (no vitest) — note unscoped name
pnpm --filter syntax-senpai-runtime run test
```

CI (`.github/workflows/ci.yml`) deliberately skips building `syntax-senpai-desktop` and `syntax-senpai-mobile`, but builds every other workspace, runs `typecheck`, runs `test:unit` across all packages, runs the runtime `node --test` suite, and does a Docker build smoke test. Other workflows: `macos-ci.yml`, `windows-ci.yml`, `docker-publish.yml`, `deploy-runtime.yml`, `claude.yml`, `claude-code-review.yml`.

## Architecture — what requires reading multiple files to understand

### Desktop: main/preload/renderer + workspace aliasing

`apps/desktop/electron.vite.config.mjs` aliases every `@syntax-senpai/*` shared package to the package's `src/index.ts` for all three targets (main, preload, renderer) and marks those workspaces non-external. That means:

- You can edit a shared package and the desktop dev build picks it up without rebuilding the package.
- Native deps (`better-sqlite3`, `keytar`, `expo-secure-store`, `expo`) are explicitly externalized. Don't import Expo-only modules from code that runs in the desktop renderer.
- Renderer path alias `@` → `apps/desktop/src/renderer/src`.

Main process entry (`apps/desktop/src/main/index.ts`) has a self-relaunch guard — when started via the npm electron shim under `ELECTRON_RUN_AS_NODE`, it re-spawns the real Electron binary. Don't remove that block. It also registers the `CommandOrControl+Shift+Space` global shortcut and a tray icon, and unregisters all shortcuts on `will-quit`.

Main wires IPC through registrars in `src/main/ipc/*.ts`: `agent`, `chat` (store + memory), `terminal`, `filesystem`, `keystore`, `provider`, `spotify`, `export`, `ws` (mobile pairing), `plugins`, `waifus`, `strict-mode`, `log`, `repository`, `skills`, `pending-plugins`. Each has a renderer-side counterpart wired via the preload bridge.

### Agent pipeline — where the tools actually live

This is the biggest trap in the repo:

- **`apps/desktop/src/renderer/src/agent-tools.ts`** is the authoritative tool list for the desktop app. It defines: `terminal`, `read_file`, `write_file`, `edit_file`, `clipboard_read`, `clipboard_write`, `git_status`, `git_diff`, `git_commit`, `git_push`, `github_pr_create`, `rename_chat`, `todo_write`, `web_search`, `spotify_now_playing`, `spotify_control`, `set_affection`, `render_card` (weather/table/link_preview/code_comparison), `create_skill`, `use_skill`, `propose_tool`, `stop_response`. All routed through Electron IPC.
- **`packages/agent-tools/src/builtin/*`** (clipboard, fs-read, notify, web-search) are shared built-ins that the desktop renderer does **not** import — it re-implements its own tool defs. The shared package *is* still used by desktop for its `ToolRegistry` + `loadToolPlugins` exports (see `apps/desktop/src/main/ipc/plugins.ts`), and the built-ins are kept because mobile + future non-Electron clients may use them.
- **`apps/desktop/src/main/agent/executor.ts`** is wired. It exports `webSearch` (consumed by `ws-server.ts`), an allowlist-based `runCommand` (consumed by `ipc/terminal.ts` when strict mode gates a command), and the full surface imported by `ipc/agent.ts` and `ipc/strict-mode.ts`. Destructive patterns are also gated pre-executor in `ipc/terminal.ts` (`rm -rf`, `sudo`, `mkfs`, `dd of=/dev/…`, `git reset --hard`, force-push, fork bombs, etc.) via a native dialog. Strict-mode sandbox toggles live in `ipc/strict-mode.ts` + Settings → General.
- The Pinia store at `apps/desktop/src/renderer/src/stores/chat.ts` (~2.5k lines) is the orchestrator. `getToolsForMode()` filters tools by agent mode (`ask` / `auto` / `full`), appends plugin tools from `pluginToolsCache` (populated via `plugins:listTools`), and any unknown tool name falls through to `plugins:execTool` so plugin-registered tools just work.

When adding/removing a desktop agent tool, edit `apps/desktop/src/renderer/src/agent-tools.ts` and the matching IPC handler in `apps/desktop/src/main/ipc/`.

### System prompt composition

Assembled in `apps/desktop/src/renderer/src/stores/chat.ts` (see the send/retry paths around `stores/chat.ts:1485` and `stores/chat.ts:1961`) from, in order:

1. `createWaifuSystemPrompt` → `buildSystemPrompt` from `@syntax-senpai/waifu-core`
2. `buildMemoryContext` — persistent memory
3. `buildAffectionPrompt` — affection meter rules
4. `buildApiTelemetryPrompt` — last-turn latency feedback
5. `buildGroupChatPromptBlock` — group-chat mode only
6. `buildAgentBehaviorPrompt` — plan → gather → do-one-thing → diagnose → retry-once → verify (only when tools enabled)
7. `buildCodingSessionPromptBlock` — auto-injected when the user message looks code-shaped (code fence, file path, tool name, coding verb, error stack)

Every tool result is passed through `annotateToolResult` which appends iteration-budget feedback so the model knows how many iterations remain. Available skills (from `<userData>/skills/`) are listed via `formatSkillsForPrompt`.

### Providers — the accurate picture

`packages/ai-core/src/providers/` contains 20 registered provider IDs (see the `case` list in `providers/index.ts`). `PROVIDERS.md` and the older STATE.md section are both out of date — here is what the source actually says:

- **18 fully implemented** (either a direct implementation or inherits from `OpenAIProvider` / `OpenAICompatibleProvider` in `base.ts`): `anthropic`, `openai`, `gemini`, `mistral`, `cohere`, `together`, `groq`, `perplexity`, `huggingface`, `deepseek`, `minimax-global`, `minimax-cn`, `ollama`, `lmstudio`, `xai`, `xai-grok`, `openai-codex`, `github-models`.
- **2 stubs** — `chat()` and `stream()` throw `"... provider not yet fully implemented"`: **`azure-openai`** (`providers/azure-openai.ts:38,42`) and **`fireworks`** (`providers/fireworks-ai.ts:31,35`). These are the ones to hide from the picker or avoid selecting.
- **Removed** (per CHANGELOG PR #12): Replicate and AWS Bedrock — no files, no registry entry. Do not reintroduce them without implementing.
- `cohere` **is** implemented (contrary to STATE.md). Its `throw` calls in `providers/cohere.ts` are response-error handling, not "not implemented".

Ollama and LM Studio are keyless (local). Provider selection/keys are stored via `keytar` on desktop through `ipc/keystore.ts` (service: `syntax-senpai-keys`). API keys are configured in-app through Settings, not via `.env` (except for the dev-only `.env.example`).

### Runtime service

`apps/runtime` is intentionally plain Node with no bundler and no TypeScript — it ships as a container for health/metrics/backups. Endpoints:

- `/healthz`, `/readyz`, `/metrics` (GET)
- `/api/v1/backups` (GET list), `/api/v1/backups/export` (POST), `/api/v1/backups/restore` (POST)
- `/api/v1/plugins` (GET)
- `/api/v1/telemetry/ai` (POST)

`/api/v1/*` is gated by a bearer token when `RUNTIME_AUTH_TOKEN` is set. Other env vars the server reads: `HOST`, `PORT` (default 8787), `SYNTAX_SENPAI_DATA_DIR`, `SYNTAX_SENPAI_PLUGIN_DIR`, `SYNTAX_SENPAI_BACKUP_DIR`, `BACKUP_MAX_FILES`, `BACKUP_RETENTION_DAYS`, `SERVICE_NAME`, `APP_VERSION`. Tests live under `apps/runtime/test/*.test.js` and use `node --test` (not vitest).

### Plugin system

Plugins live in `plugins/<name>/` with a `plugin.json` manifest + an entry exporting `activate({ manifest, registerTool })`. The contract is real — see `plugins/echo-tool/`, `plugins/http-fetch/` (with safety: rejects non-http(s), blocks private hosts unless `ALLOW_PRIVATE_HOSTS=1`, 256 KB body cap), `plugins/github-api/` (reads `GITHUB_TOKEN`).

They are loaded by `loadToolPlugins()` from `@syntax-senpai/agent-tools` in the desktop main at startup (`ipc/plugins.ts`); the renderer picks up their tool defs via `plugins:listTools` and executes them via `plugins:execTool`. Waifus can also draft pending plugins via the `propose_tool` agent tool — those land in `<userData>/pending-plugins/<slug>/` and must be approved in Settings → Plugins before activation. Skills (`create_skill` / `use_skill`) follow the same pattern, stored as `SKILL.md` files under `<userData>/skills/<slug>/`.

### Built-in waifu roster

Five personas are defined in `packages/waifu-core/src/index.ts` (not two, despite what older drafts of `agents.md` suggest): **aria** (cheerful tinkerer), **sakura** (genki tutor), **rei** (kuudere architect), **hana** (tsundere DevOps), **luna** (mysterious/philosophical). All default to `anthropic` / `claude-3-5-sonnet-20241022`. Milestones, sentiment, voice, skills, and the prompt builder are exported from sibling modules; see `personality.ts` (`buildSystemPrompt`), `sentiment.ts` (`classifySentiment`, `EXPRESSION_EMOJI`), `milestones.ts` (`AFFECTION_TIERS`, `detectMilestone`, `describeMilestone`, `getTier`), `voice.ts` (`getVoiceProfile`, `pickVoice`, `trimForSpeech`), `skills.ts` (`parseSkillFile`, `serializeSkill`, `formatSkillsForPrompt`, `isValidSkillSlug`), `custom-loader.ts` (`loadCustomWaifus`, `validateWaifu`), `memory.ts` (`WaifuMemoryManager`).

## Conventions

- Desktop code: TypeScript + Vue 3 Composition API + UnoCSS + Pinia. Follow existing formatting/naming in each file.
- When editing a shared package that is aliased into the desktop build (see "workspace aliasing" above), remember you are editing source that runs in both the Electron renderer and Node main — keep it runtime-neutral, or gate with explicit checks.
- Preserve public APIs in `packages/*` unless the task requires a breaking change; multiple apps consume them.
- Don't modify `dist/`, `dist_electron/`, `.expo/`, or other generated output.
- Don't commit API keys. The in-app Settings panel or `.env.local` (gitignored) is the right place.
