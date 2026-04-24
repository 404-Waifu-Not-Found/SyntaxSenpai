# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source-of-truth docs

- **[STATE.md](./STATE.md)** — authoritative snapshot of what is actually built/wired vs. dormant. Read this before trusting older status docs; the previous status files were moved to `docs/archive/` and are NOT current.
- **[AGENT.MD](./AGENT.MD)** — short working-agreement for agents: keep changes minimal and task-focused, prefer root-cause fixes, preserve public APIs in shared packages.
- **[agents.md](./agents.md)** — waifu persona/personality reference (different file from `AGENT.MD`; the casing matters).
- **[CHANGELOG.md](./CHANGELOG.md)** — historical log per PR; use it to trace when a subsystem was added/reworked.

## Repo layout

pnpm monorepo managed with Turborepo. Workspace globs (`pnpm-workspace.yaml`) only cover `apps/*` and `packages/*` — `plugins/*` is NOT a workspace, it is a runtime plugin directory loaded at startup.

- `apps/desktop` — Electron + Vue 3 + UnoCSS + Pinia (primary product). Split into `src/main`, `src/preload`, `src/renderer`.
- `apps/mobile` — Expo / React Native client; pairs to desktop via QR + WebSocket.
- `apps/runtime` — plain Node (no bundler, no TS) HTTP service for health, Prometheus metrics, backups, plugin discovery.
- `packages/ai-core` — provider abstraction, runtime, retry, trace, planner. 19 providers under `src/providers`.
- `packages/waifu-core` — waifu personas + prompt/memory/affection/sentiment/skills builders.
- `packages/agent-tools` — shared tool registry + built-ins. See gotcha below — desktop doesn't use these.
- `packages/storage` — JSON-backed chat + memory stores (separate `index.native.ts` entry for RN).
- `packages/{ui,ui-loading-screens,ui-transitions}` — shared Vue UI.
- `packages/ws-protocol` — shared WS types for mobile pairing.
- `packages/logger` — zero-dep structured logger (plain JS + `.d.ts`), used by runtime and desktop main.
- `plugins/` — manifest-based tool plugins (`plugin.json` + entry exporting `activate({ manifest, registerTool })`).
- `infra/k8s`, `ops/` — Kubernetes base + overlays, Prometheus/Grafana configs.

## Commands

Node 20 (`.nvmrc`) and pnpm 8 are required. Use root scripts whenever possible; they wrap Turbo with the right filters.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Desktop dev (full) | `pnpm dev:desktop` (electron-vite) |
| Desktop dev (quick, no Vite) | `pnpm desktop:quick` — minimal Electron entry, useful when the electron-vite env is broken |
| Mobile dev | `pnpm dev:mobile` (Expo) |
| Runtime dev | `pnpm dev:runtime` (plain `node src/server.js`, no build step) |
| Build everything | `pnpm build` (Turbo; `dev:desktop` and `dev:mobile` are cache=false/persistent) |
| Unit tests | `pnpm test:unit` — recurses via `pnpm -r --if-present run test:unit` (vitest, node env) |
| Turbo test | `pnpm test` — depends on `^build`; used in CI for runtime integration |
| Typecheck (root) | `pnpm typecheck` — runs `tsc -p tsconfig.base.json --noEmit` across the tree |
| Lint | `pnpm lint` |
| Docker runtime | `pnpm docker:build` / `pnpm docker:up` (runtime + Prometheus + Grafana) |

Package-scoped test examples:

```bash
# All vitest tests in one package
pnpm --filter @syntax-senpai/ai-core run test:unit

# A single test file (vitest filters by path substring)
pnpm --filter @syntax-senpai/ai-core exec vitest run retry

# Runtime's node --test suite (no vitest)
pnpm --filter syntax-senpai-runtime run test
```

CI (`.github/workflows/ci.yml`) deliberately skips building `syntax-senpai-desktop` and `syntax-senpai-mobile`, but builds every other workspace, runs `typecheck`, runs `test:unit` across all packages, runs the runtime `node --test` suite, and does a Docker build smoke test.

## Architecture — what requires reading multiple files to understand

### Desktop: main/preload/renderer + workspace aliasing

`apps/desktop/electron.vite.config.mjs` aliases every `@syntax-senpai/*` import to the package's `src/index.ts` for all three targets (main, preload, renderer) and marks those workspaces non-external. That means:

- You can edit a shared package and the desktop dev build picks it up without rebuilding the package.
- Native deps (`better-sqlite3`, `keytar`, `expo-secure-store`, `expo`) are explicitly externalized. Don't import Expo-only modules from code that runs in the desktop renderer.
- Renderer path alias `@` → `apps/desktop/src/renderer/src`.

Main process (`apps/desktop/src/main/index.ts`) has a self-relaunch guard — when started via the npm electron shim under `ELECTRON_RUN_AS_NODE`, it re-spawns the real Electron binary. Don't remove that block.

