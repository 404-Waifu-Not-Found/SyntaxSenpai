/**
 * LM Studio - Local OpenAI-compatible provider
 */

import type { ChatRequest, ChatResponse, StreamChunk, ToolCall } from "../types";
import { BaseAIProvider, convertToOpenAIMessages } from "./base";

export class LMStudioProvider extends BaseAIProvider {
  id = "lmstudio";
  displayName = "LM Studio (Local)";
  requiresApiKey = false;
  supportsStreaming = true;
  supportsToolCalling = true;
  baseUrl = "http://127.0.0.1:1234/v1";

  supportedModels = [
    {
      id: "local-model",
      displayName: "Detected Local Model",
      contextWindow: 8192,
      supportsTools: true,
      supportsVision: false,
    },
  ];

  constructor(options: { baseUrl?: string; apiKey?: string } = {}) {
    super(options);
    this.baseUrl = options.baseUrl || this.baseUrl;
    this.apiKey = options.apiKey;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages = convertToOpenAIMessages(this.buildMessages(request));
    const tools = this.getToolDefinitions(request.tools);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: request.model || "local-model",
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens || 4096,
          tools: tools.length > 0 ? tools.map((tool) => ({ type: "function", function: tool })) : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const toolCalls: ToolCall[] = [];
      const content = data.choices?.[0]?.message?.content || "";

      if (Array.isArray(data.choices?.[0]?.message?.tool_calls)) {
        for (const tc of data.choices[0].message.tool_calls) {
          if (tc?.function?.name) {
            toolCalls.push({
              id: tc.id || `call_${Date.now()}`,
              name: tc.function.name,
              arguments:
                typeof tc.function.arguments === "string"
                  ? JSON.parse(tc.function.arguments || "{}")
                  : tc.function.arguments || {},
            });
          }
        }
      }

      return {
        id: data.id || `lmstudio_${Date.now()}`,
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        finishReason:
          data.choices?.[0]?.finish_reason === "tool_calls"
            ? "tool_calls"
            : data.choices?.[0]?.finish_reason === "length"
              ? "length"
              : "stop",
      };
    } catch (error) {
      throw new Error(
        `LM Studio error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const messages = convertToOpenAIMessages(this.buildMessages(request));
    const tools = this.getToolDefinitions(request.tools);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: request.model || "local-model",
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens || 4096,
          stream: true,
          tools: tools.length > 0 ? tools.map((tool) => ({ type: "function", function: tool })) : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body from LM Studio");
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
          if (!line.startsWith("data: ")) continue;

          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            yield { type: "done" };
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.choices?.[0]?.delta?.content) {
              yield {
                type: "text_delta",
                delta: parsed.choices[0].delta.content,
              };
            }
          } catch {
            // Skip invalid chunk
          }
        }
      }
    } catch (error) {
      yield {
        type: "error",
        error: `LM Studio streaming error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createLMStudioProvider(baseUrl?: string, apiKey?: string): LMStudioProvider {
  return new LMStudioProvider({ baseUrl, apiKey });
}
