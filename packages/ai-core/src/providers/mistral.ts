/**
 * Mistral AI API Provider
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { BaseAIProvider } from "./base";

export class MistralProvider extends BaseAIProvider {
  id = "mistral";
  displayName = "Mistral AI";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = true;

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
    // TODO: Initialize @mistralai/mistralai client
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Mistral provider not yet implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Mistral provider not yet implemented");
  }
}

export function createMistralProvider(apiKey: string): MistralProvider {
  return new MistralProvider({ apiKey });
}
