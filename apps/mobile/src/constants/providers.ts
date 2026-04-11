export interface ProviderModelOption {
  id: string;
  label: string;
}

export interface ProviderOption {
  id: string;
  label: string;
  models: ProviderModelOption[];
}

export const PROVIDERS_WITH_MODELS: ProviderOption[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
      { id: "gpt-4", label: "GPT-4" },
    ],
  },
  {
    id: "openai-codex",
    label: "OpenAI (Codex / Web Auth)",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    models: [
      { id: "mistral-large-latest", label: "Mistral Large" },
      { id: "mistral-medium-latest", label: "Mistral Medium" },
      { id: "mistral-small-latest", label: "Mistral Small" },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    models: [
      { id: "llama-3.1-70b-versatile", label: "Llama 3.1 70B" },
      { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B" },
    ],
  },
  {
    id: "minimax-global",
    label: "MiniMax Global",
    models: [
      { id: "MiniMax-Text-01", label: "MiniMax Text 01" },
      { id: "MiniMax-M1", label: "MiniMax M1" },
    ],
  },
  {
    id: "minimax-cn",
    label: "MiniMax CN",
    models: [
      { id: "MiniMax-Text-01", label: "MiniMax Text 01 (CN)" },
      { id: "MiniMax-M1", label: "MiniMax M1 (CN)" },
    ],
  },
  {
    id: "xai",
    label: "xAI",
    models: [
      { id: "grok-2-latest", label: "Grok 2" },
      { id: "grok-vision-beta", label: "Grok Vision" },
    ],
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B Instruct" },
      { id: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B" },
    ],
  },
  {
    id: "github-models",
    label: "GitHub Models",
    models: [
      { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
      { id: "meta/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B" },
    ],
  },
  {
    id: "together",
    label: "Together AI",
    models: [
      { id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", label: "Llama 3.1 70B Turbo" },
      { id: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B" },
      { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", label: "Mixtral 8x7B Instruct" },
    ],
  },
];

export const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: "claude-opus-4-1",
  openai: "gpt-4o",
  "openai-codex": "gpt-4o",
  deepseek: "deepseek-chat",
  gemini: "gemini-2.0-flash",
  mistral: "mistral-large-latest",
  groq: "llama-3.1-70b-versatile",
  "minimax-global": "MiniMax-Text-01",
  "minimax-cn": "MiniMax-Text-01",
  xai: "grok-2-latest",
  "xai-grok": "grok-2-latest",
  huggingface: "meta-llama/Llama-3.3-70B-Instruct",
  "github-models": "openai/gpt-4o-mini",
  together: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
};

export function getProviderById(providerId: string) {
  return PROVIDERS_WITH_MODELS.find((provider) => provider.id === providerId);
}
