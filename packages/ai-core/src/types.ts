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
}

export interface ChatResponse {
  id: string;
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: "stop" | "tool_calls" | "length" | "error";
}

export interface StreamChunk {
  type: "text_delta" | "tool_call_delta" | "done" | "error";
  delta?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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
