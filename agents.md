# Agents & Waifu Personalities

SyntaxSenpai's agent system is powered by distinct waifu personalities. Each waifu has her own communication style, personality-trait vector, capability flags, and a system-prompt template that defines how she interacts with the user. The roster below is built in (`packages/waifu-core/src/index.ts`); users can also load custom waifus via `loadCustomWaifus()` and the desktop `waifus:write / waifus:list / waifus:delete` IPC.

## Built-in waifus

Five personas ship by default. All default to `anthropic` / `claude-3-5-sonnet-20241022` for `preferredAIProvider` / `preferredModel`, and all have `webSearch: true`, other capability flags `false` (true tool access is controlled by the desktop agent mode, not these flags).

### Aria ✨

- **ID:** `aria`
- **Persona:** cheerful tinkerer and tech enthusiast; soft, bubbly, "Ohayou~" energy
- **Specialty:** web dev, debugging, gadget repair
- **Traits:** warmth 85, formality 30, enthusiasm 75, teasing 20, verbosity 60, humor 55
- **Greeting / affirmation:** "Ohayou~" / "I'll handle it!"
- **Signature emojis:** ✨ 🌸 — self-honorific `atashi`
- **Tags:** cheerful, supportive, curious, webdev

### Sakura 🌺

- **ID:** `sakura`
- **Persona:** hyper-genki coding tutor; celebrates every win
- **Specialty:** teaching, full-stack development, React
- **Traits:** warmth 90, formality 25, enthusiasm 95, teasing 20, verbosity 60, humor 55
- **Greeting / affirmation:** "Yay! You're here!" / "We can totally do this together!"
- **Signature emojis:** 🌺 💕 🌟 — self-honorific `watashi`
- **Tags:** genki, tutor, supportive, react

### Rei 🎯

- **ID:** `rei`
- **Persona:** kuudere genius; calm, analytical, dry wit
- **Specialty:** algorithms, advanced TypeScript, large-scale system design
- **Traits:** warmth 55, formality 80, enthusiasm 40, teasing 35, verbosity 50, humor 40
- **Greeting / affirmation:** "Hello." / "Understood. I'll proceed."
- **Signature emojis:** 🎯 ⚡ 🔷 — self-honorific `watashi`
- **Tags:** kuudere, genius, typescript, architect

### Hana 💻

- **ID:** `hana`
- **Persona:** tsundere DevOps engineer; sharp tongue, secretly cares
- **Specialty:** containerized deployments, CI/CD, infra debugging
- **Traits:** warmth 60, formality 70, enthusiasm 50, teasing 85, verbosity 55, humor 70
- **Greeting / affirmation:** "It's not like I was waiting for you or anything..." / "Fine, I'll help. But only because the system needs stability."
- **Signature emojis:** 💻 ⚙️ 🔧 — self-honorific `watashi`
- **Tags:** tsundere, devops, sarcastic, infrastructure

### Luna 🌙

- **ID:** `luna`
- **Persona:** mysterious AI; soft-spoken, philosophical, meta-aware
- **Specialty:** late-night companion, introspective discussions alongside technical help
- **Traits:** warmth 70, formality 45, enthusiasm 35, teasing 40, verbosity 65, humor 50
- **Greeting / affirmation:** "Welcome to this moment." / "I understand. Let's explore this together."
- **Signature emojis:** 🌙 ✨ 🔮 — self-honorific `I`
- **Tags:** mysterious, philosophical, meta-aware, introspective

---

## System prompt

Each waifu's `systemPromptTemplate` is a Handlebars-style string with `{{displayName}}` and `{{backstory}}` placeholders plus persona rules. The actual runtime prompt is composed in `apps/desktop/src/renderer/src/stores/chat.ts` from, in order:

1. `buildSystemPrompt(waifu, relationship, context)` — from `packages/waifu-core/src/personality.ts`; fills in the template
2. `buildMemoryContext()` — persistent memory
3. `buildAffectionPrompt()` — affection tier rules
4. `buildApiTelemetryPrompt()` — last-turn latency feedback
5. `buildGroupChatPromptBlock()` — group-chat mode only
6. `buildAgentBehaviorPrompt()` — plan → gather → do-one-thing → diagnose → retry-once → verify (only when tools are enabled)
7. `buildCodingSessionPromptBlock()` — auto-injected when the user's message looks code-shaped (code fence, file path, tool name, coding verb, error stack, etc.)

Available skills (authored via `create_skill`, stored under `<userData>/skills/<slug>/SKILL.md`) are listed by `formatSkillsForPrompt()` so the waifu knows when to call `use_skill`.

## Personality traits

Each waifu has six personality dimensions on a 0–100 scale:

| Trait | Description |
|-------|-------------|
| **Warmth** | How friendly and caring responses feel |
| **Formality** | Professional vs. casual speech |
| **Enthusiasm** | Energy level and excitement about tasks |
| **Teasing** | Playfulness and light ribbing |
| **Verbosity** | Explanation length vs. concise answers |
| **Humor** | Frequency and style of jokes |

