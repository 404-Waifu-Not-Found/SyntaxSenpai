/**
 * Together AI - OpenAI-compatible provider
 */

import type { ChatRequest, ChatResponse, StreamChunk, ToolCall } from "../types";
import { BaseAIProvider, convertToOpenAIMessages } from "./base";

export class TogetherProvider extends BaseAIProvider {
  id = "together";
  displayName = "Together AI";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = true;
  baseUrl = "https://api.together.xyz/v1";

  supportedModels = [
    {
      id: "meta-llama/Llama-3.1-405B-Instruct-Turbo",
      displayName: "Llama 3.1 405B",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "meta-llama/Llama-3.1-70B-Instruct-Turbo",
      displayName: "Llama 3.1 70B",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "meta-llama/Llama-3-70B-Chat-Instruct",
      displayName: "Llama 3 70B",
      contextWindow: 8192,
      supportsTools: true,
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
          model: request.model || "meta-llama/Llama-3.1-70B-Instruct-Turbo",
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens || 4096,
          tools: tools.length > 0 ? tools.map(t => ({ type: "function", function: t })) : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Together API error: ${response.statusText}`);
      }

      const data = await response.json();
      const toolCalls: ToolCall[] = [];
      let content = data.choices[0]?.message?.content || "";

      if (data.choices[0]?.message?.tool_calls) {
        for (const tc of data.choices[0].message.tool_calls) {
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          });
        }
      }

      return {
        id: data.id || `together_${Date.now()}`,
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        finishReason: "stop",
      };
    } catch (error) {
      throw new Error(
        `Together AI error: ${error instanceof Error ? error.message : String(error)}`
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
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model || "meta-llama/Llama-3.1-70B-Instruct-Turbo",
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens || 4096,
          stream: true,
          tools: tools.length > 0 ? tools.map(t => ({ type: "function", function: t })) : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Together API error: ${response.statusText}`);
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
        error: `Together AI streaming error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createTogetherProvider(apiKey: string): TogetherProvider {
  return new TogetherProvider({ apiKey });
}
