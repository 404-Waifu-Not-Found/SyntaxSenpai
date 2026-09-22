import { runAgentTurn } from './agent-run';
/**
 * Runtime helpers for end-to-end AI calling.
 *
 * This module wires provider setup, message orchestration,
 * optional tool-call execution loops, and streaming helpers.
 */

import { createProvider, type ProviderConfig } from "./providers";
import { withRetry, type RetryOptions, ProviderError } from "./retry";
import { TraceEmitter, type TraceHandler, type AgentTraceEvent } from "./trace";
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  Message,
  StreamChunk,
  ToolCall,
  ToolDefinition,
} from "./types";

export type ProviderId = ProviderConfig["type"];

export interface AISetupOptions {
  provider: ProviderConfig;
  model?: string;
  systemPrompt?: string;
  /** Stable prompt prefix forwarded to providers that support prompt caching. */
  cachedSystemPrompt?: string;
  cacheBreakpointIndex?: number;
  temperature?: number;
  maxTokens?: number;
  maxToolIterations?: number;
  retry?: RetryOptions;
}

export interface SendMessageOptions {
  text: string;
  tools?: ToolDefinition[];
  history?: Message[];
  systemPrompt?: string;
  cachedSystemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolIterations?: number;
  retry?: RetryOptions;
  onTrace?: TraceHandler;
  signal?: AbortSignal;
}

export interface StreamMessageOptions {
  text: string;
  tools?: ToolDefinition[];
  history?: Message[];
  systemPrompt?: string;
  cachedSystemPrompt?: string;
  cacheBreakpointIndex?: number;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type LegacyToolExecutionResult =
  | string
  | {
      content: string;
      isError?: boolean;
    };

export type ToolExecutor = (
  toolCall: ToolCall
) => Promise<LegacyToolExecutionResult>;

export interface SendMessageResult {
  response: ChatResponse;
  messages: Message[];
}

export class AIChatRuntime {
  private readonly provider: AIProvider;
  private readonly defaults: Omit<AISetupOptions, "provider">;

  constructor(options: AISetupOptions) {
    this.provider = createProvider(options.provider);
    this.defaults = {
      model: options.model,
      systemPrompt: options.systemPrompt,
      cachedSystemPrompt: options.cachedSystemPrompt,
      cacheBreakpointIndex: options.cacheBreakpointIndex,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      maxToolIterations: options.maxToolIterations ?? 6,
      retry: options.retry,
    };
  }

