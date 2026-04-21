/**
 * Base utilities for AI provider implementations
 */

import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  Message,
  ToolDefinition,
  CreateProviderOptions,
} from "../types";

/**
 * Abstract base class for common provider functionality
 */
export abstract class BaseAIProvider implements AIProvider {
  abstract id: string;
  displayName = "";
  requiresApiKey = false;
  supportsStreaming = false;
  supportsToolCalling = false;
  supportedModels: { id: string; displayName: string; contextWindow: number; supportsTools: boolean; supportsVision: boolean }[] = [];

  protected apiKey?: string;
  protected baseUrl?: string;
  protected options: CreateProviderOptions;

  constructor(options: CreateProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.options = options;

    if (this.requiresApiKey && !this.apiKey) {
      throw new Error(`${this.displayName} requires an API key`);
    }
  }

  abstract chat(request: ChatRequest): Promise<ChatResponse>;
  abstract stream(request: ChatRequest): AsyncIterable<StreamChunk>;

  /**
   * Helper: Build full messages with system prompt injected
   */
  protected buildMessages(request: ChatRequest): Message[] {
    const messages = [...request.messages];

    // Inject system prompt at the beginning if not already present
    if (request.systemPrompt && messages[0]?.role !== "system") {
      messages.unshift({
        id: `system-${Date.now()}`,
        role: "system",
        content: request.systemPrompt,
      });
    }

    return messages;
  }

  /**
   * Helper: Create tool definitions in provider's expected format
   */
  protected getToolDefinitions(tools?: ToolDefinition[]): ToolDefinition[] {
    if (!tools || !this.supportsToolCalling) {
      return [];
    }
    return tools;
  }

  /**
   * Helper: Validate API key format (basic check)
   */
  protected validateApiKey(key: string): boolean {
    return !!key && key.trim().length > 0;
  }
}

/**
 * Build a human-readable error string from a failed fetch Response.
 * `response.statusText` is empty on HTTP/2 in Chromium/Electron, so we read
 * the body and try to surface the provider's own error message.
 */
export async function formatFetchError(
  providerName: string,
  response: Response
): Promise<string> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    /* ignore */
  }
  let detail = body;
  if (body) {
    try {
      const parsed = JSON.parse(body);
      detail =
        parsed?.error?.message ||
        parsed?.message ||
        parsed?.error ||
        body;
      if (typeof detail !== "string") detail = JSON.stringify(detail);
    } catch {
      /* keep raw body */
    }
  }
  const status = response.status ? `${response.status}` : "network";
  const tail = detail ? ` — ${detail.slice(0, 400)}` : "";
  return `${providerName} API error (${status})${tail}`;
}

/**
 * Base class for OpenAI-compatible providers (Together, Groq, Perplexity, etc.)
 */
export abstract class OpenAICompatibleProvider extends BaseAIProvider {
  displayName = "OpenAI Compatible";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = true;
  supportedModels = [
    {
      id: "gpt-4o",
      displayName: "GPT-4o",
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
  ];

  protected apiClient: any;

  constructor(options: CreateProviderOptions = {}) {
    super(options);
    // Will be initialized by subclass
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error("Subclass must implement chat()");
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    throw new Error("Subclass must implement stream()");
  }
}

/**
 * Helper to convert messages to OpenAI format.
 * Handles tool_calls on assistant messages and tool_call_id on tool results.
 */
export function convertToOpenAIMessages(messages: Message[]): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    const content =
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

    // Assistant message that invoked tools
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === "string"
                ? tc.arguments
                : JSON.stringify(tc.arguments),
          },
        })),
      };
    }

    // Tool result message
    if (msg.role === "tool" && msg.toolCallId) {
      return {
        role: "tool",
        content,
        tool_call_id: msg.toolCallId,
      };
    }

    // Regular message (system / user / assistant without tools)
    return { role: msg.role, content };
  });
}

/**
 * Helper to convert messages to Anthropic format.
 * Handles tool_use blocks on assistant messages and tool_result blocks for tool responses.
 */
export function convertToAnthropicMessages(
  messages: Message[]
): Array<Record<string, unknown>> {
  // Filter out system messages (handled separately in Anthropic)
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg) => {
      const content =
        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

      // Assistant message that invoked tools
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        const blocks: Array<Record<string, unknown>> = [];
        if (content) blocks.push({ type: "text", text: content });
        for (const tc of msg.toolCalls) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
        return { role: "assistant", content: blocks };
      }

      // Tool result message
      if (msg.role === "tool" && msg.toolCallId) {
        return {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: msg.toolCallId, content },
          ],
        };
      }

      return {
        role: msg.role as "user" | "assistant",
        content,
      };
    });
}

/**
 * Helper to format tool calls for response
 */
export function formatToolCall(name: string, args: Record<string, unknown>): { id: string; name: string; arguments: Record<string, unknown> } {
  return {
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name,
    arguments: args,
  };
}
