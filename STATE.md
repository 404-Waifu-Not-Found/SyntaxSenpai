# SyntaxSenpai — Current State

This is a code-oriented snapshot, not a claim that every integration has been verified against a live third-party service. The package READMEs and source code remain authoritative for their respective interfaces.

## Product surfaces

- `apps/desktop`: Electron main/preload plus Vue 3 renderer. Chat, settings, skills, custom waifus, Live2D, browser control, WeChat pairing, mobile pairing, and agent tools live here.
- Desktop-pet mode uses a transparent Live2D-only window beside a separate compact chat window. The main process keeps both windows topmost across workspaces and routes pet-menu actions to the chat renderer.
- `apps/headless`: Node JSONL runner for the shared agent session. It preserves conversation history in memory, emits ordered events, and accepts human game moves with engine replies; see [its README](./apps/headless/README.md).
- `apps/mobile`: Expo companion paired to the desktop over the shared WebSocket protocol.
- `apps/runtime`: optional Node operations service for health, metrics, plugins, and runtime backups. Its backup API is separate from the desktop full-backup feature.

## Agent and game architecture

- `packages/ai-core` owns providers and the lower-level agent turn loop.
- `packages/agent-session` owns the shared session loop and events used by desktop and headless. Desktop adapts events and side effects to Electron/Vue; headless emits them as JSONL. The desktop also has a separate durable coding-run service in `apps/desktop/src/main/agent/run-service.ts`.
- `packages/agent-tools/src/catalog.ts` is the browser-safe tool definition catalog. `apps/desktop/src/renderer/src/agent-tools.ts` imports that catalog and implements desktop tool execution through IPC and renderer services. Headless implements its own host in `apps/headless/src/host.ts`.
- `packages/game-engine` supplies authoritative Tic-Tac-Toe, Connect Four, and chess state/AI. Those games render in the existing desktop chat window through `MiniGamePanel.vue`; Gomoku and Fate Wheel also have in-window components. A game board is not a separate Electron window.
- Destructive shell patterns still require native confirmation. Strict mode additionally uses the allowlist executor. Agent mode and tool availability are filtered in the desktop adapter.

## Data and integrations

- Settings → Data supports a full desktop backup/import covering app settings, chats and memories, skills, custom waifus, provider configuration and API keys, and Live2D files. The resulting backup contains plaintext secrets and must be protected. Import replaces existing local data.
- Desktop API keys normally use the OS keychain. The headless runner instead uses provider environment variables or scripted provider fixtures.
- WeChat iLink supports text and image send. The image path resolves both full upload URLs and opaque upload parameters, encrypts/uploads the PNG, and reports structured failures. Desktop image-send failure can fall back to chunked text. Automated tests cover these paths; a live image-delivery check still requires a paired WeChat account and a verified message ID.
- Mobile QR pairing, Live2D rendering, browser actions, plugin loading, and third-party provider calls depend on the local environment and are not proven by a build alone.
- War Thunder settings bundle a 2026-10-07 Wiki research-tree snapshot for all five vehicle categories with local slot-icon atlases, AB/RB/SB battle ratings (RB by default), and per-vehicle research RP costs where the Wiki lists them. Users can browse offline by nation, rank, and name; selecting a vehicle fills the RP/battle/time calculator's cost. Player research progress and average RP per battle remain manual and do not sync from the game account. The desktop pet tech-tree action opens this local page; an optional button opens the live Wiki in a sandboxed window. Refresh the snapshot and icon atlases with `apps/desktop/scripts/update-war-thunder-trees.py` (Python 3 and Pillow; use `--refresh-details` to bypass cached vehicle pages). The copilot is bundled as a desktop plugin and its tool registry is ready before renderer tool requests run. It can optionally sample a user-selected RWR crop from a single game-window video stream every 500 ms. It needs a quiet baseline; visual alerts appear on the pet even with chat hidden, and derived events feed the existing copilot. This heuristic cannot identify radar emitters or confirm lock state. Live game acceptance remains unverified.

## Providers

The registry has 21 IDs: 18 implemented adapters and three registered placeholders (`azure-openai`, `fireworks`, `xai-grok`) whose chat/stream methods throw. See [PROVIDERS.md](./PROVIDERS.md) for the exact catalog and [PROVIDER_SETUP.md](./PROVIDER_SETUP.md) for configuration. An implemented adapter does not guarantee live account/model availability.

## Development and verification

```sh
pnpm install
pnpm dev:desktop
pnpm dev:headless
pnpm test:headless
pnpm --filter syntax-senpai-desktop run typecheck
pnpm --filter syntax-senpai-desktop run test:unit
pnpm build
```

Run only the commands relevant to a change. A passing test, build, or headless fixture is not proof that a live AI provider, WeChat peer, mobile device, or Live2D display worked on physical hardware.
