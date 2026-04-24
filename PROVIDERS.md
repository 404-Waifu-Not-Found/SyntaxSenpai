# SyntaxSenpai AI Providers Reference

> **Status freshness:** this document is a long-form marketing/catalog reference. For the ground-truth list of which providers are actually wired right now, see [STATE.md](./STATE.md). Descriptions below are kept for feature comparison, but several "partial" labels from earlier revisions no longer reflect the code.

SyntaxSenpai's provider registry (`packages/ai-core/src/providers/index.ts`) exposes 20 IDs. Features vary per provider but the platform supports:

- ✅ Streaming responses
- ✅ Tool/function calling (most providers)
- ✅ Multiple models per provider
- ✅ Flexible authentication (API keys, local, self-hosted)
- ✅ Context windows from 4K to 1M+ tokens

---

## 📊 Provider Status (as of the current tree)

### ✅ Fully Implemented (in registry, chat/stream work)

Anthropic, OpenAI, OpenAI Codex, Google Gemini, Mistral, Cohere, Together AI, Groq, Perplexity, Hugging Face, DeepSeek, MiniMax (Global + CN), xAI + xAI Grok, GitHub Models, Ollama (local, keyless), LM Studio (local, keyless) — 18 providers.

### ⚠️ Stubs (registered but throw "not yet fully implemented")

- **Azure OpenAI** — `providers/azure-openai.ts`
- **Fireworks AI** — `providers/fireworks-ai.ts`

Both throw from `chat()` and `stream()` until fully implemented. They should be hidden from the desktop picker.

### ❌ Removed (per PR #12)

- **Replicate** — file deleted
- **AWS Bedrock** — file deleted

Earlier revisions of this file listed both as "partially implemented". They no longer exist in the codebase and should not be reintroduced without a real implementation.

---

## 🚀 Provider Details

### 1. Anthropic Claude ✅

**Strengths:**
- Highest quality responses
- Best long-context handling (200K tokens)
- Excellent at reasoning and analysis
- Great tool calling support
- Safety-first approach

**Models:**
- `claude-opus-4-1` (Latest, most capable)
- `claude-sonnet-4-20250514` (Balanced quality/speed)
- `claude-haiku-4-5-20251001` (Fast, lightweight)

**Setup:** See PROVIDER_SETUP.md

**Pricing:** ~$0.003/1K prompt tokens (varies by model)

---

### 2. OpenAI GPT ✅

**Strengths:**
- Reliable and widely used
- Excellent vision capabilities
- Strong tool calling
- Large community and integrations
- Good balance of quality and speed

**Models:**
- `gpt-4o` (Latest, multimodal)
- `gpt-4-turbo` (128K context)
- `gpt-4` (Original)
- `gpt-3.5-turbo` (Fast, cheap)

**Setup:** See PROVIDER_SETUP.md

**Pricing:** ~$0.005/1K prompt tokens for GPT-4o

---

### 3. Ollama (Local) ✅

**Strengths:**
- 100% free, runs on your computer
- Complete privacy (no data leaves your device)
- No internet required (can work offline)
- Full control over the model
- Works on macOS, Windows, Linux, Docker

**Models Available:**
- `llama2` - Good general purpose
- `mistral` - Fast, capable
- `neural-chat` - Chat optimized
- `openchat` - Good chat model
- `dolphin-mixtral` - Good reasoning
- `orca-mini` - Small, fast
- And 100+ more community models

**Setup:** See PROVIDER_SETUP.md

**Pricing:** FREE

