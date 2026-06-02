/**
 * Core message and AI provider types
 */

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  id: string;
  role: MessageRole;
  content: string | ContentPart[];
  toolCallId?: string; // for role=tool responses
  toolCalls?: ToolCall[]; // for assistant messages that invoke tools
  /**
   * DeepSeek "thinking" / reasoner models return a separate `reasoning_content`
   * field alongside the final answer. When the assistant turn is fed back in a
   * subsequent request the API REQUIRES this field to be echoed back, otherwise
   * it rejects with `The reasoning_content in the thinking mode must be passed
   * back to the API.` Carry it through multi-turn + tool-call loops.
   */
  reasoningContent?: string;
  createdAt?: string; // ISO 8601
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  imageUrl?: { url: string };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * JSON Schema subset for tool parameter definitions
 */
export interface JsonSchemaProperty {
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "object"
    | "null";
  description?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: (string | number | boolean)[];
  default?: unknown;
}

export type JsonSchema = JsonSchemaProperty;

/**
 * Tool definition sent to the AI provider
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/**
 * Core AI provider interface
 */
export interface AIProvider {
  id: string; // e.g. "anthropic", "openai", "ollama"
  displayName: string;
  requiresApiKey: boolean;
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  supportedModels: ModelInfo[];

  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string; // injected separately for clean waifu system prompts
  /**
   * Stable prefix that providers with prompt caching (currently Anthropic)
   * mark with `cache_control: ephemeral`. Persona / tool-guide / agent-behavior
   * blocks belong here — they don't change between turns, so cached input
   * tokens come back ~10× cheaper within the 5-min TTL window. Volatile
   * blocks (memory, telemetry, affection) stay in `systemPrompt`.
   *
   * Providers that don't support caching SHOULD concatenate
   * `cachedSystemPrompt + systemPrompt` and treat it as a single system prompt.
   */
  cachedSystemPrompt?: string;
  /**
   * When set, the message at this index in `messages` gets `cache_control:
   * ephemeral` on its last content block (Anthropic only). Everything up to and
   * including that message is eligible for prompt caching.
   *
   * Strategy for high cache-hit rates: set this to the index of the FIRST
   * user message in the conversation. The system prompt + first exchange stay
   * cached across turns, and only new messages after the breakpoint are
   * uncached. Within the 5-min TTL window this gives a stable cache key for
   * the heavy prefix while new turns append light-weight messages.
   */
  cacheBreakpointIndex?: number;
  /** Optional abort signal — providers that respect it stop the in-flight request. */
  signal?: AbortSignal;
}

export interface ChatResponse {
  id: string;
  content: string;
  toolCalls?: ToolCall[];
  /** DeepSeek reasoner returns chain-of-thought here; must be echoed on next call. */
  reasoningContent?: string;
  usage: TokenUsage;
  finishReason: "stop" | "tool_calls" | "length" | "error";
}

export interface StreamChunk {
  type: "text_delta" | "reasoning_delta" | "tool_call_delta" | "done" | "error";
  delta?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
  /** Final token usage — populated on the terminal "done" chunk when the provider reports it. */
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Anthropic prompt-caching breakdown. Other providers leave these undefined. */
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
}

/**
 * API provider factory options
 */
export interface CreateProviderOptions {
  apiKey?: string;
  baseUrl?: string; // for self-hosted or compatible endpoints
  defaultHeaders?: Record<string, string>;
}
