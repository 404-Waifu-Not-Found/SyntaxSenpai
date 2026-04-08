/**
 * AI Provider Registry - All available providers
 */

export { BaseAIProvider, OpenAICompatibleProvider } from "./base";

// Implemented providers
export { AnthropicProvider, createAnthropicProvider } from "./anthropic";
export { OpenAIProvider, createOpenAIProvider } from "./openai";
export { OllamaProvider, createOllamaProvider } from "./ollama";

// Stub providers (to be implemented)
export { GeminiProvider, createGeminiProvider } from "./google-gemini";
export { MistralProvider, createMistralProvider } from "./mistral";
export { CohereProvider, createCohereProvider } from "./cohere";
export { TogetherProvider, createTogetherProvider } from "./together-ai";
export { GroqProvider, createGroqProvider } from "./groq";
export { PerplexityProvider, createPerplexityProvider } from "./perplexity";
export { ReplicateProvider, createReplicateProvider } from "./replicate";
export { HuggingFaceProvider, createHuggingFaceProvider } from "./huggingface";
export { DeepSeekProvider, createDeepSeekProvider } from "./deepseek";
export { MiniMaxGlobalProvider, createMiniMaxGlobalProvider } from "./minimax-global";
export { MiniMaxCNProvider, createMiniMaxCNProvider } from "./minimax-cn";
export { XAIProvider, createXAIProvider } from "./xai";
export { OpenAICodexProvider, createOpenAICodexProvider } from "./openai-codex";
export { GitHubModelsProvider, createGitHubModelsProvider } from "./github-models";
export { XAIGrokProvider, createXAIGrokProvider } from "./xai-grok";
export { AzureOpenAIProvider, createAzureOpenAIProvider } from "./azure-openai";
export { AWSBedrockProvider, createAWSBedrockProvider } from "./aws-bedrock";
export { FireworksProvider, createFireworksProvider } from "./fireworks-ai";

import type { AIProvider, CreateProviderOptions } from "../types";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { GeminiProvider } from "./google-gemini";
import { MistralProvider } from "./mistral";
import { CohereProvider } from "./cohere";
import { TogetherProvider } from "./together-ai";
import { GroqProvider } from "./groq";
import { PerplexityProvider } from "./perplexity";
import { ReplicateProvider } from "./replicate";
import { HuggingFaceProvider } from "./huggingface";
import { DeepSeekProvider } from "./deepseek";
import { MiniMaxGlobalProvider } from "./minimax-global";
import { MiniMaxCNProvider } from "./minimax-cn";
import { XAIProvider } from "./xai";
import { OpenAICodexProvider } from "./openai-codex";
import { GitHubModelsProvider } from "./github-models";
import { OllamaProvider } from "./ollama";
import { XAIGrokProvider } from "./xai-grok";
import { AzureOpenAIProvider } from "./azure-openai";
import { AWSBedrockProvider } from "./aws-bedrock";
import { FireworksProvider } from "./fireworks-ai";

/**
 * Provider factory - creates provider instances by ID
 */
export type ProviderConfig =
  | { type: "anthropic"; apiKey: string }
  | { type: "openai"; apiKey: string }
  | { type: "gemini"; apiKey: string }
  | { type: "mistral"; apiKey: string }
  | { type: "cohere"; apiKey: string }
  | { type: "together"; apiKey: string }
  | { type: "groq"; apiKey: string }
  | { type: "perplexity"; apiKey: string }
  | { type: "replicate"; apiKey: string }
  | { type: "huggingface"; apiKey: string }
  | { type: "deepseek"; apiKey: string }
  | { type: "minimax-global"; apiKey: string }
  | { type: "minimax-cn"; apiKey: string }
  | { type: "ollama"; baseUrl?: string }
  | { type: "xai"; apiKey: string }
  | { type: "xai-grok"; apiKey: string }
  | { type: "openai-codex"; apiKey: string }
  | { type: "github-models"; apiKey: string }
  | { type: "azure-openai"; apiKey: string; resourceName: string }
  | { type: "aws-bedrock"; apiKey: string }
  | { type: "fireworks"; apiKey: string };

