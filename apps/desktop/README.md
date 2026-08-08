# SyntaxSenpai Desktop

Primary SyntaxSenpai app: Electron main/preload, Vue 3 renderer, Pinia state, UnoCSS styling, keychain-backed provider keys, agent tools, mobile QR pairing, plugins, custom waifus, Live2D avatar support, and strict-mode shell gating.

## Run

From the repository root:

```bash
pnpm install
pnpm dev:desktop
```

Package-local commands:

```bash
pnpm --filter syntax-senpai-desktop run dev
pnpm --filter syntax-senpai-desktop run build
pnpm --filter syntax-senpai-desktop run start
pnpm --filter syntax-senpai-desktop run typecheck
pnpm --filter syntax-senpai-desktop run test:unit
pnpm --filter syntax-senpai-desktop run lint
```

## Important Paths

| Path | Purpose |
|---|---|
| `src/main/` | Electron main process, IPC, tray, shortcuts, crash logging |
| `src/preload/` | Safe bridge exposed to the renderer |
| `src/renderer/src/App.vue` | Main desktop UI |
| `src/renderer/src/stores/chat.ts` | Chat orchestration, provider calls, tools, prompt assembly |
| `src/renderer/src/agent-tools.ts` | Renderer-side tool definitions |
| `src/main/ipc/` | IPC handlers for tools, settings, storage, plugins, waifus, strict mode, WeChat, and runtime helpers |
| `scripts/verify-live2d-render.mjs` | Live2D smoke verification script |
| `src/main/agent/executor.ts` | Allowlist-based strict-mode executor and shared shell helpers |

## Provider Keys

Configure keys in **Settings -> AI**. Desktop stores keys through the OS keychain path; do not use committed `.env` files for normal app usage.

## Notes

- `pnpm dev:desktop` is the normal entry point from the repository root.
- The renderer owns the tool list; main-process IPC just executes the requested action safely.