**Requirements:** Ollama software (https://ollama.ai/)

---

### 4. Google Gemini 🔧

**Strengths:**
- Massive context window (1M tokens!)
- Excellent for long documents
- Strong vision capabilities
- Real-time information (some models)

**Models:**
- `gemini-2.0-flash` (Latest, fastest)
- `gemini-1.5-pro` (Most capable)
- `gemini-1.5-flash` (Fast, efficient)

**Pricing:** Free tier available, then $0.075/1M tokens

---

### 5. Mistral AI 🔧

**Strengths:**
- Open models
- Good balance of quality and cost
- Multiple model sizes
- European-based privacy-first

**Models:**
- `mistral-large-latest` (Most capable)
- `mistral-medium-latest` (Balanced)
- `mistral-small-latest` (Fast, lightweight)

**Pricing:** Competitive, free tier available

---

### 6. Groq 🔧 (Fast Inference)

**Strengths:**
- ⚡ Extremely fast inference (best-in-class)
- Free tier available
- Great for real-time applications
- Good for prototyping
- Open source models

**Models:**
- `mixtral-8x7b-32768` (Capable, balanced)
- `llama-3.1-70b-versatile` (Large, capable)
- `llama-3.1-8b-instant` (Small, fast)

**Pricing:** FREE tier + paid options

---

### 7. Perplexity AI 🔧

**Strengths:**
- Integrated web search capability
- Real-time information
- Good reasoning
- Multimodal support

**Models:**
- `llama-3.1-sonar-large-128k-online` (With search)
- `llama-3.1-sonar-small-128k-online` (Smaller, with search)

**Pricing:** Affordable, free tier available

---

### 8. Cohere 🔧

**Strengths:**
- Good for semantic search
- Embeddings and NLU
- Business-focused features
- Good documentation

**Models:**
- `command-r-plus` (Most capable)
- `command-r` (Standard)

**Pricing:** Competitive for enterprise

---

### 9. Together AI 🔧

**Strengths:**
- Very fast inference
- Open source models
- Free tier with credits
- Great for cost-conscious users
- Good community

**Models:**
- `meta-llama/Llama-3.1-405B` (Large)
- `meta-llama/Llama-3.1-70B` (Mid-size)
- `meta-llama/Llama-3-70B-Chat` (Chat optimized)

**Pricing:** FREE tier with monthly credits

---

### 10. Replicate ❌ (removed)

Replicate was removed from the codebase in PR #12. No `providers/replicate.ts` exists. Do not reintroduce without a real implementation.

---

### 11. HuggingFace 🔧

**Strengths:**
- Access to open source models
- Large model library
- Community-driven
- Free tier available
- Good for testing models

**Models:**
- `meta-llama/Llama-2-70b-chat-hf`
- `NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO`
- 1000s of community models

**Pricing:** Free tier, then pay-as-you-go

---

### 12. xAI Grok 🔧

**Strengths:**
- Real-time information
- Bold, uncensored responses
- Good multimodal support
- Integration with X (Twitter)

**Models:**
- `grok-2-latest` (Latest version)
- `grok-vision-beta` (Vision capable)

**Pricing:** Reasonable, free tier available

---

### 13. Azure OpenAI ⚠️ (stub)

`providers/azure-openai.ts` is registered but `chat()` and `stream()` currently throw `"Azure OpenAI provider not yet fully implemented"`. Constructor requires `baseUrl` with your resource name.

**Requirements (once implemented):** Azure subscription, OpenAI service deployed.

---

### 14. AWS Bedrock ❌ (removed)

AWS Bedrock was removed from the codebase in PR #12. No `providers/aws-bedrock.ts` exists. Do not reintroduce without a real implementation.

---

### 15. Fireworks AI ⚠️ (stub)

**Strengths:**
- ⚡ Very fast inference
- Free tier available
- Good for prototyping
- Serverless approach
- Growing model library

**Models:**
- `accounts/fireworks/models/llama-v3-70b-instruct`
- `accounts/fireworks/models/mixtral-8x7b-instruct`
- Custom fine-tuned models available

**Pricing:** FREE tier available, very affordable

---

## 🎯 Recommended Provider Choices

### For Best Quality
→ **Anthropic Claude** (best reasoning, safest)

### For Best Speed
→ **Groq** (fastest inference, free)

### For Best Privacy
→ **Ollama** (runs locally, free, offline-capable)

### For Best Balance
→ **OpenAI GPT-4o** (reliable, capable, ecosystem)

### For Massive Context
→ **Google Gemini** (1M tokens!)

### For Cost-Conscious Users
→ **Groq or Together AI** (free tiers). Fireworks is currently a stub.

### For Enterprise
→ **Azure OpenAI** once the stub is implemented. AWS Bedrock support has been removed.

---

## 🔄 Switching Between Providers

You can use multiple providers for different conversations:

```
Conversation 1: Anthropic Claude (high quality)
Conversation 2: Groq (fast, free)
Conversation 3: Ollama (private, local)
```

Switch providers in settings anytime. Each provider uses its own API key.

---

## 📊 Feature Comparison Table

| Provider | Streaming | Tools | Vision | Free | Local |
|----------|-----------|-------|--------|------|-------|
| Anthropic | ✅ | ✅ | ❌ | ❌ | ❌ |
| OpenAI | ✅ | ✅ | ✅ | ❌ | ❌ |
| Gemini | ✅ | ✅ | ✅ | ✅ | ❌ |
| Mistral | ✅ | ✅ | ❌ | ✅ | ❌ |
| Groq | ✅ | ✅ | ❌ | ✅ | ❌ |
| Perplexity | ✅ | ✅ | ✅ | ✅ | ❌ |
| Cohere | ✅ | ✅ | ❌ | ✅ | ❌ |
| Together | ✅ | ✅ | ❌ | ✅ | ❌ |
| HuggingFace | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Ollama** | ✅ | ❌ | ❌ | ✅ | ✅ |
| **LM Studio** | ✅ | ❌ | ❌ | ✅ | ✅ |
| DeepSeek | ✅ | ✅ | ❌ | ❌ | ❌ |
| MiniMax (Global / CN) | ✅ | ✅ | ❌ | ❌ | ❌ |
| OpenAI Codex | ✅ | ✅ | ❌ | ❌ | ❌ |
| GitHub Models | ✅ | ✅ | ❌ | ✅ | ❌ |
| xAI / xAI Grok | ✅ | ✅ | ✅ | ✅ | ❌ |
| Azure OpenAI ⚠️ stub | — | — | — | — | — |
| Fireworks ⚠️ stub | — | — | — | — | — |

---

## 🚀 Getting Started

1. **Choose a provider** based on your needs (see recommendations above)
2. **Get an API key** from their website (see PROVIDER_SETUP.md for instructions)
3. **Enter the API key** in SyntaxSenpai settings
4. **Start chatting!** Select the provider and model before sending your first message

For Ollama:
1. **Download Ollama** from https://ollama.ai/
2. **Pull a model** with `ollama pull llama2`
3. **Select Ollama** in SyntaxSenpai settings
4. **Start chatting!** No API key needed

---

## 📞 Support & Documentation

- See **PROVIDER_SETUP.md** for detailed setup instructions per provider
- See **PROVIDERS.md** (this file) for feature comparison
- Check provider's official docs for latest model information
- Most providers have Discord communities for support

---

**Total registered providers:** 20  
**Fully implemented:** 18  
**Stubs:** 2 (Azure OpenAI, Fireworks)  
**Removed:** Replicate, AWS Bedrock (PR #12)
