# Coding-agent guide

Keep this file short: it is the always-loaded map, not a second architecture manual. Read [STATE.md](./STATE.md) for the current project snapshot, then open only the files owned by the task. Product/persona details are in [docs/WAIFU_PERSONALITIES.md](./docs/WAIFU_PERSONALITIES.md); provider details are in [PROVIDERS.md](./PROVIDERS.md) and [PROVIDER_SETUP.md](./PROVIDER_SETUP.md).

## Fast workflow

1. Check `git status --short --branch` first and preserve existing user changes.
2. Turn the request into a small working set: identify the owning package, its public interface, and the nearest relevant test. Use `rg --files` and targeted `rg -n`; do not inventory or reread the whole monorepo by default.
3. Trace only the necessary call path. Keep exact paths and decisions in the active task context; avoid repeating completed searches or reopening large files without a reason.
4. Make the smallest scoped change. Avoid unrelated cleanup and new dependencies.
5. Run the narrowest relevant check, then inspect `git diff --check` and the final diff. Use the full monorepo build/test only when a shared contract or cross-workspace behavior warrants it.
6. Update `STATE.md` only when a meaningful architectural fact, integration boundary, or known limitation changes. It is the durable handoff; do not create a parallel AI-state/history file or copy source details into it.

## Repository map

| Area | Owner / entry points |
| --- | --- |
| Desktop app | `apps/desktop`; Electron main and IPC under `src/main`, preload under `src/preload`, Vue UI and adapters under `src/renderer/src` |
| Chat UI / desktop tools | `apps/desktop/src/renderer/src/stores/chat.ts`, `apps/desktop/src/renderer/src/agent-tools.ts` |
| Shared agent loop | `packages/agent-session`; provider implementations are in `packages/ai-core` |
| Tool schemas | `packages/agent-tools/src/catalog.ts`; desktop and headless hosts execute effects in their own app adapters |
| Headless runner | `apps/headless`; JSONL entry point and host are under `apps/headless/src` |
| Games | `packages/game-engine` for rules/engines; desktop rendering under `apps/desktop/src/renderer/src/game` and `apps/desktop/src/renderer/src/components/MiniGamePanel.vue` |
| Waifu/personality logic | `packages/waifu-core`; long-form overview in `docs/WAIFU_PERSONALITIES.md` |
| Persistence / backup | `packages/storage` and desktop storage/backup IPC under `apps/desktop/src/main` |
| Mobile / protocol | `apps/mobile`; shared pairing protocol in `packages/ws-protocol` |
| Optional operations service | `apps/runtime`; runtime plugins are in `plugins/` (not pnpm workspaces) |

Shared packages can be consumed by multiple apps. Before changing an exported type, tool schema, IPC payload, or WebSocket message, find its callers and tests; avoid pulling Node-only modules into browser-safe renderer imports.

## Scoped commands

Use the closest package check first. Package filters are unscoped for apps and `@syntax-senpai/*` for shared packages.

```sh
pnpm --filter syntax-senpai-desktop run test:unit
pnpm --filter syntax-senpai-desktop run typecheck
pnpm --filter syntax-senpai-headless run test:unit
pnpm --filter @syntax-senpai/agent-session run test:unit
pnpm --filter @syntax-senpai/game-engine run test:unit
pnpm --filter @syntax-senpai/ai-core run test:unit
```

Common local entry points: `pnpm dev:desktop`, `pnpm dev:headless`, and `pnpm test:headless`. Check a package's `package.json` before assuming it has a script. Reserve `pnpm build`, `pnpm test`, and `pnpm typecheck` for changes whose scope justifies workspace-wide work.

## Guardrails

- Do not edit generated output (`dist/`, `dist_electron/`, `.expo/`, `node_modules/`).
- Keep shared/browser-safe code runtime-neutral; keep Electron, filesystem, and Node-only imports behind main-process or host boundaries.
- Preserve public APIs unless the task requires a change; cover changed contracts with focused tests.
- Distinguish fixtures/build success from live provider, WeChat, device, or Live2D acceptance.
- Never commit secrets. Full desktop backups contain plaintext API keys.
- Do not commit, merge, or push unless requested. Preserve unrelated dirty files and commits.
