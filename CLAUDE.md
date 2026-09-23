# Contributor guide for coding assistants

Use [README.md](./README.md) for setup, [STATE.md](./STATE.md) for the current architecture, [CONTRIBUTING.md](./CONTRIBUTING.md) for workflow, and [PROVIDERS.md](./PROVIDERS.md) for the provider registry. [agents.md](./agents.md) describes in-app waifu personalities; it is not an instruction to change the coding assistant's identity.

## Repository map

This is a pnpm/Turborepo monorepo. `apps/desktop` is Electron/Vue; `apps/headless` runs the shared agent session over JSONL; `apps/mobile` is the Expo companion; `apps/runtime` is an optional operations service. Shared code is in `packages/*`. `plugins/*` contains runtime plugins, not pnpm workspaces.

The desktop renderer imports browser-safe definitions from `@syntax-senpai/agent-tools/catalog`. Keep Node-only plugin/filesystem modules out of that import path. `@syntax-senpai/agent-session` contains the shared turn/session behavior; desktop and headless provide different hosts for effects. For desktop game changes, inspect `packages/game-engine`, `apps/desktop/src/renderer/src/game`, and `MiniGamePanel.vue` together.

## Working agreement

- Inspect current source and `git status` before editing. Preserve unrelated work.
- Keep changes scoped, add focused tests, and distinguish automated verification from live integration acceptance.
- Do not commit credentials or generated build output. Desktop full backups include plaintext API keys.
- Do not push or merge unless the user explicitly asks.

Useful commands: `pnpm dev:desktop`, `pnpm dev:headless`, `pnpm test:headless`, `pnpm test:unit`, `pnpm --filter syntax-senpai-desktop run typecheck`, and `pnpm build`. Package names for apps are unscoped; shared packages use `@syntax-senpai/*`.