  /**
   * Invoke provider.chat with exponential-backoff retry for transient errors.
   * Exposed so external callers (planner, summarizer) share the same resilience.
   */
  async chatWithRetry(
    request: ChatRequest,
    retry?: RetryOptions,
    signal?: AbortSignal,
    emitter?: TraceEmitter,
    iteration = 0
  ): Promise<ChatResponse> {
    const retryOpts: RetryOptions = {
      ...this.defaults.retry,
      ...retry,
      signal,
      onRetry: (err, attempt, delayMs) => {
        emitter?.emit({
          type: "retry",
          iteration,
          reason: `${err.kind}: ${err.message}`,
          attempt,
          delayMs,
        });
        retry?.onRetry?.(err, attempt, delayMs);
      },
    };
    return withRetry(() => this.provider.chat(request), retryOpts);
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  async sendMessage(
    options: SendMessageOptions,
    toolExecutor?: ToolExecutor
  ): Promise<SendMessageResult> {
    const initialMessages = options.history ? [...options.history] : [];

    initialMessages.push({
      id: createId("user"),
      role: "user",
      content: options.text,
      createdAt: new Date().toISOString(),
    });

    const messages = initialMessages;
    const emitter = new TraceEmitter();
    if (options.onTrace) emitter.on(options.onTrace);
    emitter.emit({ type: 'turn_start', iteration: 0, userText: options.text });
    let lastResponse: ChatResponse | undefined;
    let iteration = 0;
    try {
      const result = await runAgentTurn({
        model: this.defaults.model || this.provider.supportedModels[0]?.id || '',
        history: messages, tools: toolExecutor ? options.tools || [] : [],
        systemPrompt: options.systemPrompt ?? this.defaults.systemPrompt ?? '',
        cachedSystemPrompt: options.cachedSystemPrompt ?? this.defaults.cachedSystemPrompt,
        maxIterations: options.maxToolIterations ?? this.defaults.maxToolIterations ?? 6,
        abortSignal: options.signal,
        onIteration: value => { iteration = value },
        callProvider: async req => {
          lastResponse = await this.chatWithRetry({ ...req, temperature: options.temperature ?? this.defaults.temperature, maxTokens: options.maxTokens ?? this.defaults.maxTokens }, options.retry, options.signal, emitter, iteration);
          return lastResponse;
        },
        executeTool: async tc => {
          emitter.emit({ type: 'action', iteration, toolCall: tc });
          const normalized = normalizeToolResult(await toolExecutor!(tc));
          emitter.emit({ type: 'observation', iteration, toolCallId: tc.id, content: normalized.content, isError: normalized.isError });
          return normalized.isError ? `Error: ${normalized.content}` : normalized.content;
        },
      });
      const response: ChatResponse = { ...(lastResponse || { id: createId('assistant'), usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' }), content: result.finalContent };
      emitter.emit({ type: 'final_answer', iteration, text: response.content });
      return { response, messages };
    } finally { emitter.emit({ type: 'turn_end', iterations: iteration + 1 }); }
  }

  async *streamMessage(options: StreamMessageOptions): AsyncIterable<StreamChunk> {
    const messages = options.history ? [...options.history] : [];
    messages.push({
      id: createId("user"),
      role: "user",
      content: options.text,
      createdAt: new Date().toISOString(),
    });

    const request = this.buildRequest(messages, {
      tools: options.tools,
      systemPrompt: options.systemPrompt,
      cachedSystemPrompt: options.cachedSystemPrompt,
      cacheBreakpointIndex: options.cacheBreakpointIndex,
      signal: options.signal,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });

    for await (const chunk of this.provider.stream(request)) {
      yield chunk;
    }
  }

  private buildRequest(
    messages: Message[],
    override: {
      tools?: ToolDefinition[];
      systemPrompt?: string;
      cachedSystemPrompt?: string;
      cacheBreakpointIndex?: number;
      signal?: AbortSignal;
      temperature?: number;
      maxTokens?: number;
    }
  ): ChatRequest {
    const model =
      this.defaults.model || this.provider.supportedModels[0]?.id || "gpt-4o";

    return {
      model,
      messages,
      tools: override.tools,
      systemPrompt: override.systemPrompt ?? this.defaults.systemPrompt,
      cachedSystemPrompt: override.cachedSystemPrompt ?? this.defaults.cachedSystemPrompt,
      cacheBreakpointIndex: override.cacheBreakpointIndex ?? this.defaults.cacheBreakpointIndex,
      signal: override.signal,
      temperature: override.temperature ?? this.defaults.temperature,
      maxTokens: override.maxTokens ?? this.defaults.maxTokens,
    };
  }
}

export interface CreateRuntimeFromEnvOptions {
  provider: ProviderId;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolIterations?: number;
  env?: Record<string, string | undefined>;
}

export function createRuntimeFromEnv(options: CreateRuntimeFromEnvOptions): AIChatRuntime {
  const env = options.env ?? getDefaultEnv();
  const provider = createProviderConfigFromEnv(options.provider, env);

  return new AIChatRuntime({
    provider,
    model: options.model ?? readModelFromEnv(options.provider, env),
    systemPrompt: options.systemPrompt,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    maxToolIterations: options.maxToolIterations,
  });
}

export function createProviderConfigFromEnv(
  provider: ProviderId,
  env: Record<string, string | undefined> = getDefaultEnv()
): ProviderConfig {
  switch (provider) {
    case "anthropic":
      return { type: "anthropic", apiKey: getRequired(env, "ANTHROPIC_API_KEY") };
    case "openai":
      return { type: "openai", apiKey: getRequired(env, "OPENAI_API_KEY") };
    case "gemini":
      return { type: "gemini", apiKey: getRequired(env, "GEMINI_API_KEY") };
    case "mistral":
      return { type: "mistral", apiKey: getRequired(env, "MISTRAL_API_KEY") };
    case "cohere":
      return { type: "cohere", apiKey: getRequired(env, "COHERE_API_KEY") };
    case "together":
      return { type: "together", apiKey: getRequired(env, "TOGETHER_API_KEY") };
    case "deepseek":
      return { type: "deepseek", apiKey: getRequired(env, "DEEPSEEK_API_KEY") };
    case "minimax-global":
      return { type: "minimax-global", apiKey: getRequired(env, "MINIMAX_GLOBAL_API_KEY") };
    case "minimax-cn":
      return { type: "minimax-cn", apiKey: getRequired(env, "MINIMAX_CN_API_KEY") };
    case "groq":
      return { type: "groq", apiKey: getRequired(env, "GROQ_API_KEY") };
    case "perplexity":
      return { type: "perplexity", apiKey: getRequired(env, "PERPLEXITY_API_KEY") };
    case "huggingface":
      return { type: "huggingface", apiKey: getRequired(env, "HUGGINGFACE_API_KEY") };
    case "ollama":
      return {
        type: "ollama",
        baseUrl: env.OLLAMA_BASE_URL || "http://localhost:11434",
      };
    case "lmstudio":
      return {
        type: "lmstudio",
        baseUrl: env.LM_STUDIO_BASE_URL || "http://127.0.0.1:1234/v1",
        apiKey: env.LM_STUDIO_API_KEY,
      };
    case "xai":
      return { type: "xai", apiKey: getRequired(env, "XAI_API_KEY") };
    case "xai-grok":
      return { type: "xai-grok", apiKey: getRequired(env, "XAI_API_KEY") };
    case "openai-codex":
      return {
        type: "openai-codex",
        apiKey: getRequired(env, "OPENAI_CODEX_AUTH_TOKEN"),
      };
    case "github-models":
      return {
        type: "github-models",
        apiKey: getRequired(env, "GITHUB_MODELS_TOKEN"),
      };
    case "azure-openai":
      return {
        type: "azure-openai",
        apiKey: getRequired(env, "AZURE_OPENAI_API_KEY"),
        resourceName: getRequired(env, "AZURE_OPENAI_RESOURCE_NAME"),
      };
    case "fireworks":
      return { type: "fireworks", apiKey: getRequired(env, "FIREWORKS_API_KEY") };
    case "nvidia":
      return { type: "nvidia", apiKey: getRequired(env, "NVIDIA_API_KEY") };
    default:
      throw new Error(`Unsupported provider: ${provider as string}`);
  }
}

function getRequired(
  env: Record<string, string | undefined>,
  key: string
): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function normalizeToolResult(result: LegacyToolExecutionResult): {
  content: string;
  isError: boolean;
} {
  if (typeof result === "string") {
    return { content: result, isError: false };
  }

  return {
    content: result.content,
    isError: !!result.isError,
  };
}

function stringContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? (p as { text?: string }).text ?? "" : ""))
      .join("");
  }
  return "";
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function fingerprintToolCall(toolCall: ToolCall): string {
  return `${toolCall.name}::${stableStringify(toolCall.arguments)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

function getDefaultEnv(): Record<string, string | undefined> {
  if (
    typeof globalThis !== "undefined" &&
    "process" in globalThis &&
    typeof (globalThis as { process?: unknown }).process === "object"
  ) {
    const processObj = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    if (processObj?.env) {
      return processObj.env;
    }
  }

  return {};
}

function readModelFromEnv(
  provider: ProviderId,
  env: Record<string, string | undefined>
): string | undefined {
  return env.SYNTAX_SENPAI_AI_MODEL || env[`SYNTAX_SENPAI_MODEL_${provider.toUpperCase().replace(/-/g, "_")}`];
}
