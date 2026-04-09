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

## Features

- **Multi-provider AI** — Anthropic, OpenAI, DeepSeek, Gemini, Mistral, Groq, xAI, MiniMax, Hugging Face, GitHub Models
- **Waifu personalities** — distinct characters with unique tones and backstories
- **Agent modes** — ask-before-running, auto-edit, or full-access
- **Affection system** — relationship meter that evolves with conversation
- **AI memory** — persistent memory across all chats
- **Theming** — full color customization with rainbow mode
- **Desktop & mobile** — Electron desktop app and mobile target

## Architecture

```
syntax-senpai/
├── apps/
│   ├── desktop/          # Electron + Vue 3 + Vite
│   └── mobile/           # Mobile target
├── packages/
│   ├── ai-core/          # Provider adapters & chat logic
│   ├── waifu-core/       # Waifu definitions & personalities
│   ├── agent-tools/      # Tool execution for agent mode
│   ├── storage/          # Persistent storage layer
│   ├── ui/               # Shared UI styles
│   ├── ui-transitions/   # Reusable Vue transition components
│   ├── ui-loading-screens/ # Loading screen components
│   └── ws-protocol/      # WebSocket protocol definitions
└── ...
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
| `pnpm build` | Build all workspaces |
| `pnpm test` | Run tests |
| `pnpm lint` | Run linters |
| `pnpm typecheck` | TypeScript type checks |
| `pnpm clean` | Remove all build artifacts and node_modules |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, guidelines, and pull request process.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE) — see the LICENSE file for details.
