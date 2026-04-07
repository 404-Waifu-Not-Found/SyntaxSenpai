/**
 * Google Gemini API Provider (Stub - TODO: Implement)
 * https://ai.google.dev
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { BaseAIProvider } from "./base";

export class GeminiProvider extends BaseAIProvider {
  id = "gemini";
  displayName = "Google Gemini";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = true;

  supportedModels = [
    {
      id: "gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      contextWindow: 1000000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "gemini-1.5-pro",
      displayName: "Gemini 1.5 Pro",
      contextWindow: 2000000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "gemini-1.5-flash",
      displayName: "Gemini 1.5 Flash",
      contextWindow: 1000000,
      supportsTools: true,
      supportsVision: true,
    },
  ];

  constructor(options: { apiKey?: string } = {}) {
    super(options);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Gemini provider: Use Anthropic or OpenAI for now");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Gemini provider: Use Anthropic or OpenAI for now");
  }
}

export function createGeminiProvider(apiKey: string): GeminiProvider {
  return new GeminiProvider({ apiKey });
}
