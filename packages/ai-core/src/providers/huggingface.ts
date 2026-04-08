import type { ModelInfo } from "../types";
import { OpenAIProvider } from "./openai";

const MODELS: ModelInfo[] = [
  {
    id: "meta-llama/Llama-3.3-70B-Instruct",
    displayName: "Llama 3.3 70B Instruct",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "Qwen/Qwen2.5-Coder-32B-Instruct",
    displayName: "Qwen 2.5 Coder 32B",
    contextWindow: 32768,
    supportsTools: true,
    supportsVision: false,
  },
];

export class HuggingFaceProvider extends OpenAIProvider {
  constructor(options: { apiKey?: string } = {}) {
    super({
      ...options,
      id: "huggingface",
      displayName: "Hugging Face",
      baseUrl: "https://router.huggingface.co/v1",
      supportedModels: MODELS,
    });
  }
}

export function createHuggingFaceProvider(apiKey: string): HuggingFaceProvider {
  return new HuggingFaceProvider({ apiKey });
}
