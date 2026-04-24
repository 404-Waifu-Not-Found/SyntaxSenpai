# AGENT

Practical guidance for coding agents working in this repository. For the full architecture map and the current-state snapshot, see [CLAUDE.md](./CLAUDE.md) and [STATE.md](./STATE.md) respectively.

## Project Overview

- pnpm 8 + Turborepo monorepo. Node 20 (`.nvmrc`). Workspaces: `apps/*` and `packages/*` only.
- Apps:
  - `apps/desktop` — Electron + Vue 3 + UnoCSS + Pinia (package name: `syntax-senpai-desktop`)
  - `apps/mobile` — Expo / React Native (package name: `syntax-senpai-mobile`)
  - `apps/runtime` — plain Node HTTP service, no bundler, no TS (package name: `syntax-senpai-runtime`)
- Shared libs live in `packages/*` and are scoped `@syntax-senpai/*`.
- `plugins/*` is a runtime plugin directory, **not** a workspace.

## Common Commands

Prefer the root scripts; they wrap Turbo with the correct filters. Note the scope asymmetry: apps are unscoped, packages are `@syntax-senpai/*`.

- Install: `pnpm install`
- Desktop dev: `pnpm dev:desktop` (full electron-vite); `pnpm desktop:quick` if the vite env is broken
- Mobile dev: `pnpm dev:mobile`
- Runtime dev: `pnpm dev:runtime`
- Build all workspaces: `pnpm build`
- Typecheck: `pnpm typecheck`
- Unit tests (vitest, across all packages): `pnpm test:unit`
- Runtime integration tests (`node --test`): `pnpm --filter syntax-senpai-runtime run test`
- Single vitest file in a shared package: `pnpm --filter @syntax-senpai/ai-core exec vitest run <path-substring>`
- Lint: `pnpm lint`

## Working Agreement

- Keep changes minimal and task-focused. No surrounding cleanup, speculative abstractions, or unrelated refactors.
- Prefer root-cause fixes over temporary workarounds.
- Don't modify generated output (`dist/`, `dist_electron/`, `.expo/`, `node_modules/`).
- Preserve public APIs in `packages/*` unless the task requires a breaking change — multiple apps consume them.
- Shared packages are aliased into the desktop build at source level (see `apps/desktop/electron.vite.config.mjs`). Code you put there runs in both the Electron renderer and Node main — keep it runtime-neutral or gate with explicit checks.
- Validate changes locally with the smallest relevant test/build command.

## Code Style

- Desktop: TypeScript + Vue 3 Composition API + UnoCSS + Pinia. Follow existing formatting/naming.
- Mobile: TypeScript + React Native + Expo Router + NativeWind/Zustand.
- Runtime: plain CommonJS JavaScript — stay dependency-minimal (only `@syntax-senpai/logger` today).
- Don't add a dependency unless needed.

## Where things live (quick map)

- Desktop window lifecycle, IPC registration, tray, global shortcut: `apps/desktop/src/main/`.
- Desktop IPC registrars (one file per surface): `apps/desktop/src/main/ipc/`.
- Desktop agent tool registry: `apps/desktop/src/renderer/src/agent-tools.ts` (the shared `packages/agent-tools` built-ins are not used by desktop — it re-implements its own).
- System prompt composition + chat loop: `apps/desktop/src/renderer/src/stores/chat.ts`.
- AI provider implementations: `packages/ai-core/src/providers/`. Note that `azure-openai.ts` and `fireworks-ai.ts` are stubs that throw "not yet fully implemented"; everything else in the registry is real.
- Waifu personas + prompt/memory/sentiment/voice builders: `packages/waifu-core/src/`.
- Mobile routing: `apps/mobile/app/` (Expo Router).
- Runtime endpoints + metrics + backups: `apps/runtime/src/`.
- Kubernetes manifests + Prometheus/Grafana: `infra/k8s/`, `ops/`.
