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
 * Helper to convert messages to OpenAI format
 */
export function convertToOpenAIMessages(messages: Message[]): Array<{ role: string; content: string }> {
  return messages.map((msg) => ({
    role: msg.role,
    content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
  }));
}

/**
 * Helper to convert messages to Anthropic format
 */
export function convertToAnthropicMessages(
  messages: Message[]
): Array<{ role: "user" | "assistant"; content: string }> {
  // Filter out system messages (handled separately in Anthropic)
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    }));
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