export function createProvider(config: ProviderConfig): AIProvider {
  switch (config.type) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: config.apiKey });
    case "openai":
      return new OpenAIProvider({ apiKey: config.apiKey });
    case "gemini":
      return new GeminiProvider({ apiKey: config.apiKey });
    case "mistral":
      return new MistralProvider({ apiKey: config.apiKey });
    case "cohere":
      return new CohereProvider({ apiKey: config.apiKey });
    case "together":
      return new TogetherProvider({ apiKey: config.apiKey });
    case "groq":
      return new GroqProvider({ apiKey: config.apiKey });
    case "perplexity":
      return new PerplexityProvider({ apiKey: config.apiKey });
    case "replicate":
      return new ReplicateProvider({ apiKey: config.apiKey });
    case "huggingface":
      return new HuggingFaceProvider({ apiKey: config.apiKey });
    case "deepseek":
      return new DeepSeekProvider({ apiKey: config.apiKey });
    case "minimax-global":
      return new MiniMaxGlobalProvider({ apiKey: config.apiKey });
    case "minimax-cn":
      return new MiniMaxCNProvider({ apiKey: config.apiKey });
    case "ollama":
      return new OllamaProvider({ baseUrl: config.baseUrl });
    case "xai":
      return new XAIProvider({ apiKey: config.apiKey });
    case "xai-grok":
      return new XAIGrokProvider({ apiKey: config.apiKey });
    case "openai-codex":
      return new OpenAICodexProvider({ apiKey: config.apiKey });
    case "github-models":
      return new GitHubModelsProvider({ apiKey: config.apiKey });
    case "azure-openai":
      return new AzureOpenAIProvider({
        apiKey: config.apiKey,
        baseUrl: `https://${config.resourceName}.openai.azure.com/v1`,
      });
    case "aws-bedrock":
      return new AWSBedrockProvider({ apiKey: config.apiKey });
    case "fireworks":
      return new FireworksProvider({ apiKey: config.apiKey });
    default:
      throw new Error(`Unknown provider type: ${(config as any).type}`);
  }
}

/**
 * Get all available provider metadata
 */
export function getAllProviderMetadata() {
  return [
    new AnthropicProvider({ apiKey: "dummy" }),
    new OpenAIProvider({ apiKey: "dummy" }),
    new GeminiProvider({ apiKey: "dummy" }),
    new MistralProvider({ apiKey: "dummy" }),
    new CohereProvider({ apiKey: "dummy" }),
    new TogetherProvider({ apiKey: "dummy" }),
    new GroqProvider({ apiKey: "dummy" }),
    new PerplexityProvider({ apiKey: "dummy" }),
    new ReplicateProvider({ apiKey: "dummy" }),
    new HuggingFaceProvider({ apiKey: "dummy" }),
    new DeepSeekProvider({ apiKey: "dummy" }),
    new MiniMaxGlobalProvider({ apiKey: "dummy" }),
    new MiniMaxCNProvider({ apiKey: "dummy" }),
    new OllamaProvider(),
    new XAIProvider({ apiKey: "dummy" }),
    new XAIGrokProvider({ apiKey: "dummy" }),
    new OpenAICodexProvider({ apiKey: "dummy" }),
    new GitHubModelsProvider({ apiKey: "dummy" }),
    new AzureOpenAIProvider({ apiKey: "dummy", baseUrl: "https://dummy.openai.azure.com" }),
    new AWSBedrockProvider({ apiKey: "dummy" }),
    new FireworksProvider({ apiKey: "dummy" }),
  ].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    requiresApiKey: p.requiresApiKey,
    supportsStreaming: p.supportsStreaming,
    supportsToolCalling: p.supportsToolCalling,
    models: p.supportedModels,
  }));
}
