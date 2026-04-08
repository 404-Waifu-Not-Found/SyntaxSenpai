import type { ModelInfo } from "../types";
import { OpenAIProvider } from "./openai";

const MODELS: ModelInfo[] = [
  {
    id: "MiniMax-Text-01",
    displayName: "MiniMax Text 01",
    contextWindow: 1000000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "MiniMax-M1",
    displayName: "MiniMax M1",
    contextWindow: 1000000,
    supportsTools: true,
    supportsVision: false,
  },
];

export class MiniMaxGlobalProvider extends OpenAIProvider {
  constructor(options: { apiKey?: string } = {}) {
    super({
      ...options,
      id: "minimax-global",
      displayName: "MiniMax Global",
      baseUrl: "https://api.minimax.io/v1",
      supportedModels: MODELS,
    });
  }
}

export function createMiniMaxGlobalProvider(apiKey: string): MiniMaxGlobalProvider {
  return new MiniMaxGlobalProvider({ apiKey });
}
