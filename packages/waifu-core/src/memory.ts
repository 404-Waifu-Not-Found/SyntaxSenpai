/**
 * Long-term memory for a waifu relationship.
 *
 * After each turn, `recordTurn` asks the LLM to extract durable facts
 * (user name, preferences, ongoing projects, emotional beats) and
 * persists them through an `IMemoryStore`-compatible adapter. The
 * summary is kept small enough to inject directly into the system
 * prompt via `relationship.memorySummary`.
 *
 * Inspired by pguso/ai-agents-from-scratch L08 (memory agent).
 */

import type { AIChatRuntime, Message } from "@syntax-senpai/ai-core";

export interface WaifuMemoryEntry {
  key: string;
  value: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Minimal store contract. Compatible with `@syntax-senpai/storage`'s
 * `IMemoryStore` — waifu-core stays decoupled to avoid a cyclic dep.
 */
export interface WaifuMemoryStoreAdapter {
  setMemory(key: string, value: string, category?: string): Promise<void>;
  getMemory(key: string): Promise<WaifuMemoryEntry | null>;
  getAllMemories(): Promise<WaifuMemoryEntry[]>;
  deleteMemory(key: string): Promise<void>;
}

export interface ExtractedFact {
  key: string;
  value: string;
  category: "identity" | "preference" | "project" | "emotion" | "other";
}

export interface MemoryManagerOptions {
  waifuId: string;
  userId: string;
  store: WaifuMemoryStoreAdapter;
  runtime: AIChatRuntime;
  /** Maximum characters in the injected summary. Defaults to 800. */
  maxSummaryChars?: number;
  /** Maximum facts retained per scope. Oldest dropped on overflow. */
  maxFacts?: number;
}

const EXTRACT_SYSTEM_PROMPT = `You are a memory-extraction module for a companion AI.
From the latest exchange, extract ONLY durable facts worth remembering across future conversations.
Skip small talk, jokes, and anything ephemeral.
Return compact JSON: {"facts":[{"key":"short_snake_key","value":"one sentence","category":"identity|preference|project|emotion|other"}]}
Return {"facts":[]} if nothing durable was said. No prose, no fences.`;

export class WaifuMemoryManager {
  private readonly scope: string;
  private readonly maxSummaryChars: number;
  private readonly maxFacts: number;

  constructor(private readonly options: MemoryManagerOptions) {
    this.scope = `${options.waifuId}:${options.userId}`;
    this.maxSummaryChars = options.maxSummaryChars ?? 800;
    this.maxFacts = options.maxFacts ?? 40;
  }

  /**
   * Extract and persist facts from the latest user/assistant exchange.
   * Returns the set of newly-written facts.
   */
  async recordTurn(userText: string, assistantText: string): Promise<ExtractedFact[]> {
    const facts = await this.extractFacts(userText, assistantText);
    if (facts.length === 0) return [];

    for (const fact of facts) {
      const scopedKey = `${this.scope}:${fact.category}:${fact.key}`;
      await this.options.store.setMemory(scopedKey, fact.value, fact.category);
    }

    await this.enforceFactCap();
    return facts;
  }

  /**
   * Build a compact summary string suitable for `relationship.memorySummary`.
   * Groups facts by category and truncates to `maxSummaryChars`.
   */
  async buildSummary(): Promise<string> {
    const entries = await this.getScopedEntries();
    if (entries.length === 0) return "";

    const byCategory = new Map<string, string[]>();
    for (const entry of entries) {
      const list = byCategory.get(entry.category) ?? [];
      list.push(entry.value);
      byCategory.set(entry.category, list);
    }

    const order = ["identity", "preference", "project", "emotion", "other"];
    const sections: string[] = [];
    for (const category of order) {
      const list = byCategory.get(category);
      if (!list || list.length === 0) continue;
      sections.push(`${capitalize(category)}:\n- ${list.join("\n- ")}`);
    }

    const summary = sections.join("\n\n");
    if (summary.length <= this.maxSummaryChars) return summary;
    return summary.slice(0, this.maxSummaryChars - 3) + "...";
  }

  async forget(key: string): Promise<void> {
    await this.options.store.deleteMemory(key);
  }

  async getScopedEntries(): Promise<WaifuMemoryEntry[]> {
    const all = await this.options.store.getAllMemories();
    return all.filter((m) => m.key.startsWith(`${this.scope}:`));
  }

  /**
   * Convenience: after a turn, compute the refreshed summary string that
   * should be written to `WaifuRelationship.memorySummary`.
   */
  async recordTurnAndSummarize(userText: string, assistantText: string): Promise<string> {
    await this.recordTurn(userText, assistantText);
    return this.buildSummary();
  }

  private async extractFacts(userText: string, assistantText: string): Promise<ExtractedFact[]> {
    const transcript = `User: ${userText}\nAssistant: ${assistantText}`;
    const result = await this.options.runtime.sendMessage({
      text: transcript,
      systemPrompt: EXTRACT_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 400,
    });

    return parseFacts(stringify(result.response.content));
  }

  private async enforceFactCap(): Promise<void> {
    const entries = await this.getScopedEntries();
    if (entries.length <= this.maxFacts) return;

    const sorted = [...entries].sort((a, b) =>
      (a.updatedAt || "").localeCompare(b.updatedAt || "")
    );
    const overflow = sorted.slice(0, entries.length - this.maxFacts);
    for (const entry of overflow) {
      await this.options.store.deleteMemory(entry.key);
    }
  }
}

function parseFacts(raw: string): ExtractedFact[] {
  const json = extractJson(raw);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { facts?: ExtractedFact[] };
    if (!Array.isArray(parsed.facts)) return [];
    return parsed.facts
      .filter(
        (f): f is ExtractedFact =>
          !!f && typeof f.key === "string" && typeof f.value === "string"
      )
      .map((f) => ({
        key: sanitizeKey(f.key),
        value: f.value.trim(),
        category: normalizeCategory(f.category),
      }))
      .filter((f) => f.key.length > 0 && f.value.length > 0);
  } catch {
    return [];
  }
}

function sanitizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

function normalizeCategory(category: unknown): ExtractedFact["category"] {
  const valid: ExtractedFact["category"][] = [
    "identity",
    "preference",
    "project",
    "emotion",
    "other",
  ];
  if (typeof category === "string" && (valid as string[]).includes(category)) {
    return category as ExtractedFact["category"];
  }
  return "other";
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function stringify(content: Message["content"] | unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? (p as { text?: string }).text ?? "" : ""))
      .join("");
  }
  return "";
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
