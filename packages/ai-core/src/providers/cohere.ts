/**
 * Cohere API Provider (Stub - TODO: Implement)
 * https://docs.cohere.com
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { BaseAIProvider } from "./base";

export class CohereProvider extends BaseAIProvider {
  id = "cohere";
  displayName = "Cohere";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = true;

  supportedModels = [
    {
      id: "command-r-plus",
      displayName: "Command R Plus",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "command-r",
      displayName: "Command R",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
  ];

  constructor(options: { apiKey?: string } = {}) {
    super(options);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Cohere provider: Use Anthropic or OpenAI for now");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Cohere provider: Use Anthropic or OpenAI for now");
  }
}

export function createCohereProvider(apiKey: string): CohereProvider {
  return new CohereProvider({ apiKey });
}
