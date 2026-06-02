import { describe, it, expect } from "vitest";
import { __testing } from "../providers/anthropic";
import { convertToAnthropicMessages } from "../providers/base";
import type { ChatRequest, Message } from "../types";

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

describe("convertToAnthropicMessages — message-level cache_control", () => {
  const user1: Message = { id: "u1", role: "user", content: "hello" };
  const assistant1: Message = { id: "a1", role: "assistant", content: "hi there" };
  const user2: Message = { id: "u2", role: "user", content: "how are you" };

  it("marks first user message with cache_control when breakpoint index matches", () => {
    const result = convertToAnthropicMessages([user1, assistant1, user2], 0);
    expect(result).toHaveLength(3);

    const firstContent = result[0].content as Array<{ type: string; text: string; cache_control?: unknown }>;
    expect(firstContent).toHaveLength(1);
    expect(firstContent[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("marks the specified user message, not others", () => {
    const result = convertToAnthropicMessages([user1, assistant1, user2], 2);
    expect(result).toHaveLength(3);

    const firstContent = result[0].content as Array<{ type: string; cache_control?: unknown }>;
    expect(firstContent[0].cache_control).toBeUndefined();

    const thirdContent = result[2].content as Array<{ type: string; text: string; cache_control?: unknown }>;
    expect(thirdContent[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not mark assistant messages even if index matches", () => {
    const result = convertToAnthropicMessages([user1, assistant1], 1);
    const secondContent = result[1].content;
    // Assistant content is a string, not an array, since it has no cache_control
    expect(typeof secondContent).toBe("string");
    expect(secondContent).toBe("hi there");
  });

  it("no crash when breakpoint index is out of range", () => {
    const result = convertToAnthropicMessages([user1, assistant1], 99);
    expect(result).toHaveLength(2);
    const firstContent = result[0].content as Array<{ type: string; cache_control?: unknown }>;
    expect(firstContent[0].cache_control).toBeUndefined();
  });

  it("filters system messages and still applies breakpoint by original index", () => {
    const sysMsg: Message = { id: "s1", role: "system", content: "system prompt" };
    const result = convertToAnthropicMessages([sysMsg, user1, assistant1], 1);
    // system is filtered, user1 is at effective index 0 in output, but original index 1
    expect(result).toHaveLength(2);
    const firstContent = result[0].content as Array<{ type: string; text: string; cache_control?: unknown }>;
    expect(firstContent[0].cache_control).toEqual({ type: "ephemeral" });
    expect(firstContent[0].text).toBe("hello");
  });

  it("no cache_control when breakpointIndex is undefined", () => {
    const result = convertToAnthropicMessages([user1, assistant1]);
    expect(result).toHaveLength(2);
    const firstContent = result[0].content;
    expect(typeof firstContent).toBe("string");
  });
});
