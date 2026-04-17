# Contributing to SyntaxSenpai

Thanks for your interest in contributing! This guide will help you get set up and make your first contribution.

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 8

## Local setup

```bash
# Clone your fork
git clone https://github.com/<your-username>/SyntaxSenpai.git
cd SyntaxSenpai

# Install dependencies
pnpm install

# Start the desktop app
pnpm dev:desktop
```

API keys are configured in-app through the Settings panel.

## Build the iOS app

Requirements:

- macOS
- Xcode and Xcode Command Line Tools
- CocoaPods
- An iOS Simulator or physical iPhone

Development build commands:

```bash
# Install dependencies
pnpm install

# Start the Expo dev server for mobile
pnpm dev:mobile

# In a second terminal, build and run the iOS app locally
cd apps/mobile
pnpm ios
```

Build locally for a physical iPhone with Expo:

```bash
cd apps/mobile
npx expo run:ios --device
```

If Xcode reports a provisioning profile error for `com.syntaxsenpai.app`, open the workspace at
`apps/mobile/ios/SyntaxSenpai.xcworkspace` in Xcode and configure a valid Apple Developer team and
bundle identifier for your machine. The generated Xcode project currently includes a default team
ID, which may not match your local Apple account.

If native dependencies are out of sync, regenerate the iOS native project and pods:

```bash
cd apps/mobile
npx expo prebuild -p ios
npx pod-install ios
pnpm ios
```

Production build command with EAS:

```bash
cd apps/mobile
npx eas build --platform ios
```

If `eas` is not installed globally, use `npx eas ...` instead of `eas ...`.

## Project structure

This is a **pnpm monorepo** managed with [Turborepo](https://turbo.build/repo). Key directories:

- `apps/desktop/` — Electron + Vue 3 desktop app
- `apps/mobile/` — Mobile app target
- `packages/` — Shared libraries (AI core, waifu definitions, storage, UI, etc.)

## Useful scripts

| Command | Description |
|---|---|
| `pnpm dev:desktop` | Start the desktop app in dev mode |
| `pnpm dev:mobile` | Start the mobile app in dev mode |
| `pnpm build` | Build all workspaces |
| `pnpm test` | Run all tests |
| `pnpm lint` | Run linters |
| `pnpm typecheck` | TypeScript type checks |

## Guidelines

- **Do NOT commit API keys or secrets.** Use the in-app settings or `.env.local` (gitignored).
- Write clear, descriptive commit messages.
- Keep PRs focused — one feature or fix per PR.
- Add tests for new functionality when possible.
- Follow the existing code style (TypeScript, Vue 3 Composition API, UnoCSS).

## Pull request process

1. Fork the repo and create a branch from `main`.
2. Make your changes and ensure `pnpm test` and `pnpm typecheck` pass.
3. Open a PR with a clear title and description.
4. Include screenshots for UI changes.
5. A maintainer will review and provide feedback.

## Reporting bugs

Please use [GitHub Issues](https://github.com/404-Waifu-Not-Found/SyntaxSenpai/issues) with the bug report template.

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

Thanks for contributing!
