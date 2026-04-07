Quickstart (macOS)

Prerequisites:
- Node 20+ (check with `node -v`)
- pnpm (install via `npm i -g pnpm`)

Steps:
1. From repository root: `pnpm install`
2. Run the desktop dev build that uses a minimal Electron entry (no Vite):
   `pnpm --filter syntax-senpai-desktop run dev:quick`

This launches a minimal Electron window (main.js -> index.html). For full dev (React + Vite) use `pnpm --filter syntax-senpai-desktop run dev` (electron-vite), but that requires the electron-vite dev environment.
