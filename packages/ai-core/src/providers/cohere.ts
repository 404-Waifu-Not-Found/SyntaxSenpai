/**
 * Cohere API Provider
 * Uses the /v1/chat endpoint with Cohere's native message format.
 */

import type { ChatRequest, ChatResponse, StreamChunk, ToolCall } from "../types";
import { BaseAIProvider, formatFetchError } from "./base";

const COHERE_BASE_URL = "https://api.cohere.com/v1";

export class CohereProvider extends BaseAIProvider {
  id = "cohere";
  displayName = "Cohere";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = true;

  supportedModels = [
    {
      id: "command-r-plus",
      displayName: "Command R Plus",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "command-r",
      displayName: "Command R",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "command-a-03-2025",
      displayName: "Command A",
      contextWindow: 256000,
      supportsTools: true,
      supportsVision: false,
    },
  ];

  constructor(options: { apiKey?: string } = {}) {
    super(options);
  }

  private buildCoherePayload(request: ChatRequest): Record<string, unknown> {
    const msgs = this.buildMessages(request);
    let preamble: string | undefined;
    const history: Array<{ role: string; message: string }> = [];
    let currentMessage = "";

    for (const msg of msgs) {
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      if (msg.role === "system") {
        preamble = text;
      } else if (msg.role === "user") {
        currentMessage = text;
        // If there were already user messages, push the previous turn to history
        if (history.length > 0 || currentMessage !== text) {
          // Will be corrected below — we iterate sequentially so this is fine
        }
      } else if (msg.role === "assistant") {
        history.push({ role: "CHATBOT", message: text });
      }
    }

    // Rebuild properly: everything except the last user message goes into history
    const chatHistory: Array<{ role: string; message: string }> = [];
    let lastUserMessage = "";
    for (const msg of msgs) {
      if (msg.role === "system") continue;
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      if (msg.role === "user") {
        if (lastUserMessage) {
          chatHistory.push({ role: "USER", message: lastUserMessage });
        }
        lastUserMessage = text;
      } else if (msg.role === "assistant") {
        if (lastUserMessage) {
          chatHistory.push({ role: "USER", message: lastUserMessage });
          lastUserMessage = "";
        }
        chatHistory.push({ role: "CHATBOT", message: text });
      }
    }

    const tools = this.getToolDefinitions(request.tools);
    const cohereTools = tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      parameter_definitions: Object.entries(
        (t.parameters?.properties as Record<string, { type?: string; description?: string }>) ?? {}
      ).reduce<Record<string, { type: string; description: string; required: boolean }>>((acc, [k, v]) => {
        acc[k] = {
          type: v.type || "string",
          description: v.description || "",
          required: Array.isArray(t.parameters?.required) && t.parameters!.required.includes(k),
        };
        return acc;
      }, {}),
    }));

    return {
      model: request.model || "command-r-plus",
      message: lastUserMessage || "",
      chat_history: chatHistory.length > 0 ? chatHistory : undefined,
      preamble: preamble || undefined,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens || 4096,
      tools: cohereTools.length > 0 ? cohereTools : undefined,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const payload = this.buildCoherePayload(request);
      const response = await fetch(`${COHERE_BASE_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Client-Name": "syntax-senpai",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await formatFetchError("Cohere", response));
      }

      const data = await response.json();
      const toolCalls: ToolCall[] = [];

      if (Array.isArray(data.tool_calls)) {
        for (const tc of data.tool_calls) {
          toolCalls.push({
            id: `cohere_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: tc.name,
            arguments: tc.parameters || {},
          });
        }
      }

      return {
        id: data.generation_id || `cohere_${Date.now()}`,
        content: data.text || "",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          promptTokens: data.meta?.billed_units?.input_tokens || 0,
          completionTokens: data.meta?.billed_units?.output_tokens || 0,
          totalTokens:
            (data.meta?.billed_units?.input_tokens || 0) +
            (data.meta?.billed_units?.output_tokens || 0),
        },
        finishReason: data.finish_reason === "COMPLETE" ? "stop" : (data.finish_reason || "stop"),
      };
    } catch (error) {
      throw new Error(
        `Cohere error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    try {
      const payload = { ...this.buildCoherePayload(request), stream: true };
      const response = await fetch(`${COHERE_BASE_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Client-Name": "syntax-senpai",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await formatFetchError("Cohere", response));
      }

      if (!response.body) throw new Error("No response body");

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
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.event_type === "text-generation" && parsed.text) {
              yield { type: "text_delta", delta: parsed.text };
            } else if (parsed.event_type === "stream-end") {
              yield { type: "done" };
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      yield { type: "done" };
    } catch (error) {
      yield {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function createCohereProvider(apiKey: string): CohereProvider {
  return new CohereProvider({ apiKey });
}
