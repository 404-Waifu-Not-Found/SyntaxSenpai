/**
 * Google Gemini API Provider
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
    // TODO: Initialize @google/generative-ai client
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // TODO: Implement Gemini API call
    throw new Error("Gemini provider not yet implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    // TODO: Implement Gemini streaming
    throw new Error("Gemini provider not yet implemented");
  }
}

export function createGeminiProvider(apiKey: string): GeminiProvider {
  return new GeminiProvider({ apiKey });
}
