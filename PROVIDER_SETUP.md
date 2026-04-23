# AI Provider Configuration Guide

SyntaxSenpai supports **15+ AI providers** with flexible authentication options. Each provider can be configured with API keys stored securely on your device.

---

## Complete AI Calling Setup (Code)

The core calling layer now lives in `@syntax-senpai/ai-core` and is exported from `packages/ai-core/src/runtime.ts`.

### 1) Create runtime from explicit provider config

```ts
import { AIChatRuntime } from "@syntax-senpai/ai-core";

const runtime = new AIChatRuntime({
  provider: {
    type: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  model: "claude-sonnet-4-20250514",
  systemPrompt: "You are Sakura, a helpful coding companion.",
  temperature: 0.7,
  maxTokens: 2048,
});
```

### 2) Create runtime from environment variables

```ts
import { createRuntimeFromEnv } from "@syntax-senpai/ai-core";

const runtime = createRuntimeFromEnv({
  provider: "openai",
  // optional override if omitted: SYNTAX_SENPAI_AI_MODEL or provider-specific model var
  model: "gpt-4o",
});
```

### 3) Send a normal message

```ts
const result = await runtime.sendMessage({
  text: "Explain how to debounce a search input in React.",
  history: [],
});

console.log(result.response.content);
```

### 4) Send with tool-calling loop

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
      return {
        content: toolResult.error,
        isError: true,
      };
    }

    return JSON.stringify(toolResult.data);
  }
);

