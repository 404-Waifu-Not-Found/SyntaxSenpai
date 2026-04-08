import type { ModelInfo } from "../types";
import { OpenAIProvider } from "./openai";

const MODELS: ModelInfo[] = [
  {
    id: "openai/gpt-4o-mini",
    displayName: "GitHub Models · GPT-4o Mini",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: "meta/Llama-3.3-70B-Instruct",
    displayName: "GitHub Models · Llama 3.3 70B",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: false,
  },
];

export class GitHubModelsProvider extends OpenAIProvider {
  constructor(options: { apiKey?: string } = {}) {
    super({
      ...options,
      id: "github-models",
      displayName: "GitHub Models",
      baseUrl: "https://models.inference.ai.azure.com",
      supportedModels: MODELS,
    });
  }
}

export function createGitHubModelsProvider(apiKey: string): GitHubModelsProvider {
  return new GitHubModelsProvider({ apiKey });
}
