<p align="center">
  <img src="https://img.shields.io/badge/status-alpha-blueviolet?style=flat-square" alt="Status" />
  <img src="https://img.shields.io/github/license/404-Waifu-Not-Found/SyntaxSenpai?style=flat-square" alt="License" />
  <a href="https://github.com/404-Waifu-Not-Found/SyntaxSenpai/actions/workflows/ci.yml">
    <img src="https://github.com/404-Waifu-Not-Found/SyntaxSenpai/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
</p>

<h1 align="center">SyntaxSenpai</h1>

<p align="center">
  <strong>AI-powered waifu companion for developers</strong><br/>
  Choose a waifu. Chat in character. Let her become your coding agent.
</p>

---

An AI-powered companion app where users pick a personalized "waifu" through a dating-style interface. Each waifu has a unique personality, tone, and communication style. Once matched, the waifu becomes an intelligent assistant that lives on your device (desktop or mobile), capable of executing real tasks — from writing code and managing files to automating workflows.

Every interaction is delivered in-character, blending emotional engagement with real productivity.

> **Current status:** see [STATE.md](./STATE.md) for an accurate snapshot of what's built. Earlier status documents have been moved to [`docs/archive/`](./docs/archive/) for historical reference only.

## Features

- **20 AI providers registered, 18 live** — Anthropic, OpenAI, OpenAI Codex, Gemini, Mistral, Cohere, Groq, DeepSeek, Perplexity, Together, xAI (2 endpoints), Hugging Face, GitHub Models, MiniMax (global + CN), Ollama, LM Studio. Azure OpenAI and Fireworks are registered but currently throw "not yet fully implemented" (see [STATE.md](./STATE.md))
- **Waifu personalities** — distinct characters with unique tones and backstories
- **Agent modes** — ask / auto / full; plan-and-verify workflow with iteration-budget feedback
- **Agent tools** — terminal (with destructive-pattern gating), read/write/edit_file, clipboard, git_status / git_diff, web_search, todo_write, Spotify
- **Affection system** — relationship meter that evolves with conversation
- **AI memory** — persistent memory across all chats
- **Theming** — 17 presets including live rainbow hue-cycle and sakura-petals overlay
- **Chat niceties** — image attachments (paste / drop / paperclip), token + cost counter, per-message regenerate/delete, Markdown export, keyboard shortcuts, tray icon + global shortcut
- **Desktop & mobile** — Electron desktop app with QR pairing to React Native mobile
- **Runtime ops** — health probes, Prometheus metrics, Grafana dashboards, container builds, and Kubernetes manifests
- **Backups** — export and restore chat + memory snapshots from the runtime API
- **Plugin system** — manifest-based tool plugins for extending agent capabilities

## Architecture

```
syntax-senpai/
├── apps/
│   ├── desktop/          # Electron + Vite desktop application
│   ├── mobile/           # React Native mobile app (Expo)
│   └── runtime/          # Node.js runtime service for health, metrics, backups, plugins
├── packages/
│   ├── ai-core/          # AI provider abstraction (Anthropic, OpenAI, DeepSeek, etc.)
│   ├── waifu-core/       # Waifu personalities, system prompts, expressions
│   ├── agent-tools/      # Tool execution framework for agents
│   ├── storage/          # Persistent storage layer
│   ├── ui/               # Shared UI components and styles
│   ├── ui-transitions/   # Reusable transition components
│   ├── ui-loading-screens/ # Loading screen components
│   └── ws-protocol/      # WebSocket protocol definitions
├── ops/                  # Prometheus & Grafana configuration
├── plugins/              # External tool plugins directory
└── docker-compose.yml    # Local dev environment setup
```

## Quickstart

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 8

### Setup

```bash
# Clone the repository
git clone https://github.com/404-Waifu-Not-Found/SyntaxSenpai.git
cd SyntaxSenpai

# Install dependencies
pnpm install

# Run the desktop app in dev mode
pnpm dev:desktop

# Or quick-start (skips full turbo pipeline)
pnpm desktop:quick
```

API keys are configured in-app through the Settings panel — no `.env` file required for basic usage.

### Scripts

| Command | Description |
|---|---|
| `pnpm dev:desktop` | Start the desktop app in dev mode |
| `pnpm dev:mobile` | Start the mobile app in dev mode |
| `pnpm dev:runtime` | Start the runtime service locally |
| `pnpm build` | Build all workspaces |
| `pnpm test` | Run tests |
| `pnpm lint` | Run linters |
| `pnpm typecheck` | TypeScript type checks |
| `pnpm docker:build` | Build the runtime container image |
| `pnpm docker:up` | Start runtime + Prometheus + Grafana |
| `pnpm clean` | Remove all build artifacts and node_modules |

## Operations

The runtime service exposes:

- `/healthz` for liveness checks
- `/readyz` for readiness checks
- `/metrics` for Prometheus scraping
- `/api/v1/backups/*` for chat and memory backup management
- `/api/v1/plugins` for plugin discovery

See [ops/README.md](ops/README.md) for Docker, monitoring, backup, plugin, and Kubernetes usage.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, guidelines, and pull request process.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE) — see the LICENSE file for details.
