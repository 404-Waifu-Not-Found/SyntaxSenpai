/**
 * Perplexity AI - OpenAI-compatible provider
 */

import type { ChatRequest, ChatResponse, StreamChunk, ToolCall } from "../types";
import { BaseAIProvider, convertToOpenAIMessages, formatFetchError } from "./base";

export class PerplexityProvider extends BaseAIProvider {
  id = "perplexity";
  displayName = "Perplexity AI";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = true;
  baseUrl = "https://api.perplexity.ai";

  supportedModels = [
    {
      id: "llama-3.1-sonar-large-128k-online",
      displayName: "Llama 3.1 Sonar Large (Online)",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "llama-3.1-sonar-small-128k-online",
      displayName: "Llama 3.1 Sonar Small (Online)",
      contextWindow: 128000,
      supportsTools: false,
      supportsVision: false,
    },
  ];

  constructor(options: { apiKey?: string } = {}) {
    super(options);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages = convertToOpenAIMessages(this.buildMessages(request));
    const tools = this.getToolDefinitions(request.tools);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || "llama-3.1-sonar-large-128k-online",
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens || 4096,
        }),
      });

      if (!response.ok) {
        throw new Error(await formatFetchError("Perplexity", response));
      }

      const data = await response.json();
      return {
        id: data.id || `perplexity_${Date.now()}`,
        content: data.choices[0]?.message?.content || "",
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        finishReason: "stop",
      };
    } catch (error) {
      throw new Error(
        `Perplexity error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const messages = convertToOpenAIMessages(this.buildMessages(request));

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || "llama-3.1-sonar-large-128k-online",
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens || 4096,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(await formatFetchError("Perplexity", response));
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines[lines.length - 1];

        for (const line of lines.slice(0, -1)) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              yield { type: "done" };
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices[0]?.delta?.content) {
                yield {
                  type: "text_delta",
                  delta: parsed.choices[0].delta.content,
                };
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      yield {
        type: "error",
        error: `Perplexity streaming error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createPerplexityProvider(apiKey: string): PerplexityProvider {
  return new PerplexityProvider({ apiKey });
}
