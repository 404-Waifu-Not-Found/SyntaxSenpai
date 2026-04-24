/**
 * OpenAI GPT API Provider
 */

import OpenAI from "openai";
import type {
  ChatRequest,
  ChatResponse,
  CreateProviderOptions,
  ModelInfo,
  StreamChunk,
  ToolCall,
} from "../types";
import { OpenAICompatibleProvider, convertToOpenAIMessages } from "./base";
import {
  bridgeChat,
  bridgeChatStream,
  isElectronBridgeAvailable,
} from "./electron-bridge";

export class OpenAIProvider extends OpenAICompatibleProvider {
  id = "openai";
  displayName = "OpenAI (GPT-4o)";
  baseUrl = "https://api.openai.com/v1";

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

  constructor(
    options: CreateProviderOptions & {
      id?: string;
      displayName?: string;
      supportedModels?: ModelInfo[];
    } = {}
  ) {
    super(options);
    if (options.id) {
      this.id = options.id;
    }
    if (options.displayName) {
      this.displayName = options.displayName;
    }
    if (options.supportedModels) {
      this.supportedModels = options.supportedModels;
    }
    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    }

    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: options.defaultHeaders,
      dangerouslyAllowBrowser: true,
    });
  }

  private buildBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
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

    const body: Record<string, unknown> = {
      model: request.model || "gpt-4o",
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature !== undefined ? request.temperature : 0.7,
      messages,
    };
    if (tools && tools.length > 0) body.tools = tools;
    if (stream) body.stream = true;
    return body;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = this.buildBody(request, false);

    let response: any;
    if (isElectronBridgeAvailable()) {
      response = await bridgeChat({
        baseUrl: this.baseUrl || "https://api.openai.com/v1",
        apiKey: this.apiKey ?? "",
        body,
      });
    } else {
      response = await this.client.chat.completions.create(body as any);
    }

    const toolCalls: ToolCall[] = [];
    const message = response?.choices?.[0]?.message;
    const content = message?.content || "";
    // DeepSeek reasoner / "thinking" models return this alongside `content`.
    // The API requires it to be echoed back on subsequent turns — carry it
    // through so the caller can persist it on the assistant history entry.
    const reasoningContent: string | undefined =
      typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0
        ? message.reasoning_content
        : undefined;

    if (message?.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type === "function") {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            parsedArgs = { _raw: toolCall.function.arguments };
          }
          toolCalls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: parsedArgs,
          });
        }
      }
    }

    return {
      id: response?.id ?? "",
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      reasoningContent,
      usage: {
        promptTokens: response?.usage?.prompt_tokens || 0,
        completionTokens: response?.usage?.completion_tokens || 0,
        totalTokens: response?.usage?.total_tokens || 0,
      },
      finishReason:
        response?.choices?.[0]?.finish_reason === "tool_calls"
          ? "tool_calls"
          : response?.choices?.[0]?.finish_reason === "stop"
            ? "stop"
            : "length",
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const body = this.buildBody(request, true);

    if (isElectronBridgeAvailable()) {
      yield* bridgeChatStream({
        baseUrl: this.baseUrl || "https://api.openai.com/v1",
        apiKey: this.apiKey ?? "",
        body,
      });
      return;
    }

    const stream = await this.client.chat.completions.create(body as any);

    for await (const chunk of stream as any) {
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
                  ? (() => {
                      try {
                        return JSON.parse(toolCall.function.arguments);
                      } catch {
                        return { _raw: toolCall.function.arguments };
                      }
                    })()
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
