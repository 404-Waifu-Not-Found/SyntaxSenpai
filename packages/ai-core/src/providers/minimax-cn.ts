import type { ModelInfo } from "../types";
import { OpenAIProvider } from "./openai";

const MODELS: ModelInfo[] = [
  {
    id: "MiniMax-Text-01",
    displayName: "MiniMax Text 01 (CN)",
    contextWindow: 1000000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "MiniMax-M1",
    displayName: "MiniMax M1 (CN)",
    contextWindow: 1000000,
    supportsTools: true,
    supportsVision: false,
  },
];

export class MiniMaxCNProvider extends OpenAIProvider {
  constructor(options: { apiKey?: string } = {}) {
    super({
      ...options,
      id: "minimax-cn",
      displayName: "MiniMax CN",
      baseUrl: "https://api.minimaxi.com/v1",
      supportedModels: MODELS,
    });
  }
}

export function createMiniMaxCNProvider(apiKey: string): MiniMaxCNProvider {
  return new MiniMaxCNProvider({ apiKey });
}