Main wires IPC through many registrars in `src/main/ipc/*` (agent, chat, terminal, filesystem, keystore, provider, spotify, export, ws, plugins, waifus, strict-mode, log, repository, skills, pending-plugins). Each has a renderer-side counterpart wired via the preload bridge.

### Agent pipeline lives in two places

This is the biggest trap in the repo:

- `packages/agent-tools/src/builtin/*` contains shared tool built-ins (clipboard, fs-read, notify, web-search). **The desktop renderer does NOT import them.** It re-implements its own tool set in `apps/desktop/src/renderer/src/agent-tools.ts`, routed through Electron IPC. The shared package is kept for mobile + future non-Electron clients.
- `apps/desktop/src/main/agent/executor.ts` has an allowlist + JSONL audit log, but **it is not wired**. The live path is `ipc/terminal.ts` + `ipc/filesystem.ts`, which gate destructive patterns (`rm -rf`, `sudo`, `dd of=/dev/…`, `git reset --hard`, fork bombs) via a native dialog. `executor.ts` is dormant code kept for a future strict-ask mode — don't assume edits there affect running behavior.

When adding/removing an agent tool used by the desktop app, edit `apps/desktop/src/renderer/src/agent-tools.ts` and the matching IPC handler in `apps/desktop/src/main/ipc/`. The Pinia store at `apps/desktop/src/renderer/src/stores/chat.ts` (~2.5k lines) is where tool definitions flow into the model loop via `getToolsForMode()`, and unknown tool names fall through to `plugins:execTool` so plugin-registered tools just work.

### System prompt composition

Assembled in `apps/desktop/src/renderer/src/stores/chat.ts` from, in order:

1. `createWaifuSystemPrompt` (from `@syntax-senpai/waifu-core`)
2. `buildMemoryContext` — persistent memory
3. `buildAffectionPrompt` — affection meter rules
4. `buildApiTelemetryPrompt` — last-turn latency feedback
5. `buildGroupChatPromptBlock` — only in group-chat mode
6. `buildAgentBehaviorPrompt` — plan → gather → do-one-thing → diagnose → retry-once → verify (only when tools enabled)
7. `buildCodingSessionPromptBlock` — auto-injected when the user message looks code-shaped (code fence, file path, tool name, coding verb, error stack)

Every tool result is passed through `annotateToolResult` which appends iteration-budget feedback so the model knows how many iterations remain.

### Providers

`packages/ai-core/src/providers/` has 22 files. Per STATE.md:
- 19 are fully implemented end-to-end (Anthropic, OpenAI, OpenAI Codex, Gemini, Mistral, Groq, DeepSeek, Perplexity, Together, xAI + xAI Grok, HuggingFace, GitHub Models, MiniMax global + CN, Fireworks, Azure OpenAI, Ollama, LM Studio).
- **3 are stubs that throw on invocation and are hidden from the desktop picker**: `cohere.ts`, `replicate.ts`, `aws-bedrock.ts`. Don't regress them into the visible list without actually implementing them. (Note: `PROVIDERS.md` is an older marketing-oriented doc and still lists Replicate/Bedrock/Cohere as "partially implemented"; STATE.md is newer and correct.)

Ollama and LM Studio are keyless (local). Provider selection/keys are stored via `keytar` on desktop; API keys are configured in-app through Settings, not via `.env` (except for the dev-only `.env.example`).

### Runtime service

`apps/runtime` is intentionally plain Node with no bundler and no TypeScript — it ships as a container for health/metrics/backups. Endpoints: `/healthz`, `/readyz`, `/metrics`, `/api/v1/backups/{,export,restore}`, `/api/v1/plugins`, `/api/v1/telemetry/ai`. `/api/v1/*` is gated by a bearer token when `config.authToken` is set. Tests are `node --test` style under `apps/runtime/test/`, not vitest.

### Plugin system

Plugins live in `plugins/<name>/` with a `plugin.json` manifest + an entry exporting `activate({ manifest, registerTool })`. They are loaded by `loadToolPlugins()` in the desktop main at startup; the renderer picks up their tool defs via `plugins:listTools` and executes them via `plugins:execTool`. Waifus can also draft pending plugins via the `propose_tool` agent tool — those land in `<userData>/pending-plugins/<slug>/` and must be approved in Settings → Plugins before activation. Skills (`create_skill`/`use_skill`) follow the same pattern, stored as `SKILL.md` files under `<userData>/skills/<slug>/`.

## Conventions

- Desktop code: TypeScript + Vue 3 Composition API + UnoCSS + Pinia. Follow existing formatting/naming in each file.
- When editing a shared package that is aliased into the desktop build (see "workspace aliasing" above), remember you are editing source that runs in both the Electron renderer and Node main — keep it runtime-neutral, or gate with explicit checks.
- Preserve public APIs in `packages/*` unless the task requires a breaking change; multiple apps consume them.
- Don't modify `dist/`, `dist_electron/`, `.expo/`, or other generated output.
- Don't commit API keys. The in-app Settings panel or `.env.local` (gitignored) is the right place.
