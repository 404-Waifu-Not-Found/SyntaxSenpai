# Changelog

All notable changes to SyntaxSenpai. See [STATE.md](./STATE.md) for the current-state snapshot; this file is the historical log.

Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is pre-1.0 so the versions below reflect PRs, not semver releases.

## Unreleased

### Added
- Parallel agent tool execution for independent terminal commands, file reads, searches, and fetches, capped at eight concurrent calls. Ask mode remains serial so approval prompts cannot deadlock the command queue.
- Batched duplicate browser-tab opening via `browser_tabs` `count`, avoiding repeated YouTube page waits and snapshots. Legacy flat plugin tool definitions are normalized during loading.
- Visible rounded AI browser cursor with smooth target tracking, click pulses, typing feedback, navigation state, and reduced-motion support.
- Documentation sweep aligned the live docs with the current registry: 21 provider IDs, 18 live providers, and 3 registered stubs (`azure-openai`, `fireworks`, `xai-grok`), plus NVIDIA NIM as a live hosted route.
- **Waifu-authored skills** — `create_skill`, `use_skill` agent tools. Skills are persisted as `SKILL.md` files under `<userData>/skills/<slug>/` with YAML frontmatter (`name`, `description`) and a markdown body. Each turn's system prompt lists available skills so the waifu knows when to invoke `use_skill` and pull the full content into context. Settings → Skills tab lists, previews, and deletes skills.
- **Waifu-proposed tools** — `propose_tool` agent tool. The waifu drafts a full JavaScript plugin bundle to `<userData>/pending-plugins/<slug>/` and must explicitly ask the user to approve it. Settings → Plugins gains a "Pending" section that shows the code, lets the user Approve (moves to active plugins directory) or Reject (deletes). The AI cannot activate its own tools.
- `CHANGELOG.md` + `.nvmrc` pinning Node 20.

## PR #13 — Integrate shipped-but-unwired work

### Fixed
- **Custom waifus now appear in the picker.** `customWaifus` merged into `allWaifus` in the chat store; `selectedWaifu` and 3 picker `v-for`s swap to the merged list; refreshes on mount + after import/delete so it works without restart.
- **Plugin tools actually reach the agent.** `loadToolPlugins()` now runs in main at startup; `plugins:listTools` + `plugins:execTool` IPC merges plugin definitions into the renderer's `getToolsForMode()`. Unknown tool names fall through to `plugins:execTool`.
- CI builds `@syntax-senpai/agent-tools` alongside the other desktop dependencies so vue-tsc can resolve its types.

## PR #12 — Round 2 features

### Added
- Plugins + Waifus settings tabs consuming `plugins:list / setDisabled` and `waifus:list/write/delete`.
- Affection-tier milestones (Stranger → Devoted) emit a toast + one-shot in-character prompt sidecar on crossing.
- Strict-mode sandbox — toggle in Settings → General delegates `terminal:exec` to the allowlisted executor with JSONL audit log.
- Message windowing — caps the default render to the last 200 messages with a paging button.
- A11y pass — skip-to-chat link, `role="dialog"` on Settings, `.sr-only` + `.skip-link` styles, +11 ARIA labels on icon-only buttons.

### Removed
- Stub providers Replicate and AWS Bedrock (always threw on invocation).

### Documentation
- Frozen status docs moved to `docs/archive/`; root kept only the living docs.

## PR #11 — Round 1 features & reliability

### Added
- CI workflow recurses `test:unit` across all packages; 78 new unit tests for `ai-core`, `storage`, `agent-tools`, `waifu-core`, and `logger`.
- `@syntax-senpai/logger` — zero-dep structured logger adopted in `apps/runtime` and desktop main.
- `ProviderError.hint` surfaces actionable error messages in the UI.
- Schema-versioned export / backup envelope with rejection for unknown versions.
- Per-waifu voice synthesis (Web Speech API) with tuned profiles per persona.
- Sentiment-driven mood pip on assistant avatars.
- Plugin system: reference plugins (`http-fetch`, `github-api`) + desktop `plugins:list / setDisabled` IPC.
- Community waifu loader (`loadCustomWaifus`) + desktop `waifus:list/write/delete` IPC.
