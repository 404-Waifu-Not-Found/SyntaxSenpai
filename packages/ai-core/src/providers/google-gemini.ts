/**
 * Google Gemini API Provider
 * https://ai.google.dev/api/rest/v1beta/models/generateContent
 *
 * Uses the public Generative Language API directly. Supports chat, streaming
 * (Server-Sent Events via ?alt=sse), and function calling with a schema
 * translated from our OpenAI-style tool definitions.
 */

import type {
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  Message,
} from "../types";
import { BaseAIProvider, formatFetchError } from "./base";

interface GeminiContent {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
}

function toGeminiParts(content: Message["content"]): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part) => {
    if (part.type === "text") return { text: part.text ?? "" };
    if (part.type === "image_url") {
      const url = part.imageUrl?.url ?? "";
      const dataMatch = /^data:([^;]+);base64,(.+)$/.exec(url);
      if (dataMatch) {
        return { inlineData: { mimeType: dataMatch[1], data: dataMatch[2] } };
      }
      return { text: `[image: ${url}]` };
    }
    return { text: JSON.stringify(part) };
  });
}

function plainText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text ?? "" : "")).join("");
}

function convertToGemini(messages: Message[]): {
  systemInstruction?: { parts: Array<Record<string, unknown>> };
  contents: GeminiContent[];
} {
  let systemText = "";
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemText += (systemText ? "\n\n" : "") + plainText(msg.content);
      continue;
    }
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      contents.push({
        role: "model",
        parts: msg.toolCalls.map((tc) => ({
          functionCall: { name: tc.name, args: tc.arguments },
        })),
      });
      continue;
    }
    if (msg.role === "tool" && msg.toolCallId) {
      // Gemini binds tool results by function name, not id. We stash the name
      // in the message's id as "<toolName>:<callId>" from our runtime convention.
      const name = (msg as any).name || msg.toolCallId.split(":")[0] || "tool";
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name,
              response: { output: plainText(msg.content) },
            },
          },
        ],
      });
      continue;
    }
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: toGeminiParts(msg.content),
    });
  }

  return {
    systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents,
  };
}

function toGeminiTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  if (!tools || tools.length === 0) return [];
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export class GeminiProvider extends BaseAIProvider {
  id = "gemini";
  displayName = "Google Gemini";
  requiresApiKey = true;
  supportsStreaming = true;
  supportsToolCalling = true;
  baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  supportedModels = [
    { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", contextWindow: 1000000, supportsTools: true, supportsVision: true },
    { id: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro", contextWindow: 2000000, supportsTools: true, supportsVision: true },
    { id: "gemini-1.5-flash", displayName: "Gemini 1.5 Flash", contextWindow: 1000000, supportsTools: true, supportsVision: true },
  ];

  constructor(options: { apiKey?: string } = {}) {
    super(options);
  }

  private buildBody(request: ChatRequest) {
    const { systemInstruction, contents } = convertToGemini(this.buildMessages(request));
    const tools = toGeminiTools(this.getToolDefinitions(request.tools));
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (tools.length > 0) body.tools = tools;
    return body;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model || "gemini-2.0-flash";
    const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey || "")}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildBody(request)),
    });

    if (!response.ok) {
      throw new Error(await formatFetchError("Gemini", response));
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const parts: Array<Record<string, any>> = candidate?.content?.parts ?? [];

    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (typeof part.text === "string") content += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini_call_${Date.now()}_${toolCalls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      }
    }

    return {
      id: `gemini_${Date.now()}`,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      finishReason: candidate?.finishReason === "STOP" ? "stop" : (candidate?.finishReason || "stop"),
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const model = request.model || "gemini-2.0-flash";
    const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey || "")}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildBody(request)),
    });

    if (!response.ok) {
      yield { type: "error", error: await formatFetchError("Gemini", response) };
      return;
    }
    if (!response.body) {
      yield { type: "error", error: "Gemini stream: no response body" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines[lines.length - 1];

      for (const line of lines.slice(0, -1)) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload);
          const parts: Array<Record<string, any>> = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (typeof part.text === "string" && part.text) {
              yield { type: "text_delta", delta: part.text };
            }
          }
        } catch {
          /* ignore malformed chunk */
        }
      }
    }

    yield { type: "done" };
  }
}

export function createGeminiProvider(apiKey: string): GeminiProvider {
  return new GeminiProvider({ apiKey });
}
