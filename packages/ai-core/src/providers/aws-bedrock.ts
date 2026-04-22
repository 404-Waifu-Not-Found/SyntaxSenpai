/**
 * AWS Bedrock Provider
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { BaseAIProvider } from "./base";

export class AWSBedrockProvider extends BaseAIProvider {
  id = "aws-bedrock";
  displayName = "AWS Bedrock";
  requiresApiKey = true; // AWS credentials required
  supportsStreaming = true;
  supportsToolCalling = true;

  supportedModels = [
    {
      id: "anthropic.claude-3-sonnet-20240229-v1:0",
      displayName: "Claude 3 Sonnet",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "meta.llama3-70b-instruct-v1:0",
      displayName: "Llama 3 70B",
      contextWindow: 8192,
      supportsTools: false,
      supportsVision: false,
    },
  ];

  constructor(options: { apiKey?: string } = {}) {
    super(options);
    // TODO: Initialize AWS SDK
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("AWS Bedrock provider is not yet implemented in SyntaxSenpai. Pick a different provider in Settings → AI (Anthropic, OpenAI, Groq, DeepSeek, Gemini, etc.).");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("AWS Bedrock provider is not yet implemented in SyntaxSenpai. Pick a different provider in Settings → AI (Anthropic, OpenAI, Groq, DeepSeek, Gemini, etc.).");
  }
}

export function createAWSBedrockProvider(apiKey: string): AWSBedrockProvider {
  return new AWSBedrockProvider({ apiKey });
}
