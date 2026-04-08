/**
 * Runtime helpers for end-to-end AI calling.
 *
 * This module wires provider setup, message orchestration,
 * optional tool-call execution loops, and streaming helpers.
 */

import { createProvider, type ProviderConfig } from "./providers";
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
  temperature?: number;
  maxTokens?: number;
  maxToolIterations?: number;
}

export interface SendMessageOptions {
  text: string;
  tools?: ToolDefinition[];
  history?: Message[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolIterations?: number;
}

export interface StreamMessageOptions {
  text: string;
  tools?: ToolDefinition[];
  history?: Message[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export type ToolExecutionResult =
  | string
  | {
      content: string;
      isError?: boolean;
    };

export type ToolExecutor = (
  toolCall: ToolCall
) => Promise<ToolExecutionResult>;

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
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      maxToolIterations: options.maxToolIterations ?? 6,
    };
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

    const maxToolIterations =
      options.maxToolIterations ?? this.defaults.maxToolIterations ?? 6;

    let messages = initialMessages;
    let lastResponse: ChatResponse | null = null;

    for (let iteration = 0; iteration <= maxToolIterations; iteration += 1) {
      const request = this.buildRequest(messages, {
        tools: options.tools,
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      });

      const response = await this.provider.chat(request);
      lastResponse = response;

      messages.push({
        id: response.id || createId("assistant"),
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        createdAt: new Date().toISOString(),
      });

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return { response, messages };
      }

      if (!toolExecutor || iteration === maxToolIterations) {
        return { response, messages };
      }

      for (const toolCall of response.toolCalls) {
        const toolResult = await toolExecutor(toolCall);
        const normalized = normalizeToolResult(toolResult);

        messages.push({
          id: createId("tool"),
          role: "tool",
          content: normalized.content,
          toolCallId: toolCall.id,
          createdAt: new Date().toISOString(),
        });
      }
    }

    if (!lastResponse) {
      throw new Error("No AI response was generated");
    }

    return { response: lastResponse, messages };
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
    case "replicate":
      return { type: "replicate", apiKey: getRequired(env, "REPLICATE_API_KEY") };
    case "huggingface":
      return { type: "huggingface", apiKey: getRequired(env, "HUGGINGFACE_API_KEY") };
    case "ollama":
      return {
        type: "ollama",
        baseUrl: env.OLLAMA_BASE_URL || "http://localhost:11434",
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
    case "aws-bedrock":
      return { type: "aws-bedrock", apiKey: getRequired(env, "AWS_BEDROCK_API_KEY") };
    case "fireworks":
      return { type: "fireworks", apiKey: getRequired(env, "FIREWORKS_API_KEY") };
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

function normalizeToolResult(result: ToolExecutionResult): {
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

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
