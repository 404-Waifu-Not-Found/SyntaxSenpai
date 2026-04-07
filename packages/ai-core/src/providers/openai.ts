/**
 * OpenAI GPT API Provider
 */

import OpenAI from "openai";
import type { ChatRequest, ChatResponse, StreamChunk, ToolCall } from "../types";
import { OpenAICompatibleProvider, convertToOpenAIMessages } from "./base";

export class OpenAIProvider extends OpenAICompatibleProvider {
  id = "openai";
  displayName = "OpenAI (GPT-4o)";

  supportedModels = [
    {
      id: "gpt-4o",
      displayName: "GPT-4o (Latest)",
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
    {
      id: "gpt-4",
      displayName: "GPT-4",
      contextWindow: 8192,
      supportsTools: true,
      supportsVision: false,
    },
    {
      id: "gpt-3.5-turbo",
      displayName: "GPT-3.5 Turbo",
      contextWindow: 16384,
      supportsTools: true,
      supportsVision: false,
    },
  ];

  private client: OpenAI;

  constructor(options: { apiKey?: string } = {}) {
    super(options);
    this.client = new OpenAI({
      apiKey: this.apiKey,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages = convertToOpenAIMessages(this.buildMessages(request));

    const tools = request.tools
      ? request.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined;

    const response = await this.client.chat.completions.create({
      model: request.model || "gpt-4o",
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature !== undefined ? request.temperature : 0.7,
      messages: messages as any,
      tools: tools && tools.length > 0 ? (tools as any) : undefined,
    });

    // Parse tool calls from response
    const toolCalls: ToolCall[] = [];
    let content = response.choices[0]?.message?.content || "";

    if (response.choices[0]?.message?.tool_calls) {
      for (const toolCall of response.choices[0].message.tool_calls) {
        if (toolCall.type === "function") {
          toolCalls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments),
          });
        }
      }
    }

    return {
      id: response.id,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      finishReason:
        response.choices[0]?.finish_reason === "tool_calls"
          ? "tool_calls"
          : response.choices[0]?.finish_reason === "stop"
            ? "stop"
            : "length",
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const messages = convertToOpenAIMessages(this.buildMessages(request));

    const tools = request.tools
      ? request.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined;

    const stream = await this.client.chat.completions.create({
      model: request.model || "gpt-4o",
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature !== undefined ? request.temperature : 0.7,
      messages: messages as any,
      tools: tools && tools.length > 0 ? (tools as any) : undefined,
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        yield {
          type: "text_delta",
          delta: chunk.choices[0].delta.content,
        };
      }

      if (chunk.choices[0]?.delta?.tool_calls) {
        for (const toolCall of chunk.choices[0].delta.tool_calls) {
          if (toolCall.function) {
            yield {
              type: "tool_call_delta",
              toolCall: {
                id: toolCall.id || "unknown",
                name: toolCall.function.name || "",
                arguments: toolCall.function.arguments
                  ? JSON.parse(toolCall.function.arguments)
                  : {},
              },
            };
          }
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        yield {
          type: "done",
        };
      }
    }
  }
}

export function createOpenAIProvider(apiKey: string): OpenAIProvider {
  return new OpenAIProvider({ apiKey });
}
