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
        signal: request.signal,
      });

      if (!response.ok) {
        throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const toolCalls: ToolCall[] = [];
      const content = data.choices?.[0]?.message?.content || "";
      const reasoningContent = data.choices?.[0]?.message?.reasoning_content || undefined;

      if (Array.isArray(data.choices?.[0]?.message?.tool_calls)) {
        for (const tc of data.choices[0].message.tool_calls) {
          if (tc?.function?.name) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs =
                typeof tc.function.arguments === "string"
                  ? JSON.parse(tc.function.arguments || "{}")
                  : tc.function.arguments || {};
            } catch {
              parsedArgs = { _raw: String(tc.function.arguments ?? "") };
            }
            toolCalls.push({
              id: tc.id || `call_${Date.now()}_${toolCalls.length}`,
              name: tc.function.name,
              arguments: parsedArgs,
            });
          }
        }
      }

      return {
        id: data.id || `lmstudio_${Date.now()}`,
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        reasoningContent: reasoningContent || undefined,
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

    // Buffer tool-call fragments by `index` and emit complete tool_call_delta
    // chunks once finish_reason fires. LM Studio (OpenAI-compatible) splits
    // function.arguments across many chunks as partial JSON.
    const toolCallBuffers = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    let nextSyntheticIndex = 0;

    const flushToolCalls = function* (): Generator<StreamChunk> {
      if (toolCallBuffers.size === 0) return;
      const sorted = Array.from(toolCallBuffers.entries()).sort(
        ([a], [b]) => a - b
      );
      for (const [, buf] of sorted) {
        let parsedArgs: Record<string, unknown> = {};
        if (buf.args) {
          try {
            parsedArgs = JSON.parse(buf.args);
          } catch {
            parsedArgs = { _raw: buf.args };
          }
        }
        yield {
          type: "tool_call_delta",
          toolCall: {
            id: buf.id || `call_${Date.now()}`,
            name: buf.name,
            arguments: parsedArgs,
          },
        };
      }
      toolCallBuffers.clear();
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
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
        signal: request.signal,
      });
    } catch (error) {
      yield {
        type: "error",
        error: `LM Studio streaming error: ${error instanceof Error ? error.message : String(error)}`,
      };
      return;
    }

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        /* ignore */
      }
      yield {
        type: "error",
        error: `LM Studio API error: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 400)}` : ""}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", error: "No response body from LM Studio" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let doneEmitted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines[lines.length - 1];

        for (const line of lines.slice(0, -1)) {
          const trimmed = line.replace(/\r$/, "");
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") {
            yield* flushToolCalls();
            yield { type: "done" };
            doneEmitted = true;
            continue;
          }

          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            yield {
              type: "reasoning_delta",
              delta: delta.reasoning_content,
            };
          }
          if (delta?.content) {
            yield {
              type: "text_delta",
              delta: delta.content,
            };
          }

          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              if (!tc?.function && typeof tc?.index !== "number" && !tc?.id) {
                continue;
              }
              const idx =
                typeof tc.index === "number" ? tc.index : nextSyntheticIndex++;
              const buf = toolCallBuffers.get(idx) || { id: "", name: "", args: "" };
              if (tc.id) buf.id = tc.id;
              if (tc.function?.name) buf.name = tc.function.name;
              if (typeof tc.function?.arguments === "string") {
                buf.args += tc.function.arguments;
              }
              toolCallBuffers.set(idx, buf);
            }
          }

          if (parsed.choices?.[0]?.finish_reason) {
            yield* flushToolCalls();
            if (!doneEmitted) {
              yield { type: "done" };
              doneEmitted = true;
            }
          }
        }
      }
    } catch (error) {
      // Abort signals raise an error; surface cleanly rather than logging noisy.
      const msg = error instanceof Error ? error.message : String(error);
      if (request.signal?.aborted) {
        yield* flushToolCalls();
        if (!doneEmitted) yield { type: "done" };
        return;
      }
      yield {
        type: "error",
        error: `LM Studio streaming error: ${msg}`,
      };
      return;
    }

    // Stream closed without [DONE] or finish_reason — flush pending tool calls.
    yield* flushToolCalls();
    if (!doneEmitted) yield { type: "done" };
  }
}

export function createLMStudioProvider(baseUrl?: string, apiKey?: string): LMStudioProvider {
  return new LMStudioProvider({ baseUrl, apiKey });
}
