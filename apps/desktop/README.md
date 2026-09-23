# SyntaxSenpai Desktop

Primary SyntaxSenpai app: Electron main/preload, Vue 3 renderer, Pinia state, UnoCSS styling, keychain-backed provider keys, durable agent runs, mobile QR pairing, plugins, custom waifus, Live2D avatar support, in-chat games, and native macOS computer control.

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
| `src/renderer/src/stores/chat.ts` | Desktop chat state, prompt assembly, and shared-session adapter |
| `src/renderer/src/agent-tools.ts` | Desktop tool executor and browser-safe catalog import |
| `src/renderer/src/components/MiniGamePanel.vue` | In-window Tic-Tac-Toe, Connect Four, and chess UI |
| `../../packages/agent-session/` | Shared desktop/headless session loop and events |
| `../../packages/agent-tools/src/catalog.ts` | Shared browser-safe tool definitions |
| `../../packages/game-engine/` | Authoritative game state and opponents |
| `src/main/ipc/` | IPC handlers for tools, settings, storage, plugins, waifus, execution policy, WeChat, and runtime helpers |
| `scripts/verify-live2d-render.mjs` | Live2D smoke verification script |
| `src/main/agent/executor.ts` | Strict-mode command execution and web helpers |

## Provider Keys

Configure keys in **Settings -> AI**. Desktop stores keys through the OS keychain path; do not use committed `.env` files for normal app usage.

## Notes

- `pnpm dev:desktop` is the normal entry point from the repository root.
- The shared catalog owns tool definitions. The renderer executes desktop-specific effects and IPC-backed actions; Node-only helpers must not be imported through the catalog path.
- **Settings -> Data** full backups include plaintext API keys. Import replaces local chats, settings, skills, waifus, and Live2D files.
- WeChat image-send has automated coverage, but live delivery still needs verification with a paired account and message ID.
