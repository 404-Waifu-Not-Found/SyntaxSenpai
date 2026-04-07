/**
 * Ollama - Local LLM Provider (self-hosted)
 */

import type { ChatRequest, ChatResponse, StreamChunk } from "../types";
import { BaseAIProvider, convertToOpenAIMessages } from "./base";

export class OllamaProvider extends BaseAIProvider {
  id = "ollama";
  displayName = "Ollama (Local/Self-Hosted)";
  requiresApiKey = false; // Local, no key needed
  supportsStreaming = true;
  supportsToolCalling = false;

  supportedModels = [
    {
      id: "llama2",
      displayName: "Llama 2",
      contextWindow: 4096,
      supportsTools: false,
      supportsVision: false,
    },
    {
      id: "mistral",
      displayName: "Mistral",
      contextWindow: 8192,
      supportsTools: false,
      supportsVision: false,
    },
    {
      id: "neural-chat",
      displayName: "Neural Chat",
      contextWindow: 4096,
      supportsTools: false,
      supportsVision: false,
    },
  ];

  constructor(options: { baseUrl?: string } = {}) {
    super(options);
    // Ollama defaults to localhost:11434 but can be pointed to remote instance
    this.baseUrl = options.baseUrl || "http://localhost:11434";
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages = convertToOpenAIMessages(this.buildMessages(request));

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model || "llama2",
          messages,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        id: `ollama_${Date.now()}`,
        content: data.message?.content || "",
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        finishReason: "stop",
      };
    } catch (error) {
      throw new Error(
        `Ollama provider error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const messages = convertToOpenAIMessages(this.buildMessages(request));

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model || "llama2",
          messages,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body from Ollama");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines[lines.length - 1]; // Keep incomplete line

        for (const line of lines.slice(0, -1)) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              if (data.message?.content) {
                yield {
                  type: "text_delta",
                  delta: data.message.content,
                };
              }
              if (data.done) {
                yield { type: "done" };
              }
            } catch (e) {
              // Invalid JSON, skip
            }
          }
        }
      }
    } catch (error) {
      yield {
        type: "error",
        error: `Ollama streaming error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createOllamaProvider(baseUrl?: string): OllamaProvider {
  return new OllamaProvider({ baseUrl });
}
