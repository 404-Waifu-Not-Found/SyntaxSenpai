/**
 * xAI Grok - OpenAI-compatible provider
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { OpenAICompatibleProvider } from "./base";

export class XAIGrokProvider extends OpenAICompatibleProvider {
  id = "xai-grok";
  displayName = "xAI Grok";
  baseUrl = "https://api.x.ai/v1";

  supportedModels = [
    {
      id: "grok-2-latest",
      displayName: "Grok 2 (Latest)",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "grok-vision-beta",
      displayName: "Grok Vision Beta",
      contextWindow: 128000,
      supportsTools: false,
      supportsVision: true,
    },
  ];

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("xAI Grok provider not yet fully implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("xAI Grok provider not yet fully implemented");
  }
}

export function createXAIGrokProvider(apiKey: string): XAIGrokProvider {
  return new XAIGrokProvider({ apiKey });
}
