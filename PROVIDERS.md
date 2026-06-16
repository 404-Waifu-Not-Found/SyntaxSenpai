# AI Providers

This file is the provider catalog. For the broader project status, see [STATE.md](./STATE.md). For key setup steps, see [PROVIDER_SETUP.md](./PROVIDER_SETUP.md).

## Current Status

`packages/ai-core/src/providers/index.ts` registers 21 provider IDs.

- **18 live providers**: `anthropic`, `openai`, `openai-codex`, `gemini`, `mistral`, `cohere`, `groq`, `deepseek`, `perplexity`, `together`, `xai`, `huggingface`, `github-models`, `minimax-global`, `minimax-cn`, `nvidia`, `ollama`, `lmstudio`.
- **3 registered stubs**: `azure-openai`, `fireworks`, `xai-grok`.
- **Removed**: Replicate and AWS Bedrock are not in the registry.

The desktop picker should avoid registered stubs until their `chat()` and `stream()` implementations are complete.

## Provider Table

| Provider ID | Display | Status | Key required | Best fit |
|---|---|---:|---:|---|
| `anthropic` | Anthropic Claude | Live | Yes | Reasoning, coding, long-context work |
| `openai` | OpenAI | Live | Yes | General chat, coding, tool calling |
| `openai-codex` | OpenAI Codex | Live | Yes | Code-oriented OpenAI route |
| `gemini` | Google Gemini | Live | Yes | Long context and multimodal tasks |
| `mistral` | Mistral | Live | Yes | Fast hosted models |
| `cohere` | Cohere | Live | Yes | Command models and NLU-style tasks |
| `groq` | Groq | Live | Yes | Low-latency hosted inference |
| `deepseek` | DeepSeek | Live | Yes | Cost-sensitive coding/reasoning |
| `perplexity` | Perplexity | Live | Yes | Search-oriented model calls |
| `together` | Together AI | Live | Yes | Hosted open models |
| `xai` | xAI | Live | Yes | xAI API |
| `huggingface` | Hugging Face | Live | Yes | Hosted community models |
| `github-models` | GitHub Models | Live | Yes | GitHub-hosted model access |
| `minimax-global` | MiniMax Global | Live | Yes | MiniMax global endpoint |
| `minimax-cn` | MiniMax CN | Live | Yes | MiniMax China endpoint |
| `nvidia` | NVIDIA NIM | Live | Yes | Hosted open models via NVIDIA |
| `ollama` | Ollama | Live | No | Local/offline models |
| `lmstudio` | LM Studio | Live | Optional | Local OpenAI-compatible server |
| `azure-openai` | Azure OpenAI | Stub | Yes | Registered, not implemented |
| `fireworks` | Fireworks AI | Stub | Yes | Registered, not implemented |
| `xai-grok` | xAI Grok | Stub | Yes | Registered, not implemented |

## Provider Notes

### Anthropic

Strong default for long-context coding and tool use. Built-in waifus currently default to Anthropic Claude in their metadata.

### OpenAI

General-purpose provider with strong tool-calling behavior and broad model availability. Use `openai-codex` when you specifically want the Codex route exposed by this project.

### Gemini

Useful when long context is the deciding factor. Requires a Google AI Studio API key.

### Groq, Together, Hugging Face

Good options for hosted open-model workflows. Model availability changes often, so refresh models from the desktop AI settings when switching.

### NVIDIA NIM

Hosted open-model inference via NVIDIA's OpenAI-compatible endpoint. Get an API key from <https://build.nvidia.com/> and use `nvidia` in **Settings -> AI**.

### Ollama

Keyless local provider. Start Ollama and pull at least one model before selecting it:

```bash
ollama pull llama3.1
ollama serve
```

### LM Studio

Keyless or optional-key local provider, depending on your server settings. Start LM Studio's local server before selecting `lmstudio`.

### Azure OpenAI, Fireworks, And xAI Grok

These are registered in the factory so the IDs exist, but they currently throw "not yet fully implemented" from `chat()` and `stream()`. Treat them as implementation placeholders, not usable providers.

## Adding A Provider

1. Add a provider class under `packages/ai-core/src/providers/`.
2. Implement the shared provider interface from `base.ts` / `types.ts`.
3. Export it from `packages/ai-core/src/providers/index.ts`.
4. Add it to the `ProviderConfig` union and `createProvider()` switch.
5. Add metadata through `getAllProviderMetadata()`.
6. Wire the desktop picker labels/models if needed.
7. Add focused tests for `chat()`, `stream()`, and tool-call mapping where the provider supports tools.

Do not add catalog entries for providers that are not present in the registry.
