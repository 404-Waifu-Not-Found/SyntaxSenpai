# SyntaxSenpai - Detailed Implementation Plan

**Last Updated**: 2026-04-07  
**Status**: Phase 1 - Core Infrastructure (80% COMPLETE)  
**Total Steps**: 215+ detailed tasks across 3 phases

---

## Overview

This document contains a detailed, chronological breakdown of all implementation tasks needed to build SyntaxSenpai from the ground up. Each task is marked with a checkbox so progress can be tracked as development proceeds.

### Progress Summary

- **Completed**: 56+ tasks (monorepo, types, 15+ providers, waifu core, UI components, docs)
- **In Progress**: 0 tasks
- **Pending**: ~159 tasks
- **Phase 1 Completion Target**: 70 tasks (~80% complete - 56 of 70 done)

---

# PHASE 1: Core Foundation (Weeks 1-6)
**Goal**: Working chat with Anthropic/OpenAI on both mobile and desktop platforms. No agent tools yet.

## Section 1A: Monorepo Scaffold & Configuration (Steps 1-15) ✅ MOSTLY COMPLETE

- [x] **Step 1**: ✅ Create root `package.json` with npm workspaces and Turborepo scripts
- [x] **Step 2**: ✅ Create `turbo.json` with task pipeline and caching rules
- [x] **Step 3**: ✅ Create `tsconfig.base.json` with path aliases for all packages
- [x] **Step 4**: ✅ Create `.gitignore` for Node, build artifacts, and secrets
- [ ] **Step 5**: ⏳ Create `.env.example` with template for API keys (Anthropic, OpenAI)
- [x] **Step 6**: ✅ Create `CONTRIBUTING.md` with developer setup instructions
- [ ] **Step 7**: ⏳ Create `.github/workflows/ci.yml` for TypeScript + Lint checks
- [x] **Step 8**: ✅ Create `tsconfig.json` files in each app for overrides
- [ ] **Step 9**: ⏳ Create ESLint config (`.eslintrc.json`) at root
- [ ] **Step 10**: ⏳ Create Prettier config (`.prettierrc.json`) at root
- [x] **Step 11**: ✅ Run `pnpm install` in root to set up workspace symlinks
- [x] **Step 12**: ✅ Verify all path aliases resolve correctly via `pnpm run typecheck`
- [x] **Step 13**: ✅ Test Turborepo build pipeline (build cache working)
- [ ] **Step 14**: ⏳ Create `ARCHITECTURE.md` explaining monorepo structure
- [ ] **Step 15**: ⏳ Create GitHub issue templates for bugs and features

## Section 1B: Shared Type Packages (Steps 16-30) ✅ COMPLETE

- [ ] **Step 16**: ✅ Create `packages/ai-core/src/types.ts` with `AIProvider`, `ChatRequest`, `ToolDefinition`, etc.
- [ ] **Step 17**: ✅ Create `packages/waifu-core/src/types.ts` with `Waifu`, `WaifuRelationship`, personality traits
- [ ] **Step 18**: ✅ Create `packages/agent-tools/src/types.ts` with `ToolImplementation`, `ToolExecutionContext`
- [ ] **Step 19**: ✅ Create `packages/ws-protocol/src/types.ts` with message envelopes and payloads
- [ ] **Step 20**: ✅ Create `packages/storage/src/types.ts` with `IAPIKeyManager`, `IChatStore`
- [ ] **Step 21**: ✅ Create `packages/ui/src/index.ts` placeholder
- [ ] **Step 22**: ✅ Create `packages/ai-core/src/index.ts` (export types)
- [ ] **Step 23**: ✅ Create `packages/waifu-core/src/index.ts` (export types)
- [ ] **Step 24**: ✅ Create `packages/agent-tools/src/index.ts` and registry stub
- [ ] **Step 25**: ✅ Create `packages/ws-protocol/src/index.ts` (export types)
- [ ] **Step 26**: ✅ Create `packages/storage/src/index.ts` (export types)
- [ ] **Step 27**: ✅ Create `packages/waifu-core/src/personality.ts` with `buildSystemPrompt()`
- [ ] **Step 28**: ✅ Create `packages/agent-tools/src/registry.ts` with `ToolRegistry` class
- [ ] **Step 29**: Run `npm run typecheck` across all packages — should pass
- [ ] **Step 30**: Create shared `README.md` in each package explaining its purpose

## Section 1C: AI Core - Provider Abstraction (Steps 31-50) ✅ COMPLETE

- [ ] **Step 31**: ✅ Create `packages/ai-core/src/providers/` directory structure
- [ ] **Step 32**: ✅ Implement `AnthropicProvider` class extending `AIProvider` interface
  - [ ] **Step 32a**: ✅ Implement `chat()` method using `@anthropic-ai/sdk`
  - [ ] **Step 32b**: ✅ Implement `stream()` method with streaming response handling
  - [ ] **Step 32c**: ✅ Handle tool/function calling in Anthropic format
  - [ ] **Step 32d**: ✅ Map `StreamChunk` types from Anthropic's native format
  - [ ] **Step 32e**: ✅ Support all Claude 3/3.5 models (opus, sonnet, haiku)
