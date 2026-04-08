/**
 * Anthropic Claude API Provider
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, ChatResponse, StreamChunk, ToolCall } from "../types";
import { BaseAIProvider, convertToAnthropicMessages } from "./base";

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
    const systemPrompt = request.systemPrompt || "";
    const messages = convertToAnthropicMessages(request.messages);

    const tools = request.tools
      ? request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        }))
      : undefined;

    const response = await this.client.messages.create({
      model: request.model || "claude-opus-4-1",
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature !== undefined ? request.temperature : 0.7,
      system: systemPrompt,
      messages: messages as any,
      tools: tools && tools.length > 0 ? (tools as any) : undefined,
    });

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

    return {
      id: response.id,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason === "tool_use" ? "tool_calls" : response.stop_reason === "end_turn" ? "stop" : "length",
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const systemPrompt = request.systemPrompt || "";
    const messages = convertToAnthropicMessages(request.messages);

    const tools = request.tools
      ? request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        }))
      : undefined;

    const stream = await this.client.messages.stream({
      model: request.model || "claude-opus-4-1",
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature !== undefined ? request.temperature : 0.7,
      system: systemPrompt,
      messages: messages as any,
      tools: tools && tools.length > 0 ? (tools as any) : undefined,
    });

    let toolBuffer = "";
    let inToolUse = false;

    for await (const event of stream) {
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
        };
      }
    }
  }
}

export function createAnthropicProvider(apiKey: string): AnthropicProvider {
  return new AnthropicProvider({ apiKey });
}
