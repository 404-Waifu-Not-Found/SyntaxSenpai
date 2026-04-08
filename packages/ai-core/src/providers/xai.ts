import type { ModelInfo } from "../types";
import { OpenAIProvider } from "./openai";

const MODELS: ModelInfo[] = [
  {
    id: "grok-2-latest",
    displayName: "Grok 2",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: "grok-vision-beta",
    displayName: "Grok Vision",
    contextWindow: 128000,
    supportsTools: false,
    supportsVision: true,
  },
];

export class XAIProvider extends OpenAIProvider {
  constructor(options: { apiKey?: string } = {}) {
    super({
      ...options,
      id: "xai",
      displayName: "xAI",
      baseUrl: "https://api.x.ai/v1",
      supportedModels: MODELS,
    });
  }
}

export function createXAIProvider(apiKey: string): XAIProvider {
  return new XAIProvider({ apiKey });
}