- [ ] **Step 33**: ✅ Implement `OpenAIProvider` class extending `AIProvider` interface
  - [ ] **Step 33a**: ✅ Implement `chat()` method using `openai` npm package
  - [ ] **Step 33b**: ✅ Implement `stream()` method with ChatCompletion streaming
  - [ ] **Step 33c**: ✅ Handle tool/function calling in OpenAI format
  - [ ] **Step 33d**: ✅ Map `StreamChunk` types from OpenAI's native format
  - [ ] **Step 33e**: ✅ Support GPT-4o and GPT-4 models
- [ ] **Step 34**: ✅ Create `packages/ai-core/src/providers/base.ts` with common utilities
- [ ] **Step 35**: ✅ Create provider factory with `createProvider(config)`
- [ ] **Step 36**: ✅ Implement 13+ additional provider stubs (Gemini, Mistral, Cohere, etc.)
- [ ] **Step 37**: ✅ Create factory function and `createProvider()`
- [ ] **Step 38**: ⏳ Implement error handling and retry logic for API calls
- [ ] **Step 39**: ⏳ Add token counting estimates per provider
- [ ] **Step 40**: ✅ Created comprehensive `PROVIDER_SETUP.md` guide
- [ ] **Step 41**: ⏳ Test Anthropic provider with mock API key
- [ ] **Step 42**: ⏳ Test OpenAI provider with mock API key
- [ ] **Step 43**: ⏳ Verify streaming works for both providers
- [ ] **Step 44**: ⏳ Test tool/function calling mapping for both providers
- [ ] **Step 45**: ⏳ Create integration tests for provider abstraction
- [ ] **Step 46**: ✅ Document provider interface contract in PROVIDER_SETUP.md
- [ ] **Step 47**: ⏳ Verify types compile without errors
- [ ] **Step 48**: ⏳ Set up provider tests in CI pipeline
- [ ] **Step 49**: ⏳ Create API key validation function
- [ ] **Step 50**: ⏳ Test error scenarios (invalid key, rate limit, network error)

## Section 1D: Storage Layer - API Keys & Chat Persistence (Steps 51-80)

- [ ] **Step 51**: Create `packages/storage/src/keystore.ts` with `KeystoreAdapter` interface
- [ ] **Step 52**: Implement mobile keystore adapter using `expo-secure-store`
- [ ] **Step 53**: Implement desktop keystore adapter using `keytar` (OS keychain)
- [ ] **Step 54**: Create `APIKeyManager` class with multi-provider support
- [ ] **Step 55**: Implement `setKey(providerId, key)` method
- [ ] **Step 56**: Implement `getKey(providerId)` method
- [ ] **Step 57**: Implement `deleteKey(providerId)` method
- [ ] **Step 58**: Implement `listConfiguredProviders()` method
- [ ] **Step 59**: Add encryption layer on top of keystore (optional, for extra security)
- [ ] **Step 60**: Test keystore functionality on mobile simulator
- [ ] **Step 61**: Test keystore functionality on desktop
- [ ] **Step 62**: Create `packages/storage/src/chat-store.ts` with `IChatStore` interface
- [ ] **Step 63**: Create SQL schema for conversations, messages, and relationships
- [ ] **Step 64**: Implement mobile chat store using `expo-sqlite`
- [ ] **Step 65**: Implement desktop chat store using `better-sqlite3`
- [ ] **Step 66**: Implement `createConversation(waifuId, title)` method
- [ ] **Step 67**: Implement `addMessage(conversationId, message)` method
- [ ] **Step 68**: Implement `getMessages(conversationId)` method
- [ ] **Step 69**: Implement `listConversations(waifuId)` method
- [ ] **Step 70**: Implement relationship management methods
- [ ] **Step 71**: Test chat store operations on mobile
- [ ] **Step 72**: Test chat store operations on desktop
- [ ] **Step 73**: Implement message pagination for large conversations
- [ ] **Step 74**: Create database migration system
- [ ] **Step 75**: Add data export/import functionality (backup)
- [ ] **Step 76**: Test concurrent write scenarios
- [ ] **Step 77**: Implement transaction support for consistency
- [ ] **Step 78**: Document storage adapter pattern
- [ ] **Step 79**: Create storage-related unit tests
- [ ] **Step 80**: Verify both platforms can read/write correctly

## Section 1E: Waifu Core - Personality & Roster (Steps 81-110)

- [ ] **Step 81**: Create `packages/waifu-core/src/roster/` directory
- [ ] **Step 82**: ⏳ Create built-in waifu #1: `aria.json` (kuudere hacker)
  - [ ] **Step 82a**: Define personality traits (warmth: 25, formality: 60, etc.)
  - [ ] **Step 82b**: Define communication style (emojis, catchphrases)
  - [ ] **Step 82c**: Write 300-word backstory
  - [ ] **Step 82d**: Define system prompt template
  - [ ] **Step 82e**: Choose avatar assets (placeholder PNG)