console.log(result.response.content);
```

### 5) Stream response chunks

```ts
for await (const chunk of runtime.streamMessage({
  text: "Write a short TypeScript function that groups array items by key.",
})) {
  if (chunk.type === "text_delta") {
    process.stdout.write(chunk.delta ?? "");
  }
}
```

### 6) Environment variables

A full template is available at `.env.example` in the project root.

---

## Quick Provider Comparison

| Provider | Type | Auth | Speed | Cost | Context | Tools |
|----------|------|------|-------|------|---------|-------|
| **Anthropic** | API | API Key | ⭐⭐⭐ | $$$ | 200K | ✅ |
| **OpenAI** | API | API Key | ⭐⭐⭐ | $$$ | 128K | ✅ |
| **Google Gemini** | API | API Key | ⭐⭐⭐ | $$ | 1M | ✅ |
| **Mistral** | API | API Key | ⭐⭐⭐ | $ | 128K | ✅ |
| **Groq** | API | API Key | ⭐⭐⭐⭐⭐ | Free | 128K | ✅ |
| **Perplexity** | API | API Key | ⭐⭐⭐ | $ | 128K | ✅ |
| **Cohere** | API | API Key | ⭐⭐⭐ | $$ | 128K | ✅ |
| **Together AI** | API | API Key | ⭐⭐⭐⭐ | Free | 128K | ✅ |
| **HuggingFace** | API | API Key | ⭐⭐ | $ | Varies | ❌ |
| **Ollama** | Local | None | ⭐⭐⭐⭐ | Free | Varies | ❌ |
| **xAI Grok** | API | API Key | ⭐⭐⭐ | $$ | 128K | ✅ |
| **Azure OpenAI** | API | API Key | ⭐⭐⭐ | $$$ | 128K | ✅ |
| **Fireworks AI** | API | API Key | ⭐⭐⭐⭐ | Free | 32K | ❌ |

---

## Detailed Provider Setup

### 1. Anthropic (Claude)

**Best for**: Highest quality, best reasoning, excellent tool calling

```
Provider ID: anthropic
Models: claude-opus-4-1, claude-sonnet-4-20250514, claude-haiku-4-5-20251001
Context Window: 200,000 tokens
Tool Support: ✅ Yes
```

**Setup:**
1. Go to https://console.anthropic.com/
2. Create an account
3. Click "API Keys" in the left sidebar
4. Create a new API key
5. Copy the key (starts with `sk-ant-`)
6. Paste into SyntaxSenpai settings

**Example API Key Format**: `sk-ant-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8`

---

### 2. OpenAI (GPT-4o, GPT-4)

**Best for**: Reliability, popular models, excellent vision capabilities

```
Provider ID: openai
Models: gpt-4o, gpt-4-turbo, gpt-4, gpt-3.5-turbo
Context Window: 128,000 tokens (GPT-4o)
Tool Support: ✅ Yes
```

**Setup:**
1. Go to https://platform.openai.com/account/api-keys
2. Create an account (or log in)
3. Click "Create new secret key"
4. Copy the key (starts with `sk-`)
5. Paste into SyntaxSenpai settings

**Example API Key Format**: `sk-proj-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8`

---

### 3. Google Gemini

**Best for**: Massive context window (1M tokens), vision capabilities

```
Provider ID: gemini
Models: gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash
Context Window: 1,000,000 tokens (2.0 Flash)
Tool Support: ✅ Yes
```

**Setup:**
1. Go to https://aistudio.google.com/app/apikey
2. Create an account (or use Google account)
3. Click "Create API Key" → "Create API key in new project"
4. Copy the key
5. Paste into SyntaxSenpai settings

---

### 4. Mistral AI

**Best for**: Open models, good performance, reasonable pricing

```
Provider ID: mistral
Models: mistral-large-latest, mistral-medium-latest, mistral-small-latest
Context Window: 128,000 tokens
Tool Support: ✅ Yes
```

**Setup:**
1. Go to https://console.mistral.ai/api-keys/
2. Create an account
3. Generate an API key
4. Copy the key
5. Paste into SyntaxSenpai settings

---

### 5. Groq (Free, Super Fast)

**Best for**: Speed, free usage, open source models

```
Provider ID: groq
Models: mixtral-8x7b-32768, llama-3.1-70b-versatile, llama-3.1-8b-instant
Context Window: 32,768 - 128,000 tokens
Tool Support: ✅ Limited
Cost: FREE tier available
```

**Setup:**
1. Go to https://console.groq.com/keys
2. Create an account
3. Generate an API key
4. Copy the key
5. Paste into SyntaxSenpai settings

**Note**: Groq has a free tier but with rate limits. Great for testing!

---

### 6. Perplexity AI

**Best for**: Online search integrated into AI, real-time information

```
Provider ID: perplexity
Models: llama-3.1-sonar-large-128k-online, llama-3.1-sonar-small-128k-online
Context Window: 128,000 tokens
Tool Support: ✅ Yes (includes web search)
```

**Setup:**
1. Go to https://www.perplexity.ai/
2. Create an account
3. Go to Settings → API
4. Generate an API key
5. Copy the key
6. Paste into SyntaxSenpai settings

---

### 7. Cohere

**Best for**: Semantic search, embeddings, good NLU

```
Provider ID: cohere
Models: command-r-plus, command-r
Context Window: 128,000 tokens
Tool Support: ✅ Yes
```

**Setup:**
1. Go to https://dashboard.cohere.com/api-keys
2. Create an account
3. Create an API key
4. Copy the key
5. Paste into SyntaxSenpai settings

---

### 8. Together AI (Free, Open Models)

**Best for**: Cost-effective, open source models, good performance

```
Provider ID: together
Models: Llama 3.1 405B, Llama 3.1 70B, Llama 3 70B
Context Window: 128,000 tokens
Tool Support: ✅ Yes
Cost: FREE tier + credits
```

**Setup:**
1. Go to https://www.together.ai/
2. Create an account
3. Go to Settings → API Keys
4. Create an API key
5. Copy the key
6. Paste into SyntaxSenpai settings

---

### 9. Hugging Face Inference API

**Best for**: Open source models, community models

```
Provider ID: huggingface
Models: Llama 2, Nous Hermes, custom models
Context Window: Varies
Tool Support: ❌ No
```

**Setup:**
1. Go to https://huggingface.co/settings/tokens
2. Create an account
3. Create an access token (read)
4. Copy the token
5. Paste into SyntaxSenpai settings

---

### 11. Ollama (Local/Self-Hosted)

**Best for**: Privacy, offline usage, complete control, free

```
Provider ID: ollama
Models: llama2, mistral, neural-chat, custom models
Context Window: Varies (typically 4K-32K)
Tool Support: ❌ No
Cost: FREE (runs locally)
Requirements: Ollama software installed locally
```

**Setup:**

**Step 1: Install Ollama**
- macOS/Windows/Linux: Download from https://ollama.ai/
- Docker: `docker run -d -p 11434:11434 ollama/ollama`

**Step 2: Pull a model**
```bash
ollama pull llama2
ollama pull mistral
ollama pull neural-chat
```

**Step 3: Verify it's running**
```bash
curl http://localhost:11434/api/tags
```

**Step 4: Configure in SyntaxSenpai**
- Provider: Ollama
- Base URL: `http://localhost:11434` (local)
  OR `http://192.168.1.100:11434` (remote machine on network)
- Model: llama2 (or whichever you pulled)
- No API key needed

