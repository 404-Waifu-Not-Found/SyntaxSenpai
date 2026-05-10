import { describe, it, expect } from "vitest";
import { rankMemories } from "../memory";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-05-06T12:00:00Z");

describe("rankMemories", () => {
  it("returns the input unchanged when length <= k", () => {
    const memories = [
      { key: "a", value: "alpha", category: "identity" },
      { key: "b", value: "beta", category: "preference" },
    ];
    expect(rankMemories(memories, "anything", 8, NOW)).toEqual(memories);
  });

  it("ranks memories with stronger keyword overlap higher", () => {
    const memories = [
      { key: "lang", value: "uses TypeScript daily", updatedAt: new Date(NOW - 30 * DAY).toISOString() },
      { key: "food", value: "loves spicy ramen", updatedAt: new Date(NOW - 30 * DAY).toISOString() },
      { key: "pet", value: "owns a cat named Tofu", updatedAt: new Date(NOW - 30 * DAY).toISOString() },
      { key: "fw", value: "builds with Vue", updatedAt: new Date(NOW - 30 * DAY).toISOString() },
    ];
    const result = rankMemories(memories, "help me with TypeScript types", 1, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("lang");
  });

  it("favors recent memories when relevance is tied", () => {
    const memories = [
      { key: "old", value: "X", updatedAt: new Date(NOW - 60 * DAY).toISOString() },
      { key: "new", value: "X", updatedAt: new Date(NOW - 1 * DAY).toISOString() },
      { key: "older", value: "X", updatedAt: new Date(NOW - 200 * DAY).toISOString() },
    ];
    const result = rankMemories(memories, "no overlap query", 1, NOW);
    expect(result[0].key).toBe("new");
  });

  it("always keeps pinned memories without counting them against k", () => {
    const memories = [
      { key: "pinnedFact", value: "user's name is Sam", pinned: true, updatedAt: new Date(NOW - 365 * DAY).toISOString() },
      { key: "fresh1", value: "today's note about Vue", updatedAt: new Date(NOW - 1 * DAY).toISOString() },
      { key: "fresh2", value: "today's note about React", updatedAt: new Date(NOW - 1 * DAY).toISOString() },
    ];
    const result = rankMemories(memories, "Vue tips", 1, NOW);
    // Pinned + 1 top-scored memory by query relevance.
    expect(result.map((m) => m.key)).toContain("pinnedFact");
    expect(result.map((m) => m.key)).toContain("fresh1");
    expect(result).toHaveLength(2);
  });

  it("handles missing timestamps gracefully", () => {
    const memories = [
      { key: "no_ts", value: "something" },
      { key: "ts", value: "something else", updatedAt: new Date(NOW - 1 * DAY).toISOString() },
      { key: "ts2", value: "third entry", updatedAt: new Date(NOW - 2 * DAY).toISOString() },
    ];
    const result = rankMemories(memories, "query", 2, NOW);
    expect(result).toHaveLength(2);
    // Without a timestamp, recency = 0; the others should win.
    expect(result.map((m) => m.key)).not.toContain("no_ts");
  });
});