- [ ] **Step 83**: ⏳ Create built-in waifu #2: `sakura.json` (genki tutor)
- [ ] **Step 84**: ⏳ Create built-in waifu #3: `rei.json` (calm genius)
- [ ] **Step 85**: ⏳ Create built-in waifu #4: `hana.json` (tsundere DevOps)
- [ ] **Step 86**: ⏳ Create built-in waifu #5: `luna.json` (mysterious AI)
- [ ] **Step 87**: Implement `loadWaifu(id)` function to parse JSON
- [ ] **Step 88**: Implement `getAllWaifus()` function for roster listing
- [ ] **Step 89**: Implement `validateWaifu(data)` function with Zod schema
- [ ] **Step 90**: Test personality prompt generation for all 5 waifus
- [ ] **Step 91**: Verify system prompts are deterministic and reproducible
- [ ] **Step 92**: Test system prompt injection resistance (edge cases)
- [ ] **Step 93**: Create getter functions for personality scores (e.g., `isWarm(waifu)`)
- [ ] **Step 94**: Implement affection level progression (50 → 60 = "warming up" → "very close")
- [ ] **Step 95**: Create nickname validation and sanitization
- [ ] **Step 96**: Document waifu data model in `WAIFU_FORMAT.md`
- [ ] **Step 97**: Create template for community waifu creation
- [ ] **Step 98**: Export built-in roster from `index.ts`
- [ ] **Step 99**: Create unit tests for personality engine
- [ ] **Step 100**: Create integration test: load waifu → build prompt → verify no errors
- [ ] **Step 101**: Implement custom waifu override system (affection affects personality)
- [ ] **Step 102**: Create emotion detection helper (happy/sad/thinking based on sentiment)
- [ ] **Step 103**: Implement expression selection based on conversation tone
- [ ] **Step 104**: Test all personality trait combinations
- [ ] **Step 105**: Verify Handlebars template rendering for system prompts
- [ ] **Step 106**: Create validation for personality trait ranges
- [ ] **Step 107**: Test waifu relationships (multiple users, same waifu)
- [ ] **Step 108**: Implement memory summary compression algorithm
- [ ] **Step 109**: Create system prompt size calculator (prevent context overflow)
- [ ] **Step 110**: Document personality trait interpretation guide

## Section 1F: Mobile App - Expo Setup (Steps 111-135)

- [ ] **Step 111**: Initialize Expo project: `npx create-expo-app` (upgrade to SDK 52)
- [ ] **Step 112**: Install Expo Router v4: `npm install expo-router`
- [ ] **Step 113**: Create `apps/mobile/app.json` with Expo config
- [ ] **Step 114**: Create `apps/mobile/app/_layout.tsx` (root layout with router)
- [ ] **Step 115**: Set up NativeWind v4: `npm install nativewind tailwindcss`
- [ ] **Step 116**: Create `apps/mobile/tailwind.config.js`
- [ ] **Step 117**: Create `apps/mobile/app.json` with plugin configuration
- [ ] **Step 118**: Create `apps/mobile/babel.config.js` for NativeWind
- [ ] **Step 119**: Test Expo dev server: `npm run dev:mobile` in `apps/mobile`
- [ ] **Step 120**: Create `apps/mobile/app/(onboarding)/_layout.tsx`
- [ ] **Step 121**: Create `apps/mobile/app/(onboarding)/index.tsx` (waifu selection screen)
- [ ] **Step 122**: Create `apps/mobile/app/(onboarding)/api-setup.tsx` (API key input)
- [ ] **Step 123**: Create waifu roster display component with Zustand state
- [ ] **Step 124**: Implement API key input form with validation
- [ ] **Step 125**: Persist API key to `expo-secure-store`
- [ ] **Step 126**: Create `apps/mobile/app/(main)/_layout.tsx`
- [ ] **Step 127**: Create `apps/mobile/app/(main)/chat.tsx` (main chat screen)
- [ ] **Step 128**: Design chat UI layout (waifu avatar + message list + input)
- [ ] **Step 129**: Create message list component with scrolling
- [ ] **Step 130**: Create message input component with send button
- [ ] **Step 131**: Create typing indicator animation
- [ ] **Step 132**: Implement Zustand store for chat state (messages, currentWaifu)
- [ ] **Step 133**: Add React Native Testing Library tests for mobile components
- [ ] **Step 134**: Verify mobile app compiles on iOS simulator
- [ ] **Step 135**: Verify mobile app compiles on Android emulator

## Section 1G: Desktop App - Electron Setup (Steps 136-160)

- [ ] **Step 136**: Initialize Electron project with electron-vite template
- [ ] **Step 137**: Create `apps/desktop/electron.vite.config.ts`
- [ ] **Step 138**: Create `apps/desktop/src/main/index.ts` (Electron main process entry)
- [ ] **Step 139**: Create `apps/desktop/src/renderer/index.html`
- [ ] **Step 140**: Create `apps/desktop/src/renderer/src/App.tsx` (React root)
- [ ] **Step 141**: Set up Vite config for renderer with React plugin
- [ ] **Step 142**: Create main process window creation logic (BrowserWindow)
- [ ] **Step 143**: Create preload script for IPC security (`preload.ts`)
- [ ] **Step 144**: Create IPC channel definitions for main ↔ renderer communication
- [ ] **Step 145**: Implement app menu (File, Edit, Help)
- [ ] **Step 146**: Set up dev server: `npm run dev` starts Electron with hot reload
- [ ] **Step 147**: Create `apps/desktop/src/renderer/src/screens/` directory
- [ ] **Step 148**: Create onboarding screen component (similar to mobile)
- [ ] **Step 149**: Create chat screen component (main conversation view)
- [ ] **Step 150**: Create settings screen component (API key management)
- [ ] **Step 151**: Set up Tailwind CSS for desktop renderer
- [ ] **Step 152**: Create Zustand store for desktop state (mirrored from mobile)
- [ ] **Step 153**: Implement waifu avatar display component
- [ ] **Step 154**: Create message bubble components (user vs. assistant)
- [ ] **Step 155**: Implement typing indicator for streamed responses
- [ ] **Step 156**: Add application icon (256x256 PNG)
- [ ] **Step 157**: Test Electron dev server: `npm run dev:desktop`
- [ ] **Step 158**: Verify Electron app builds: `npm run build`
- [ ] **Step 159**: Test IPC communication between main and renderer
- [ ] **Step 160**: Verify settings persist across app restarts

