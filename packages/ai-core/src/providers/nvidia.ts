/**
 * NVIDIA NIM (build.nvidia.com) - OpenAI-compatible provider
 *
 * Hosted inference for open models via https://integrate.api.nvidia.com/v1.
 * Get an API key (nvapi-...) at https://build.nvidia.com/.
 */

import type { ModelInfo } from "../types";
import { OpenAIProvider } from "./openai";

const MODELS: ModelInfo[] = [
  {
    id: "meta/llama-3.3-70b-instruct",
    displayName: "Llama 3.3 70B Instruct",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    displayName: "Nemotron Super 49B v1.5",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "qwen/qwen3-coder-480b-a35b-instruct",
    displayName: "Qwen3 Coder 480B",
    contextWindow: 256000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "openai/gpt-oss-20b",
    displayName: "GPT-OSS 20B",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "moonshotai/kimi-k2.6",
    displayName: "Kimi K2.6",
    contextWindow: 256000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "meta/llama-3.1-8b-instruct",
    displayName: "Llama 3.1 8B (Fast)",
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: false,
  },
];

export class NvidiaProvider extends OpenAIProvider {
  constructor(options: { apiKey?: string } = {}) {
    super({
      ...options,
      id: "nvidia",
      displayName: "NVIDIA NIM",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      supportedModels: MODELS,
    });
  }
}

export function createNvidiaProvider(apiKey: string): NvidiaProvider {
  return new NvidiaProvider({ apiKey });
}
