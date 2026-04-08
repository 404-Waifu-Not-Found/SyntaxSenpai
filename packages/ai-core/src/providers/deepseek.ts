import type { ModelInfo } from "../types";
import { OpenAIProvider } from "./openai";

const MODELS: ModelInfo[] = [
  {
    id: "deepseek-chat",
    displayName: "DeepSeek Chat",
    contextWindow: 64000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "deepseek-reasoner",
    displayName: "DeepSeek Reasoner",
    contextWindow: 64000,
    supportsTools: true,
    supportsVision: false,
  },
];

export class DeepSeekProvider extends OpenAIProvider {
  constructor(options: { apiKey?: string } = {}) {
    super({
      ...options,
      id: "deepseek",
      displayName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      supportedModels: MODELS,
    });
  }
}

export function createDeepSeekProvider(apiKey: string): DeepSeekProvider {
  return new DeepSeekProvider({ apiKey });
}