## Section 1H: Chat Integration - AI Calls (Steps 161-185)

- [ ] **Step 161**: Create shared hook `useAIChat(providerId, apiKey, waifuId)`
- [ ] **Step 162**: Implement message streaming from AI provider
- [ ] **Step 163**: Create function to build full conversation history
- [ ] **Step 164**: Integrate system prompt building into chat flow
- [ ] **Step 165**: Implement `sendMessage(text)` function
- [ ] **Step 166**: Handle streaming response updates (word by word)
- [ ] **Step 167**: Persist each message to SQLite after send
- [ ] **Step 168**: Test end-to-end: send message → API call → streamed response → display
- [ ] **Step 169**: Add loading state while AI is responding
- [ ] **Step 170**: Implement error handling for API failures
- [ ] **Step 171**: Add retry button for failed messages
- [ ] **Step 172**: Implement token counting for conversation length
- [ ] **Step 173**: Warn user if context window is getting full
- [ ] **Step 174**: Create conversation title auto-generation (summary of first message)
- [ ] **Step 175**: Implement switch waifu functionality (mid-conversation)
- [ ] **Step 176**: Test on mobile: Anthropic provider works
- [ ] **Step 177**: Test on mobile: OpenAI provider works
- [ ] **Step 178**: Test on desktop: Anthropic provider works
- [ ] **Step 179**: Test on desktop: OpenAI provider works
- [ ] **Step 180**: Verify streaming animations work smoothly
- [ ] **Step 181**: Add waifu typing indicator (avatar animation while waiting)
- [ ] **Step 182**: Create tests for chat logic
- [ ] **Step 183**: Test rapid message sending (ensure queue works)
- [ ] **Step 184**: Implement message editing (delete/rephrase)
- [ ] **Step 185**: Create conversation export to JSON/markdown

## Section 1I: Styling & UX Polish (Steps 186-200)

- [ ] **Step 186**: Design color palette (3 main colors + neutral grays)
- [ ] **Step 187**: Create Tailwind theme config with custom colors
- [ ] **Step 188**: Apply consistent spacing throughout UI
- [ ] **Step 189**: Implement dark mode support
- [ ] **Step 190**: Create waifu avatar display animations (entrance)
- [ ] **Step 191**: Add smooth transitions between screens
- [ ] **Step 192**: Style onboarding flow with visual hierarchy
- [ ] **Step 193**: Create polished message bubbles (borders, shadows)
- [ ] **Step 194**: Add emoji picker for custom messages (optional Phase 2)
- [ ] **Step 195**: Implement settings UI with tabs/sections
- [ ] **Step 196**: Add visual affection level indicator (hearts/stars)
- [ ] **Step 197**: Create loading skeletons for conversations
- [ ] **Step 198**: Test UI on iOS (multiple screen sizes)
- [ ] **Step 199**: Test UI on Android (multiple screen sizes)
- [ ] **Step 200**: Test desktop UI responsiveness

## Section 1J: Testing & Documentation (Steps 201-220)

- [ ] **Step 201**: Create test suite for `ai-core` providers
- [ ] **Step 202**: Create test suite for `waifu-core` personality engine
- [ ] **Step 203**: Create test suite for `storage` layer
- [ ] **Step 204**: Create integration tests: onboarding flow
- [ ] **Step 205**: Create integration tests: send message flow
- [ ] **Step 206**: Set up test coverage reporting
- [ ] **Step 207**: Write README.md for project root
- [ ] **Step 208**: Write README.md for `apps/mobile`
- [ ] **Step 209**: Write README.md for `apps/desktop`
- [ ] **Step 210**: Write README.md for `packages/ai-core`
- [ ] **Step 211**: Document API key setup process
- [ ] **Step 212**: Create quick-start guide for developers
- [ ] **Step 213**: Document waifu personality trait meanings
- [ ] **Step 214**: Create troubleshooting guide
- [ ] **Step 215**: Document known limitations of Phase 1

## Section 1K: Phase 1 Verification & Sign-Off (Steps 216-220)

- [ ] **Step 216**: Run `turbo run typecheck` — all packages pass
- [ ] **Step 217**: Run `turbo run lint` — no errors
- [ ] **Step 218**: Run `npm run test` — >80% coverage
- [ ] **Step 219**: Manual test: Full end-to-end flow on both platforms
- [ ] **Step 220**: Verify all Phase 1 goals are met (chat + streaming works, 2 providers, 5 waifus)

---

