import { describe, it, expect } from "vitest";
import { __testing } from "../providers/anthropic";
import type { ChatRequest } from "../types";

const { buildCachedSystem } = __testing;

const baseReq: ChatRequest = {
  model: "claude-haiku-4-5-20251001",
  messages: [{ id: "u1", role: "user", content: "hi" }],
};

describe("buildCachedSystem", () => {
  it("returns plain string system when no cachedSystemPrompt", () => {
    const result = buildCachedSystem({ ...baseReq, systemPrompt: "plain" });
    expect(result.system).toBe("plain");
    expect(result.tools).toBeUndefined();
  });

  it("returns array with cache_control on the cached prefix", () => {
    const result = buildCachedSystem({
      ...baseReq,
      cachedSystemPrompt: "stable persona",
      systemPrompt: "volatile telemetry",
    });
    expect(Array.isArray(result.system)).toBe(true);
    const blocks = result.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("stable persona");
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1].text).toBe("volatile telemetry");
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it("omits the volatile block when systemPrompt is empty", () => {
    const result = buildCachedSystem({ ...baseReq, cachedSystemPrompt: "stable" });
    const blocks = result.system as Array<{ text: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("stable");
  });

  it("marks the LAST tool with cache_control when caching is active", () => {
    const result = buildCachedSystem({
      ...baseReq,
      cachedSystemPrompt: "stable",
      tools: [
        { name: "first", description: "1st tool", parameters: { type: "object" } },
        { name: "second", description: "2nd tool", parameters: { type: "object" } },
      ],
    });
    expect(result.tools).toHaveLength(2);
    expect(result.tools![0].cache_control).toBeUndefined();
    expect(result.tools![1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("does NOT mark tools when there's no cached prefix", () => {
    const result = buildCachedSystem({
      ...baseReq,
      systemPrompt: "plain",
      tools: [{ name: "only", description: "x", parameters: { type: "object" } }],
    });
    expect(result.tools![0].cache_control).toBeUndefined();
  });
});
