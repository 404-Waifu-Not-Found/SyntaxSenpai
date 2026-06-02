/**
 * Anthropic Claude API Provider
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, ChatResponse, StreamChunk, ToolCall } from "../types";
import { BaseAIProvider, convertToAnthropicMessages } from "./base";

type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: unknown;
  cache_control?: { type: "ephemeral" };
};

/**
 * Build Anthropic-shaped `system` and `tools` arrays with prompt caching markers.
 * The stable prefix gets `cache_control: ephemeral`; the last tool also gets one
 * so the entire tool-defs block is cached as part of the same prefix.
 */
function buildCachedSystem(request: ChatRequest): {
  system: string | AnthropicSystemBlock[];
  tools: AnthropicToolDef[] | undefined;
} {
  const cached = (request.cachedSystemPrompt || "").trim();
  const volatile = request.systemPrompt || "";

  const tools: AnthropicToolDef[] | undefined = request.tools && request.tools.length > 0
    ? request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))
    : undefined;

  if (!cached) {
    return { system: volatile, tools };
  }

  const blocks: AnthropicSystemBlock[] = [
    { type: "text", text: cached, cache_control: { type: "ephemeral" } },
  ];
  if (volatile) {
    blocks.push({ type: "text", text: volatile });
  }

  // Marking the last tool as cacheable extends the cache through the tool defs.
  if (tools && tools.length > 0) {
    tools[tools.length - 1].cache_control = { type: "ephemeral" };
  }

  return { system: blocks, tools };
}

export class AnthropicProvider extends BaseAIProvider {
  id = "anthropic";
  displayName = "Anthropic (Claude)";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = true;

  supportedModels = [
    {
      id: "claude-opus-4-1",
      displayName: "Claude 3.5 Opus (Latest)",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "claude-sonnet-4-20250514",
      displayName: "Claude 3.5 Sonnet",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
    },
    {
      id: "claude-haiku-4-5-20251001",
      displayName: "Claude 3.5 Haiku",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: false,
    },
  ];

  private client: Anthropic;

  constructor(options: { apiKey?: string } = {}) {
    super(options);
    this.client = new Anthropic({
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: true,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages = convertToAnthropicMessages(request.messages, request.cacheBreakpointIndex);
    const { system, tools } = buildCachedSystem(request);

    const response = await this.client.messages.create(
      {
        model: request.model || "claude-opus-4-1",
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature !== undefined ? request.temperature : 0.7,
        system: system as any,
        messages: messages as any,
        tools: tools as any,
      },
      request.signal ? { signal: request.signal } : undefined
    );

    // Parse tool calls from response
    const toolCalls: ToolCall[] = [];
    let content = "";

    for (const block of response.content) {
      if (block.type === "text") {
        content = block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    const usage = response.usage as typeof response.usage & {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };

    return {
      id: response.id,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens,
        totalTokens: usage.input_tokens + usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens,
        cacheReadInputTokens: usage.cache_read_input_tokens,
      },
      finishReason: response.stop_reason === "tool_use" ? "tool_calls" : response.stop_reason === "end_turn" ? "stop" : "length",
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const messages = convertToAnthropicMessages(request.messages, request.cacheBreakpointIndex);
    const { system, tools } = buildCachedSystem(request);

    const stream = await this.client.messages.stream(
      {
        model: request.model || "claude-opus-4-1",
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature !== undefined ? request.temperature : 0.7,
        system: system as any,
        messages: messages as any,
        tools: tools as any,
      },
      request.signal ? { signal: request.signal } : undefined
    );

    let toolBuffer = "";
    let inToolUse = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationInputTokens: number | undefined;
    let cacheReadInputTokens: number | undefined;

    for await (const event of stream) {
      if (event.type === "message_start") {
        const u = (event as any).message?.usage;
        if (u) {
          inputTokens = u.input_tokens ?? 0;
          outputTokens = u.output_tokens ?? outputTokens;
          cacheCreationInputTokens = u.cache_creation_input_tokens ?? cacheCreationInputTokens;
          cacheReadInputTokens = u.cache_read_input_tokens ?? cacheReadInputTokens;
        }
      } else if (event.type === "message_delta") {
        const u = (event as any).usage;
        if (u && typeof u.output_tokens === "number") outputTokens = u.output_tokens;
      }
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield {
            type: "text_delta",
            delta: event.delta.text,
          };
        } else if ((event.delta as any).type === "input_json_delta") {
          toolBuffer += (event.delta as any).input_json;
        }
      } else if (event.type === "content_block_start") {
        if ((event as any).content_block?.type === "tool_use") {
          inToolUse = true;
          toolBuffer = "";
        }
      } else if (event.type === "content_block_stop") {
        if (inToolUse) {
          try {
            const parsed = JSON.parse(toolBuffer);
            yield {
              type: "tool_call_delta",
              toolCall: {
                id: `tool_${Date.now()}`,
                name: ((event as any).content_block?.name as string) || "unknown",
                arguments: parsed,
              },
            };
          } catch (e) {
            // JSON parsing failed, skip
          }
          inToolUse = false;
          toolBuffer = "";
        }
      } else if (event.type === "message_stop") {
        yield {
          type: "done",
          usage: {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
            cacheCreationInputTokens,
            cacheReadInputTokens,
          },
        };
      }
    }
  }
}

export function createAnthropicProvider(apiKey: string): AnthropicProvider {
  return new AnthropicProvider({ apiKey });
}

// Exposed for unit tests.
export const __testing = { buildCachedSystem };