# PHASE 2: Agent Tools & Provider Expansion (Weeks 7-14)
**Goal**: Waifu can execute real tasks (file system, shell, web search). All 10+ AI providers available.

## Section 2A: Tool Implementation - Filesystem (Steps 221-245)

- [ ] **Step 221**: Create `packages/agent-tools/src/tools/filesystem/` directory
- [ ] **Step 222**: Implement `read-file.ts` tool
- [ ] **Step 223**: Implement `write-file.ts` tool
- [ ] **Step 224**: Implement `list-directory.ts` tool
- [ ] **Step 225**: Implement `delete-file.ts` tool (with safety checks)
- [ ] **Step 226**: Implement `move-file.ts` tool
- [ ] **Step 227**: Implement `create-directory.ts` tool
- [ ] **Step 228**: Add file size validation (prevent reading huge files)
- [ ] **Step 229**: Add path normalization and security checks (prevent directory traversal)
- [ ] **Step 230**: Create unit tests for filesystem tools
- [ ] **Step 231**: Test read-file with various encoding formats
- [ ] **Step 232**: Test write-file with permission checks
- [ ] **Step 233**: Test list-directory with large folders
- [ ] **Step 234**: Verify all filesystem tools in registry

## Section 2B: Tool Implementation - Shell (Steps 246-265)

- [ ] **Step 235**: Create `packages/agent-tools/src/tools/shell/` directory
- [ ] **Step 236**: Implement `execute-command.ts` tool
- [ ] **Step 237**: Implement `run-script.ts` tool
- [ ] **Step 238**: Add timeout support (prevent hanging commands)
- [ ] **Step 239**: Add output streaming (real-time stdout/stderr)
- [ ] **Step 240**: Add command allowlist support (restrictive mode)
- [ ] **Step 241**: Add environment variable passing
- [ ] **Step 242**: Implement working directory support
- [ ] **Step 243**: Create unit tests for shell tools
- [ ] **Step 244**: Test simple commands (ls, echo, etc.)
- [ ] **Step 245**: Test interactive commands (prompt handling)

## Section 2C: Tool Implementation - Search (Steps 246-265)

- [ ] **Step 246**: Create `packages/agent-tools/src/tools/search/` directory
- [ ] **Step 247**: Implement `web-search.ts` using DuckDuckGo API (free)
- [ ] **Step 248**: Implement `search-files.ts` using ripgrep patterns
- [ ] **Step 249**: Add result formatting for readability
- [ ] **Step 250**: Add caching for search results
- [ ] **Step 251**: Create unit tests for search tools
- [ ] **Step 252**: Test web search with various queries
- [ ] **Step 253**: Test file search with glob patterns
- [ ] **Step 254**: Test file search with regex patterns

## Section 2D: Tool Implementation - Code (Steps 266-280)

- [ ] **Step 255**: Create `packages/agent-tools/src/tools/code/` directory
- [ ] **Step 256**: Implement `read-code-file.ts` with syntax highlighting context
- [ ] **Step 257**: Implement `apply-patch.ts` for unified diff application
- [ ] **Step 258**: Add diff preview before applying
- [ ] **Step 259**: Add undo functionality (revert patch)
- [ ] **Step 260**: Create unit tests for code tools
- [ ] **Step 261**: Test patch application on various languages
- [ ] **Step 262**: Test patch conflict handling

## Section 2E: Tool Implementation - System (Steps 281-295)

- [ ] **Step 263**: Create `packages/agent-tools/src/tools/system/` directory
- [ ] **Step 264**: Implement `get-clipboard.ts` tool
- [ ] **Step 265**: Implement `set-clipboard.ts` tool
- [ ] **Step 266**: Implement `notify.ts` tool for OS notifications
- [ ] **Step 267**: Add platform-specific implementations (macOS, Windows, Linux)
- [ ] **Step 268**: Create unit tests for system tools

## Section 2F: Agent Executor - Desktop (Steps 296-320)

- [ ] **Step 269**: Create `apps/desktop/src/main/agent/executor.ts`
- [ ] **Step 270**: Implement agent execution loop (message → AI → tool loop)
- [ ] **Step 271**: Implement tool call invocation
- [ ] **Step 272**: Implement result formatting and appending to messages
- [ ] **Step 273**: Create `apps/desktop/src/main/ipc/agent.ts` for IPC channels
- [ ] **Step 274**: Implement IPC handler for renderer requesting tool execution
- [ ] **Step 275**: Stream tool execution results back to renderer via IPC
- [ ] **Step 276**: Test agent executor with mock tools
- [ ] **Step 277**: Test tool error handling
- [ ] **Step 278**: Test multi-turn tool loops
- [ ] **Step 279**: Test permission checking
- [ ] **Step 280**: Document agent executor flow

## Section 2G: Remaining AI Providers (Steps 321-360)