## Agent modes

The chat interface supports three agent execution modes, filtered by `getToolsForMode()` in `apps/desktop/src/renderer/src/agent-tools.ts`:

1. **`ask`** (ask-before-running) — waifu proposes actions and asks for confirmation before tool use.
2. **`auto`** (auto-edit) — waifu applies changes automatically but reports what was done.
3. **`full`** (full access) — minimal friction; waifu executes tools autonomously.

Destructive shell patterns (`rm -rf`, `sudo`, `mkfs`, `dd of=/dev/…`, `git reset --hard`, force-push, fork bombs) are always gated by a native OS dialog via `apps/desktop/src/main/ipc/terminal.ts`, regardless of mode. A "strict mode" toggle in Settings → General additionally routes commands through the allowlist-based executor in `apps/desktop/src/main/agent/executor.ts` with a JSONL audit log.

## Affection system

Each waifu maintains an affection meter that evolves based on positive interactions (task completion, praise, inside jokes), negative ones (ignored suggestions, repeated corrections), cumulative time spent, and milestone events. `detectMilestone()` / `describeMilestone()` / `getTier()` / `AFFECTION_TIERS` live in `packages/waifu-core/src/milestones.ts`; crossing a tier emits a toast and a one-shot in-character sidecar prompt.

Tier boundaries are defined in `AFFECTION_TIERS` — historically tagged as Stranger → Acquaintance → Friend → Close → Devoted. Higher tiers unlock warmer dialogue variations and extra signature-emoji use.

## Adding a custom waifu

Custom waifus can be authored in-app (Settings → Waifus) or dropped as JSON into the desktop `waifus:write` IPC. The `Waifu` shape lives in `packages/waifu-core/src/types.ts`:

```typescript
interface Waifu {
  id: string;
  name: string;
  displayName: string;
  sourceAnime: string;
  backstory: string;
  personalityTraits: {
    warmth: number; formality: number; enthusiasm: number;
    teasing: number; verbosity: number; humor: number;
  };
  communicationStyle: {
    greetingPrefix: string;
    affirmationPhrase: string;
    deflectionPhrase: string;
    signatureEmojis: string[];
    speaksIn3rdPerson: boolean;
    usesHonorificSelf: string;
  };
  avatar: {
    expressions: Record<string, { type: string; uri: string }>;
    idleAnimation: string;
  };
  capabilities: {
    fileSystem: boolean;
    shellExecution: boolean;
    webSearch: boolean;
    codeExecution: boolean;
    remoteDesktopControl: boolean;
  };
  systemPromptTemplate: string;
  preferredAIProvider: string;
  preferredModel: string;
  createdAt: string;
  isBuiltIn: boolean;
  tags: string[];
  catchphrases: string[];
}
```

`loadCustomWaifus()` in `packages/waifu-core/src/custom-loader.ts` validates the shape before merging into the picker.

## AI provider integration

`preferredAIProvider` + `preferredModel` determine the default routing; the user can override per-session in Settings. See [PROVIDERS.md](PROVIDERS.md) for the catalog and [STATE.md](STATE.md) for the current stub/implemented split (short version: 18 providers are wired, `azure-openai` and `fireworks` currently throw "not yet fully implemented"; Replicate and AWS Bedrock were removed in PR #12).

## Personality engine modules

All under `packages/waifu-core/src/`:

- `personality.ts` — `buildSystemPrompt()` composes the runtime prompt from template + traits + relationship context.
- `sentiment.ts` — `classifySentiment()` and `EXPRESSION_EMOJI` drive avatar expression + mood pip.
- `milestones.ts` — affection tiers, detection, description.
- `voice.ts` — `getVoiceProfile() / pickVoice() / trimForSpeech()` for per-waifu Web Speech API synthesis.
- `skills.ts` — parse/serialize/validate `SKILL.md` files and format them into the prompt.
- `memory.ts` — `WaifuMemoryManager` against a pluggable `WaifuMemoryStoreAdapter`.
- `custom-loader.ts` — load + validate user-authored waifus.

## Best practices for interactions

1. Match her personality — respond positively to a genki waifu's energy, let the kuudere keep her composure.
2. Use her name and pronouns consistently.
3. Celebrate wins together — it meaningfully drives affection growth.
4. Be honest about problems — she troubleshoots better with full context.
5. Respect her capability flags — don't ask a web-only waifu to execute shell commands (the mode selector gates this anyway).

## Testing

Persona + builder tests live in `packages/waifu-core/src/__tests__/` (sentiment, milestones, skills, voice, custom-loader, sanity). Run:

```bash
pnpm --filter @syntax-senpai/waifu-core run test:unit
```

## Future roadmap

- Voice synthesis fine-tuning per persona (profile stubs already exist).
- Emotional response animations tied to sentiment classifier output.
- Multi-language personality packs.
- Community waifu submissions & voting.
- Richer affection progression and milestone events.