**Available Models to Pull:**
```bash
ollama pull llama2          # Good all-rounder
ollama pull mistral         # Fast, good quality
ollama pull neural-chat     # Chat optimized
ollama pull openchat        # Good chat model
ollama pull dolphin-mixtral # Good reasoning
ollama pull orca-mini       # Small, fast
```

---

### 12. xAI Grok

**Best for**: Real-time information, maximum boldness

```
Provider ID: xai-grok
Models: grok-2-latest, grok-vision-beta
Context Window: 128,000 tokens
Tool Support: ✅ Yes
```

**Setup:**
1. Go to https://console.x.ai/
2. Create an account
3. Generate an API key
4. Copy the key
5. Paste into SyntaxSenpai settings

---

### 13. Azure OpenAI

**Best for**: Enterprise deployments, compliance requirements

```
Provider ID: azure-openai
Models: GPT-4o, GPT-4 Turbo (in Azure)
Context Window: 128,000 tokens
Tool Support: ✅ Yes
Requirements: Azure subscription, OpenAI service deployed
```

**Setup:**
1. Go to https://portal.azure.com/
2. Create an OpenAI resource
3. Deploy GPT-4o model
4. Get API key and resource name from "Keys and Endpoint"
5. In SyntaxSenpai:
   - Provider: Azure OpenAI
   - API Key: Your Azure API key
   - Resource Name: Your Azure resource name (e.g., `my-openai-resource`)

---

### 14. Fireworks AI (Free, Fast)

**Best for**: Cost-effective, very fast inference, free tier

```
Provider ID: fireworks
Models: Llama 3 70B, Mixtral 8x7B
Context Window: Varies (32K typical)
Tool Support: ❌ No
Cost: FREE tier available
```

**Setup:**
1. Go to https://app.fireworks.ai/
2. Create an account
3. Go to API Keys section
4. Create an API key
5. Copy the key
6. Paste into SyntaxSenpai settings

---

## Security & API Key Management

### ✅ Best Practices
- **Never share API keys** - They're like passwords
- **Rotate keys regularly** - Many providers support key rotation
- **Use environment variables** - For local development
- **SyntaxSenpai stores keys securely**:
  - **Mobile**: iOS Keychain / Android Keystore
  - **Desktop**: macOS Keychain / Windows Credential Manager / Linux libsecret

### ⚠️ What NOT to Do
- Don't commit API keys to Git
- Don't expose keys in URLs or logs
- Don't share keys in screenshots
- Don't use the same key across multiple devices (consider separate keys per device)

### 🔒 How SyntaxSenpai Protects Keys
1. Keys are encrypted using platform-native keystores
2. Keys are never sent to any SyntaxSenpai server
3. Keys are only used locally on your device
4. Keys are never logged or stored in plain text

---

## Switching Providers Mid-Conversation

You can switch between providers at any time:
1. Open Settings
2. Select a different provider from the dropdown
3. Enter/confirm API key if needed
4. Start a new conversation (previous conversations remain in their provider)

---

## Troubleshooting

### "Invalid API Key" Error
- Check that you copied the entire key correctly
- Ensure the key hasn't expired or been revoked
- Try regenerating a new key from the provider's dashboard

### "Provider not responding" Error
- Check your internet connection
- Verify the API key is still valid
- Check if the provider is experiencing downtime
- Some providers have rate limits - wait a moment and retry

### "Model not available" Error
- Some models may not be available in your region
- Check the provider's documentation for model availability
- Try a different model from the supported list

### Ollama not working
- Ensure Ollama is running: `ollama serve`
- Check it's accessible: `curl http://localhost:11434/api/tags`
- If using remote machine, ensure network connection works
- Try pulling a model: `ollama pull llama2`

---

## Cost Estimates

**Free Tier Options:**
- Groq: Free tier available
- Together AI: Free credits
- Ollama: Completely free (local)
- Fireworks: Free tier available

**Budget Options (< $1/day):**
- Groq, Together, Fireworks, HuggingFace

**Premium Options (Highest Quality):**
- Anthropic Claude: ~$0.003/1K prompt tokens
- OpenAI GPT-4o: ~$0.005/1K prompt tokens
- Azure OpenAI: Enterprise pricing

**Recommended for Beginners:**
1. Start with **Groq** (free, fast, easy)
2. Try **Ollama** for privacy (free, local)
3. Upgrade to **Claude** or **GPT-4o** once you like the app

---

## Provider Availability by Region

Most providers support worldwide access, but:
- **Azure OpenAI**: Available in limited regions
- **AWS Bedrock**: Available in select regions
- **Perplexity**: Worldwide
- **Groq**: Worldwide

Check provider documentation for your region.

---

Last Updated: 2026-04-07
