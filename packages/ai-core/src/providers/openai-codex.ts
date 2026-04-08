import type { ModelInfo } from "../types";
import { OpenAIProvider } from "./openai";

const MODELS: ModelInfo[] = [
  {
    id: "gpt-4o",
    displayName: "GPT-4o",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: "gpt-4-turbo",
    displayName: "GPT-4 Turbo",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: true,
  },
];

export class OpenAICodexProvider extends OpenAIProvider {
  constructor(options: { apiKey?: string } = {}) {
    super({
      ...options,
      id: "openai-codex",
      displayName: "OpenAI (Codex / Web Auth)",
      baseUrl: "https://api.openai.com/v1",
      supportedModels: MODELS,
    });
  }
}

export function createOpenAICodexProvider(apiKey: string): OpenAICodexProvider {
  return new OpenAICodexProvider({ apiKey });
}