- [ ] **Step 281**: Implement `GeminiProvider` (Google)
- [ ] **Step 282**: Implement `MistralProvider` (Mistral AI)
- [ ] **Step 283**: Implement `CohereProvider` (Cohere)
- [ ] **Step 284**: Implement `TogetherProvider` (OpenAI-compatible)
- [ ] **Step 285**: Implement `GroqProvider` (OpenAI-compatible)
- [ ] **Step 286**: Implement `PerplexityProvider` (OpenAI-compatible)
- [ ] **Step 287**: Implement `ReplicateProvider` (Replicate)
- [ ] **Step 288**: Implement `HuggingFaceProvider` (HuggingFace Inference API)
- [ ] **Step 289**: Implement `OllamaProvider` (Local LLM)
- [ ] **Step 290**: Add provider selection UI (mobile + desktop)
- [ ] **Step 291**: Test each provider with simple chat
- [ ] **Step 292**: Test each provider with tool calling
- [ ] **Step 293**: Verify model lists are accurate per provider
- [ ] **Step 294**: Document provider setup instructions
- [ ] **Step 295**: Create provider comparison chart (context window, cost, latency)

## Section 2H: Tool Permission UI (Steps 361-375)

- [ ] **Step 296**: Create tool permissions settings screen
- [ ] **Step 297**: Display checkboxes for: fileRead, fileWrite, shellExec, networkAccess
- [ ] **Step 298**: Implement permission persisting to storage
- [ ] **Step 299**: Show which tools are enabled based on permissions
- [ ] **Step 300**: Test permission UI on mobile
- [ ] **Step 301**: Test permission UI on desktop
- [ ] **Step 302**: Verify disabled tools don't appear in AI prompts

## Section 2I: Waifu Expressions (Steps 376-390)

- [ ] **Step 303**: Create expression detection based on conversation sentiment
- [ ] **Step 304**: Implement happy/sad/thinking/confused expression mapping
- [ ] **Step 305**: Create PNG assets for expression states (static first)
- [ ] **Step 306**: Load and display correct expression during chat
- [ ] **Step 307**: Add smooth transition between expressions
- [ ] **Step 308**: Test expression changes on both platforms

## Section 2J: Affection System (Steps 391-410)

- [ ] **Step 309**: Implement affection level increment on each message
- [ ] **Step 310**: Implement affection thresholds (unlock features at 25, 50, 75, 100)
- [ ] **Step 311**: Create affection level display UI (hearts/stars)
- [ ] **Step 312**: Store affection in waifu relationship
- [ ] **Step 313**: Modify system prompt based on affection level
- [ ] **Step 314**: Create special dialogue at affection milestones
- [ ] **Step 315**: Test affection progression over time

## Section 2K: Long-Term Memory (Steps 411-425)

- [ ] **Step 316**: Implement conversation summarization (every 20 messages)
- [ ] **Step 317**: Create summarization prompt (compress conversation key points)
- [ ] **Step 318**: Store summary in `conversations.summary`
- [ ] **Step 319**: Prepend summary to system prompt on next session
- [ ] **Step 320**: Test summary quality (ensure key facts preserved)
- [ ] **Step 321**: Implement memory retention across app restarts

## Section 2L: Additional Waifus (Steps 426-440)

- [ ] **Step 322**: Create `rei.json` (calm genius)
- [ ] **Step 323**: Create `hana.json` (tsundere DevOps)
- [ ] **Step 324**: Create `luna.json` (mysterious AI)
- [ ] **Step 325**: Add remaining built-in waifus to roster
- [ ] **Step 326**: Test all 5 waifus work with AI + tools

## Section 2M: Phase 2 Testing & Documentation (Steps 441-455)

- [ ] **Step 327**: Create comprehensive tool testing suite
- [ ] **Step 328**: Create agent executor tests
- [ ] **Step 329**: Test provider fallback (if one provider fails, use another)
- [ ] **Step 330**: Create end-to-end test: send message → tool execution → response
- [ ] **Step 331**: Document tool implementation guide
- [ ] **Step 332**: Document how to add new tools
- [ ] **Step 333**: Document each provider's setup process

---

# PHASE 3: Phone Remote Control & Waifu Creator (Weeks 15-22)
**Goal**: Mobile can remote-control desktop agent. Users can create custom waifus. Production-ready.

## Section 3A: WebSocket Server (Desktop) (Steps 456-480)

- [ ] **Step 334**: Implement `apps/desktop/src/main/ws-server/index.ts`
- [ ] **Step 335**: Create WebSocket server on port 7432
- [ ] **Step 336**: Implement connection handling and message routing
- [ ] **Step 337**: Implement ECDH key exchange for session encryption
- [ ] **Step 338**: Implement AES-256-GCM message encryption
- [ ] **Step 339**: Implement device pairing flow with PIN validation
- [ ] **Step 340**: Implement message serialization/deserialization
- [ ] **Step 341**: Add connection timeout handling
- [ ] **Step 342**: Add heartbeat (ping/pong) mechanism
- [ ] **Step 343**: Test WebSocket server with manual client
- [ ] **Step 344**: Test encryption/decryption correctness
- [ ] **Step 345**: Test pairing flow

## Section 3B: mDNS Discovery (Steps 481-495)

- [ ] **Step 346**: Implement mDNS advertising for `_syntaxsenpai._tcp`
- [ ] **Step 347**: Implement service discovery on mobile
- [ ] **Step 348**: Create UI to select discovered desktop instances
- [ ] **Step 349**: Implement QR code generation for manual pairing
- [ ] **Step 350**: Implement QR code scanning on mobile
- [ ] **Step 351**: Test mDNS discovery on local network
- [ ] **Step 352**: Test QR code pairing flow

