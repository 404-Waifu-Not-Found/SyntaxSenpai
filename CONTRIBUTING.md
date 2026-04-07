# Contributing to SyntaxSenpai

Thanks for your interest in contributing! A few quick notes to get started.

## Requirements
- Node >= 25
- npm >= 11

## Local setup
1. Copy environment template: `cp .env.example .env.local`
2. Fill in any provider API keys you need in `.env.local` (see PROVIDER_SETUP.md)
3. Install dependencies: `npm install`

## Useful scripts
- `npm run dev:desktop` — start the desktop app in dev mode
- `npm run dev:mobile` — start the mobile app in dev mode
- `npm run build` — build all workspaces
- `npm run test` — run tests
- `npm run lint` — run linters
- `npm run typecheck` — run TypeScript type checks

## Provider setup & security
- See PROVIDER_SETUP.md for provider configuration details.
- Do NOT commit API keys or secrets. Use `.env.local` and platform-native keystores.

## Pull request process
1. Fork the repo
2. Create a branch for your changes
3. Open a PR — include screenshots and a summary of changes

Thanks — maintainers will review and provide feedback.