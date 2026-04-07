/**
 * Hugging Face Inference API Provider
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { BaseAIProvider } from "./base";

export class HuggingFaceProvider extends BaseAIProvider {
  id = "huggingface";
  displayName = "Hugging Face Inference API";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = false;

  supportedModels = [
    {
      id: "meta-llama/Llama-2-70b-chat-hf",
      displayName: "Llama 2 70B Chat",
      contextWindow: 4096,
      supportsTools: false,
      supportsVision: false,
    },
    {
      id: "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO",
      displayName: "Nous Hermes 2 Mixtral",
      contextWindow: 32000,
      supportsTools: false,
      supportsVision: false,
    },
  ];

  constructor(options: { apiKey?: string } = {}) {
    super(options);
    // TODO: Initialize @huggingface/inference client
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("HuggingFace provider not yet implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("HuggingFace provider not yet implemented");
  }
}

export function createHuggingFaceProvider(apiKey: string): HuggingFaceProvider {
  return new HuggingFaceProvider({ apiKey });
}
