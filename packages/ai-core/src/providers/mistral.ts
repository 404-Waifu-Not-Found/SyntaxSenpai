/**
 * Mistral AI API Provider
 * OpenAI-compatible API
 * https://docs.mistral.ai
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { OpenAICompatibleProvider } from "./base";

export class MistralProvider extends OpenAICompatibleProvider {
  id = "mistral";
  displayName = "Mistral AI";
  baseURL = "https://api.mistral.ai/v1";

  supportedModels = [
    {
      id: "mistral-large-latest",
      displayName: "Mistral Large (Latest)",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "mistral-medium-latest",
      displayName: "Mistral Medium",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "mistral-small-latest",
      displayName: "Mistral Small",
      contextWindow: 32000,
      supportsTools: true,
      supportsVision: false,
    },
  ];

  constructor(options: { apiKey?: string } = {}) {
    super(options);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model || "mistral-small-latest";
    return super.chat(request);
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const model = request.model || "mistral-small-latest";
    yield* super.stream(request);
  }
}

export function createMistralProvider(apiKey: string): MistralProvider {
  return new MistralProvider({ apiKey });
}
