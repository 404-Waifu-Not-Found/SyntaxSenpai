/**
 * Live integration test against an LM Studio instance with qwen/qwen3-vl-8b loaded.
 * Skipped automatically when LM Studio isn't reachable so CI/dev without it stays green.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { createLMStudioProvider } from "../lmstudio";

const MODEL = "qwen/qwen3-vl-8b";
const BASE = "http://127.0.0.1:1234/v1";

async function lmStudioAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/models`);
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data?.data) && data.data.some((m: any) => m?.id === MODEL);
  } catch {
    return false;
  }
}

describe("LMStudioProvider (live)", () => {
  let available = false;
  beforeAll(async () => {
    available = await lmStudioAvailable();
  });

  it("non-streaming chat returns content", async () => {
    if (!available) return;
    const provider = createLMStudioProvider();
    const res = await provider.chat({
      model: MODEL,
      messages: [
        {
          id: "u1",
          role: "user",
          content: "What is the typical weather in Minhang, Shanghai in May? One sentence.",
        },
      ],
      temperature: 0.4,
      maxTokens: 200,
    });
    expect(res.content.length).toBeGreaterThan(0);
    expect(["stop", "length", "tool_calls"]).toContain(res.finishReason);
  }, 60_000);

  it("streaming emits text_delta + done for plain prompt", async () => {
    if (!available) return;
    const provider = createLMStudioProvider();
    const types: string[] = [];
    let text = "";
    for await (const chunk of provider.stream({
      model: MODEL,
      messages: [{ id: "u1", role: "user", content: 'Say "hi from minhang" exactly.' }],
      temperature: 0,
      maxTokens: 50,
    })) {
      types.push(chunk.type);
      if (chunk.type === "text_delta") text += chunk.delta;
    }
    expect(types).toContain("text_delta");
    expect(types[types.length - 1]).toBe("done");
    expect(text.length).toBeGreaterThan(0);
  }, 60_000);

  it("streaming emits a tool_call_delta with parsed args when a tool is offered", async () => {
    if (!available) return;
    const provider = createLMStudioProvider();
    const types: string[] = [];
    const toolCalls: any[] = [];
    for await (const chunk of provider.stream({
      model: MODEL,
      messages: [
        {
          id: "u1",
          role: "user",
          content:
            "I want to know the weather in Minhang. You MUST call the get_weather tool — do not answer from memory.",
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get current weather for a city/region.",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "City or region" },
              unit: { type: "string", enum: ["celsius", "fahrenheit"] },
            },
            required: ["location"],
          },
        },
      ],
      temperature: 0.2,
      maxTokens: 200,
    })) {
      types.push(chunk.type);
      if (chunk.type === "tool_call_delta") toolCalls.push(chunk.toolCall);
    }
    expect(types).toContain("tool_call_delta");
    expect(types[types.length - 1]).toBe("done");
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0].name).toBe("get_weather");
    expect(toolCalls[0].arguments).toBeTypeOf("object");
    expect(String(toolCalls[0].arguments.location || "").toLowerCase()).toContain("minhang");
  }, 60_000);
});
