# SyntaxSenpai - Implementation Plan Archive

**Last Updated**: 2026-06-03  
**Status**: Archived historical plan  
**Current Source Of Truth**: [`../../STATE.md`](../../STATE.md)

---

## Archive Note

This file used to track the original ground-up implementation plan for SyntaxSenpai. It is no longer an active checklist.

The project has moved beyond the early "Phase 1 - Core Infrastructure" plan that previously lived here. Current implementation status, known gaps, provider state, agent behavior, and development commands are maintained in [`../../STATE.md`](../../STATE.md). Provider details live in [`../../PROVIDERS.md`](../../PROVIDERS.md), and user setup details live in [`../../README.md`](../../README.md).

Older task counts from this document, such as "56+ completed tasks" or "Phase 1 80% complete", should be treated as historical context only.

## Current Project Snapshot

SyntaxSenpai is now a local-first Electron + Vue desktop assistant with character-driven waifu personalities, multi-provider chat, streaming, tool calling, persistent memory, affection tiers, custom waifus, skills, plugin tools, desktop settings, runtime ops, and QR-paired mobile companion support.

The active workspace includes:

- `apps/desktop` - Electron + Vue 3 + UnoCSS primary app.
- `apps/mobile` - Expo / React Native companion that pairs with desktop over QR/WebSocket.
- `apps/runtime` - runtime service for health, metrics, backups, and plugin routes.
- `packages/ai-core` - provider abstraction, retry/runtime helpers, trace, and planner support.
- `packages/waifu-core` - built-in waifus, prompt builders, sentiment, milestones, voice, skills, memory, and custom-waifu loading.
- `packages/storage` - chat and memory persistence helpers.
- `packages/ws-protocol` - desktop/mobile pairing protocol types.
- `packages/agent-tools` - shared tool registry and plugin primitives.
- `packages/wechat-ilink` - Tencent OpenClaw iLink integration.

## Implemented Surface

### Desktop Product

- Chat UI with streaming responses, token/cost counters, image attachments, Markdown export, regenerate/delete actions, and message windowing.
- Settings sidebar with General, AI, Data, Metrics, Theme, Interface, Plugins, Skills, Waifus, Live2D, Mobile, and WeChat tabs.
- Theme presets, density/radius/blur controls, tray icon, global shortcut, crash logging, and runtime telemetry.
- Custom waifu creation/import/delete through desktop IPC.

### Waifu System

- Five built-in personas: Aria, Sakura, Rei, Hana, and Luna.
- Persona prompts are built from waifu metadata, persistent memory, affection rules, telemetry, group-chat context, agent behavior rules, and coding-session context.
- Affection tiers, milestone toasts, per-waifu voice profiles, sentiment classification, mood pip, skills, and custom-waifu validation are implemented.

### Agent Modes And Tools

Agent execution modes are:

- `ask` - ask-before-running.
- `auto` - auto-edit.
- `full` - full access with minimal friction.

Renderer-side tools include terminal execution, file read/write/edit, web search, clipboard read/write, git status/diff, todos, Spotify control, WeChat peer/list send, plugin tool execution, affection updates, and response stopping.

Destructive shell patterns are still gated by native confirmation regardless of mode. Strict mode can route terminal execution through an allowlist executor with audit logging.

### Providers

The provider registry exposes 20 IDs:

- 18 live providers at the time: `anthropic`, `openai`, `openai-codex`, `gemini`, `mistral`, `cohere`, `groq`, `deepseek`, `perplexity`, `together`, `xai`, `xai-grok`, `huggingface`, `github-models`, `minimax-global`, `minimax-cn`, `ollama`, and `lmstudio`.
- 2 registered stubs at the time: `azure-openai` and `fireworks`.

`azure-openai` and `fireworks` currently throw "not yet fully implemented" from `chat()` and `stream()` and should be hidden or avoided until implemented.

Replicate and AWS Bedrock were removed from the registry and should not be reintroduced without real implementations.

## Active Gaps To Track Elsewhere

Do not add new active work items to this archived file. Track current implementation gaps in [`../../STATE.md`](../../STATE.md), PR descriptions, issues, or a new living roadmap document.

Known active caveats from the current state:

- `azure-openai` and `fireworks` remain registered provider stubs.
- `packages/agent-tools/src/builtin/*` contains shared built-ins that the desktop renderer does not currently import; desktop re-implements its own renderer-side tool definitions.

## Historical Context

The original plan described a three-phase build starting with monorepo setup, shared type packages, provider abstraction, storage, waifu roster, mobile setup, Electron setup, chat integration, and later agent tooling. That plan has been superseded by shipped implementation work documented in the root project files.

Use this archive only to understand how the project was originally scoped. Use [`../../STATE.md`](../../STATE.md) for what is true now.