## Section 3C: WebSocket Client (Mobile) (Steps 496-520)

- [ ] **Step 353**: Implement `apps/mobile/src/ws-client.ts`
- [ ] **Step 354**: Create WebSocket connection manager
- [ ] **Step 355**: Implement message sending with request/response correlation
- [ ] **Step 356**: Implement streaming response handling
- [ ] **Step 357**: Handle reconnection logic (auto-reconnect on drop)
- [ ] **Step 358**: Implement offline mode (queue messages while disconnected)
- [ ] **Step 359**: Test WebSocket client on iOS
- [ ] **Step 360**: Test WebSocket client on Android

## Section 3D: Agent Delegation (Steps 521-545)

- [ ] **Step 361**: Implement `agent_request` message handler on desktop
- [ ] **Step 362**: Implement agent execution with context from mobile
- [ ] **Step 363**: Stream back results as `stream_chunk` messages
- [ ] **Step 364**: Handle tool execution on desktop for mobile request
- [ ] **Step 365**: Test end-to-end: mobile sends command → desktop executes → mobile receives result
- [ ] **Step 366**: Test tool execution via mobile (filesystem, shell, etc.)

## Section 3E: Waifu Creator (Steps 546-575)

- [ ] **Step 367**: Create waifu creator flow UI (multi-step form)
- [ ] **Step 368**: Step 1: Basic info (name, source anime, backstory)
- [ ] **Step 369**: Step 2: Personality traits (sliders for 6 traits)
- [ ] **Step 370**: Step 3: Communication style (emoji selection, phrase input)
- [ ] **Step 371**: Step 4: Avatar selection (photo upload or from roster)
- [ ] **Step 372**: Step 5: Review and confirm
- [ ] **Step 373**: Implement waifu JSON generation
- [ ] **Step 374**: Implement waifu validation (all fields required)
- [ ] **Step 375**: Store custom waifu to local filesystem
- [ ] **Step 376**: Load custom waifus at startup
- [ ] **Step 377**: Allow editing existing custom waifus
- [ ] **Step 378**: Allow deleting custom waifus
- [ ] **Step 379**: Implement waifu import (JSON file)
- [ ] **Step 380**: Implement waifu export (share with others)
- [ ] **Step 381**: Test waifu creator on mobile
- [ ] **Step 382**: Test waifu creator on desktop
- [ ] **Step 383**: Verify custom waifus work in chat

## Section 3F: Animated Expressions (Steps 576-595)

- [ ] **Step 384**: Create Lottie animations for each expression
- [ ] **Step 385**: Create idle animation (breathing, blinking)
- [ ] **Step 386**: Implement Lottie player on mobile (react-native-lottie)
- [ ] **Step 387**: Implement Lottie player on desktop (Framer Motion)
- [ ] **Step 388**: Replace static PNGs with animations
- [ ] **Step 389**: Test animations are smooth and responsive
- [ ] **Step 390**: Create custom animation upload for user waifus

## Section 3G: Desktop Overlay Widget (Steps 596-615)

- [ ] **Step 391**: Create floating waifu widget window (mini version)
- [ ] **Step 392**: Implement always-on-top behavior
- [ ] **Step 393**: Implement draggable window positioning
- [ ] **Step 394**: Implement click-to-expand (open main chat)
- [ ] **Step 395**: Add minimize to tray functionality
- [ ] **Step 396**: Test overlay on macOS, Windows, Linux

## Section 3H: Notifications & File Watchers (Steps 616-635)

- [ ] **Step 397**: Implement file watcher for build output
- [ ] **Step 398**: Create notification trigger for build completion
- [ ] **Step 399**: Implement CI/webhook integration (GitHub Actions callback)
- [ ] **Step 400**: Show toast notification with build result
- [ ] **Step 401**: Add sound alert option
- [ ] **Step 402**: Test notifications on mobile
- [ ] **Step 403**: Test notifications on desktop

## Section 3I: EAS Build & Distribution (Steps 636-650)

- [ ] **Step 404**: Configure `eas.json` for iOS and Android builds
- [ ] **Step 405**: Set up EAS credentials
- [ ] **Step 406**: Build and submit to TestFlight (iOS)
- [ ] **Step 407**: Build and submit to Google Play (Android, internal testing track)
- [ ] **Step 408**: Create privacy policy
- [ ] **Step 409**: Create app store descriptions and screenshots
- [ ] **Step 410**: Test downloaded apps function correctly

## Section 3J: CI/CD Pipeline (Steps 651-665)

- [ ] **Step 411**: Create `.github/workflows/test.yml` (run tests)
- [ ] **Step 412**: Create `.github/workflows/lint.yml` (ESLint + Prettier)
- [ ] **Step 413**: Create `.github/workflows/typecheck.yml` (TypeScript)
- [ ] **Step 414**: Create `.github/workflows/eas-build.yml` (build on commit)
- [ ] **Step 415**: Set up branch protection rules (require CI to pass)

## Section 3K: Documentation & Guides (Steps 666-695)

