/**
 * Azure OpenAI Provider
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { OpenAICompatibleProvider } from "./base";

export class AzureOpenAIProvider extends OpenAICompatibleProvider {
  id = "azure-openai";
  displayName = "Azure OpenAI";

  supportedModels = [
    {
      id: "gpt-4o",
      displayName: "GPT-4o",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "gpt-4-turbo",
      displayName: "GPT-4 Turbo",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
    },
  ];

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    super(options);
    // Azure requires resource name in base URL
    if (!this.baseUrl) {
      throw new Error("Azure OpenAI requires baseUrl with your resource name");
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Azure OpenAI provider not yet fully implemented");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Azure OpenAI provider not yet fully implemented");
  }
}

export function createAzureOpenAIProvider(
  apiKey: string,
  resourceName: string
): AzureOpenAIProvider {
  const baseUrl = `https://${resourceName}.openai.azure.com/v1`;
  return new AzureOpenAIProvider({ apiKey, baseUrl });
}
