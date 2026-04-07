/**
 * Fireworks AI - OpenAI-compatible provider
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { OpenAICompatibleProvider } from "./base";

export class FireworksProvider extends OpenAICompatibleProvider {
  id = "fireworks";
  displayName = "Fireworks AI";
  baseUrl = "https://api.fireworks.ai/inference/v1";

  supportedModels = [
    {
      id: "accounts/fireworks/models/llama-v3-70b-instruct",
      displayName: "Llama 3 70B Instruct",
      contextWindow: 8192,
      supportsTools: false,
      supportsVision: false,
    },
    {
      id: "accounts/fireworks/models/mixtral-8x7b-instruct",
      displayName: "Mixtral 8x7B",
      contextWindow: 32768,
      supportsTools: false,
      supportsVision: false,
    },
  ];

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Fireworks AI provider not yet fully implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Fireworks AI provider not yet fully implemented");
  }
}

export function createFireworksProvider(apiKey: string): FireworksProvider {
  return new FireworksProvider({ apiKey });
}