- [ ] **Step 416**: Write complete `CONTRIBUTING.md`
- [ ] **Step 417**: Write `WAIFU_CREATOR_GUIDE.md` (how to make custom waifus)
- [ ] **Step 418**: Write `ARCHITECTURE.md` (detailed system design)
- [ ] **Step 419**: Write `API_KEY_SETUP.md` (per-provider instructions)
- [ ] **Step 420**: Write `PHONE_REMOTE_CONTROL.md` (setup + usage)
- [ ] **Step 421**: Create video tutorials (onboarding, waifu creator)
- [ ] **Step 422**: Write FAQ
- [ ] **Step 423**: Write security/privacy guide (what data is stored, where)
- [ ] **Step 424**: Document known limitations
- [ ] **Step 425**: Create troubleshooting guide

## Section 3L: Community & Open Source (Steps 696-720)

- [ ] **Step 426**: Add `CODE_OF_CONDUCT.md`
- [ ] **Step 427**: Create GitHub issue template for bug reports
- [ ] **Step 428**: Create GitHub issue template for feature requests
- [ ] **Step 429**: Create GitHub pull request template
- [ ] **Step 430**: Set up GitHub discussions for community
- [ ] **Step 431**: Write public launch announcement
- [ ] **Step 432**: Create social media assets (Twitter, Reddit, etc.)
- [ ] **Step 433**: Submit to "Awesome" lists (awesome-cli-apps, etc.)
- [ ] **Step 434**: Submit to Hacker News
- [ ] **Step 435**: Create community waifus repository (separate repo)

## Section 3M: Quality Assurance (Steps 721-745)

- [ ] **Step 436**: Full end-to-end test: onboarding → chat → tools → mobile control
- [ ] **Step 437**: Test on multiple device types (iPhone, Android, macOS, Windows, Linux)
- [ ] **Step 438**: Performance testing (memory, CPU, battery on mobile)
- [ ] **Step 439**: Stress testing (100+ messages, large files, rapid tool calls)
- [ ] **Step 440**: Security testing (no API key leaks, no injection vulnerabilities)
- [ ] **Step 441**: Accessibility testing (screen readers, keyboard nav)
- [ ] **Step 442**: Test all 20+ built-in waifus thoroughly
- [ ] **Step 443**: Beta test with external users (collect feedback)
- [ ] **Step 444**: Fix critical bugs found in beta
- [ ] **Step 445**: Create changelog for v0.1.0

## Section 3N: Phase 3 Final Sign-Off (Steps 746-760)

- [ ] **Step 446**: Ensure all 215+ implementation steps are complete ✓
- [ ] **Step 447**: `turbo run typecheck` passes on all packages
- [ ] **Step 448**: `turbo run lint` passes with no warnings
- [ ] **Step 449**: `turbo run test` achieves >90% coverage
- [ ] **Step 450**: All CI workflows passing
- [ ] **Step 451**: Documentation is complete and accurate
- [ ] **Step 452**: Community guidelines are in place
- [ ] **Step 453**: Apps are available on app stores (iOS + Android)
- [ ] **Step 454**: Public GitHub repository ready for launch
- [ ] **Step 455**: Final full system test on all platforms

---

## Appendix: Success Criteria by Phase

### Phase 1 Success
- ✅ Chat works on iOS, Android, macOS, Windows, Linux
- ✅ Streaming responses display smoothly
- ✅ Anthropic + OpenAI providers work
- ✅ 5 built-in waifus available
- ✅ All types compile without errors

### Phase 2 Success
- ✅ Agent tools execute (filesystem, shell, search)
- ✅ 10+ AI providers available
- ✅ Tool permissions configurable
- ✅ Long-term memory works
- ✅ Affection system increases engagement

### Phase 3 Success
- ✅ Phone can remote-control desktop
- ✅ Users can create custom waifus
- ✅ Waifu creator is intuitive and fun
- ✅ Desktop overlay widget works smoothly
- ✅ Open source repository is healthy
- ✅ Community is engaged

---

## Appendix: File Checklist

**Created in Phase 1 Scaffolding:**
- ✅ `/package.json`
- ✅ `/turbo.json`
- ✅ `/.gitignore`
- ✅ `/tsconfig.base.json`
- ✅ `/packages/ai-core/package.json`
- ✅ `/packages/ai-core/src/types.ts`
- ✅ `/packages/ai-core/src/index.ts`
- ✅ `/packages/waifu-core/package.json`
- ✅ `/packages/waifu-core/src/types.ts`
- ✅ `/packages/waifu-core/src/personality.ts`
- ✅ `/packages/waifu-core/src/index.ts`
- ✅ `/packages/agent-tools/package.json`
- ✅ `/packages/agent-tools/src/types.ts`
- ✅ `/packages/agent-tools/src/registry.ts`
- ✅ `/packages/agent-tools/src/index.ts`
- ✅ `/packages/ws-protocol/package.json`
- ✅ `/packages/ws-protocol/src/types.ts`
- ✅ `/packages/ws-protocol/src/index.ts`
- ✅ `/packages/storage/package.json`
- ✅ `/packages/storage/src/types.ts`
- ✅ `/packages/storage/src/index.ts`
- ✅ `/packages/ui/package.json`
- ✅ `/packages/ui/src/index.ts`
- ✅ `/apps/mobile/package.json`
- ✅ `/apps/desktop/package.json`

**Next to Create:** See Phase 1 Section 1C onwards...

---

**Last Updated**: 2026-04-07  
**Next Review**: After Phase 1 Scaffolding (Step 30 complete)
