# AGENT

This file captures practical guidance for coding agents working in this repository.

## Project Overview
- Monorepo managed with `pnpm` workspaces and Turbo.
- Apps:
  - `apps/desktop` (Electron + Vue)
  - `apps/mobile` (Expo + React Native)
  - `apps/runtime` (Node runtime service)
- Shared packages live in `packages/*`.

## Common Commands
- Install dependencies: `pnpm install`
- Run all dev targets: `pnpm dev`
- Desktop app: `pnpm --filter @syntax-senpai/desktop dev`
- Mobile app: `pnpm --filter @syntax-senpai/mobile dev`
- Runtime tests: `pnpm --filter @syntax-senpai/runtime test`

## Working Agreement
- Keep changes minimal and task-focused.
- Prefer root-cause fixes over temporary workarounds.
- Do not modify generated/build output directories unless explicitly requested.
- Validate changes locally when possible with the smallest relevant test/build command.

## Code Style
- Follow existing formatting and naming patterns in each app/package.
- Avoid adding dependencies unless required.
- Preserve public APIs in shared packages unless the task requires a breaking change.

## Notes
- Mobile routing is defined in `apps/mobile/app`.
- Desktop window lifecycle and IPC are in `apps/desktop/src/main`.
