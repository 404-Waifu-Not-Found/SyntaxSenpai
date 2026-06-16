# AI Provider Setup

SyntaxSenpai supports 21 registered provider IDs. Eighteen work end-to-end in the current tree; `azure-openai`, `fireworks`, and `xai-grok` are registered stubs whose `chat()` and `stream()` methods throw until implemented.

For normal desktop use, configure providers in **Settings -> AI**. API keys are stored through the OS keychain path and are not read from a project `.env` file.

## Provider Status

| Provider ID | Status | Auth | Notes |
|---|---|---|---|
| `anthropic` | Live | API key | Claude models, strong tool calling |
| `openai` | Live | API key | GPT models, strong tool calling |
| `openai-codex` | Live | API key | OpenAI Codex route |
| `gemini` | Live | API key | Google Gemini route |
| `mistral` | Live | API key | Mistral API |
| `cohere` | Live | API key | Cohere Chat API |
| `groq` | Live | API key | Fast hosted open-model inference |
| `deepseek` | Live | API key | DeepSeek API |
| `perplexity` | Live | API key | Perplexity API |
| `together` | Live | API key | Together AI API |
| `xai` | Live | API key | xAI API |
| `huggingface` | Live | API key | Hugging Face inference |
| `github-models` | Live | API key | GitHub Models token |
| `minimax-global` | Live | API key | MiniMax global endpoint |
| `minimax-cn` | Live | API key | MiniMax China endpoint |
| `nvidia` | Live | API key | NVIDIA NIM hosted open models |
| `ollama` | Live | None | Local model server |
| `lmstudio` | Live | Optional | Local model server |
| `azure-openai` | Stub | API key + resource | Registered but not implemented |
| `fireworks` | Stub | API key | Registered but not implemented |
| `xai-grok` | Stub | API key | Registered but not implemented |

Removed providers: Replicate and AWS Bedrock are no longer in the registry.

## In-App Setup

1. Start the desktop app:

   ```bash
   pnpm dev:desktop
   ```

2. Open **Settings -> AI**.
3. Pick a provider.
4. Paste the API key, if the provider requires one.
5. Refresh/select a model.
6. Save settings and start a new chat.

Local providers:

- `ollama`: start Ollama locally before selecting it.
- `lmstudio`: start LM Studio's local server before selecting it.

## API Key Sources

Use the provider's official dashboard to generate keys:

| Provider | Key page |
|---|---|
| Anthropic | <https://console.anthropic.com/> |
| OpenAI | <https://platform.openai.com/api-keys> |
| Google Gemini | <https://aistudio.google.com/app/apikey> |
| Mistral | <https://console.mistral.ai/api-keys/> |
| Groq | <https://console.groq.com/keys> |
| DeepSeek | <https://platform.deepseek.com/api_keys> |
| Perplexity | <https://www.perplexity.ai/settings/api> |
| Together AI | <https://api.together.xyz/settings/api-keys> |
| xAI | <https://console.x.ai/> |
| Hugging Face | <https://huggingface.co/settings/tokens> |
| GitHub Models | <https://github.com/settings/tokens> |
| Cohere | <https://dashboard.cohere.com/api-keys> |
| NVIDIA | <https://build.nvidia.com/> |
| MiniMax | Provider dashboard for your region/account |

Do not commit real keys, paste them into screenshots, or share them in issues.

## Local Model Setup

### Ollama

Install Ollama, pull a model, and keep the server running:

```bash
ollama pull llama3.1
ollama serve
```

Default local URL:

```text
http://localhost:11434
```

Then choose `ollama` in **Settings -> AI**.

### LM Studio

1. Install LM Studio.
2. Download a chat model.
3. Start the local server from LM Studio.
4. Choose `lmstudio` in **Settings -> AI**.

Common local URL:

```text
http://localhost:1234/v1
```

## Code Usage

The provider runtime lives in `@syntax-senpai/ai-core`.

### Explicit Provider Config

```ts
import { AIChatRuntime } from "@syntax-senpai/ai-core";

const runtime = new AIChatRuntime({
  provider: {
    type: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  model: "claude-3-5-sonnet-20241022",
  systemPrompt: "You are Sakura, a helpful coding companion.",
  temperature: 0.7,
  maxTokens: 2048,
});

const result = await runtime.sendMessage({
  text: "Explain how to debounce a search input in React.",
  history: [],
});

console.log(result.response.content);
```

### Environment-Based Runtime

```ts
import { createRuntimeFromEnv } from "@syntax-senpai/ai-core";

const runtime = createRuntimeFromEnv({
  provider: "openai",
  model: "gpt-4o",
});
```

`createRuntimeFromEnv()` is useful for scripts and tests. The desktop app stores keys through Settings instead.

### Tool-Calling Loop

```ts
import { toolRegistry } from "@syntax-senpai/agent-tools";

const result = await runtime.sendMessage(
  {
    text: "List the files in the current project root.",
    tools: toolRegistry.getDefinitions(),
  },
  async (toolCall) => {
    const toolResult = await toolRegistry.execute(toolCall, {
      platform: "desktop",
      userId: "user-1",
      waifuId: "sakura",
      permissions: {
        fileRead: true,
        fileWrite: false,
        shellExec: false,
        networkAccess: false,
      },
      workingDirectory: process.cwd(),
    });

    if (!toolResult.success) {
      return { content: toolResult.error, isError: true };
    }

    return JSON.stringify(toolResult.data);
  }
);

console.log(result.response.content);
```

### Streaming

```ts
for await (const chunk of runtime.streamMessage({
  text: "Write a short TypeScript function that groups array items by key.",
})) {
  if (chunk.type === "text_delta") {
    process.stdout.write(chunk.delta ?? "");
  }
}
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Key is rejected | Regenerate the key, confirm it belongs to the selected provider, and check account billing/limits. |
| Model list is empty | Use **Refresh models**, verify the key, and check provider availability. |
| Local provider cannot connect | Confirm the local server is running and the base URL/port matches the app settings. |
| Tool calls fail | Try a provider with tool support and verify agent mode is not `ask` when you expect automatic execution. |
| `azure-openai` or `fireworks` fails | Expected in the current tree; both are registered stubs. |

## Security

- Desktop keys are stored with the OS keychain integration.
- Keys are never sent to a SyntaxSenpai server.
- Cloud providers receive the prompts/messages you send through them.
- Local providers keep inference on your machine, subject to the local model server you run.
