/**
 * Perplexity AI - OpenAI-compatible provider
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { OpenAICompatibleProvider } from "./base";

export class PerplexityProvider extends OpenAICompatibleProvider {
  id = "perplexity";
  displayName = "Perplexity AI";
  baseUrl = "https://api.perplexity.ai";

  supportedModels = [
    {
      id: "llama-3.1-sonar-large-128k-online",
      displayName: "Llama 3.1 Sonar Large (Online)",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "llama-3.1-sonar-small-128k-online",
      displayName: "Llama 3.1 Sonar Small (Online)",
      contextWindow: 128000,
      supportsTools: false,
      supportsVision: false,
    },
  ];

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Perplexity provider not yet fully implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Perplexity provider not yet fully implemented");
  }
}

export function createPerplexityProvider(apiKey: string): PerplexityProvider {
  return new PerplexityProvider({ apiKey });
}
