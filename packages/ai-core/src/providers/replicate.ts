/**
 * Replicate API Provider
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { BaseAIProvider } from "./base";

export class ReplicateProvider extends BaseAIProvider {
  id = "replicate";
  displayName = "Replicate";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = false;

  supportedModels = [
    {
      id: "meta/llama-2-70b-chat",
      displayName: "Llama 2 70B Chat",
      contextWindow: 4096,
      supportsTools: false,
      supportsVision: false,
    },
    {
      id: "meta/llama-3-70b-instruct",
      displayName: "Llama 3 70B Instruct",
      contextWindow: 8192,
      supportsTools: false,
      supportsVision: false,
    },
  ];

  constructor(options: { apiKey?: string } = {}) {
    super(options);
    // TODO: Initialize replicate client
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Replicate provider not yet implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Replicate provider not yet implemented");
  }
}

export function createReplicateProvider(apiKey: string): ReplicateProvider {
  return new ReplicateProvider({ apiKey });
}
