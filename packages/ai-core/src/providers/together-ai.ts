/**
 * Together AI - OpenAI-compatible provider
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { OpenAICompatibleProvider, convertToOpenAIMessages } from "./base";

export class TogetherProvider extends OpenAICompatibleProvider {
  id = "together";
  displayName = "Together AI";
  baseUrl = "https://api.together.xyz/v1";

  supportedModels = [
    {
      id: "meta-llama/Llama-3.1-405B-Instruct-Turbo",
      displayName: "Llama 3.1 405B",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "meta-llama/Llama-3.1-70B-Instruct-Turbo",
      displayName: "Llama 3.1 70B",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "meta-llama/Llama-3-70B-Chat-Instruct",
      displayName: "Llama 3 70B",
      contextWindow: 8192,
      supportsTools: true,
      supportsVision: false,
    },
  ];

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Together AI provider not yet fully implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Together AI provider not yet fully implemented");
  }
}

export function createTogetherProvider(apiKey: string): TogetherProvider {
  return new TogetherProvider({ apiKey });
}
