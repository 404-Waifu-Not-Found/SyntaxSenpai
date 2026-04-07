/**
 * Groq - OpenAI-compatible provider (fast inference)
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { OpenAICompatibleProvider } from "./base";

export class GroqProvider extends OpenAICompatibleProvider {
  id = "groq";
  displayName = "Groq (Fast Inference)";
  baseUrl = "https://api.groq.com/openai/v1";

  supportedModels = [
    {
      id: "mixtral-8x7b-32768",
      displayName: "Mixtral 8x7B",
      contextWindow: 32768,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "llama-3.1-70b-versatile",
      displayName: "Llama 3.1 70B",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "llama-3.1-8b-instant",
      displayName: "Llama 3.1 8B",
      contextWindow: 128000,
      supportsTools: false,
      supportsVision: false,
    },
  ];

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Groq provider not yet fully implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Groq provider not yet fully implemented");
  }
}

export function createGroqProvider(apiKey: string): GroqProvider {
  return new GroqProvider({ apiKey });
}
