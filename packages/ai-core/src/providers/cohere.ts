/**
 * Cohere API Provider
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
    // TODO: Initialize cohere-ai client
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Cohere provider not yet implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Cohere provider not yet implemented");
  }
}

export function createCohereProvider(apiKey: string): CohereProvider {
  return new CohereProvider({ apiKey });
}
