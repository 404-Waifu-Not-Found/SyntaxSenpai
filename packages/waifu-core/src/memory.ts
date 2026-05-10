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

/**
 * Pick the most relevant memories for the current turn so the system prompt
 * doesn't grow linearly with the user's history.
 *
 * Score: 0.6 × recency + 0.4 × keyword-overlap.
 * - Recency = exp decay over `updatedAt`/`createdAt` (half-life ~14 days).
 * - Keyword overlap = Jaccard over lowercased word tokens.
 * Memories with `pinned: true` are always kept and don't count toward `k`.
 *
 * Pure function; safe to call from the renderer or main process.
 */
export interface RankableMemory {
  key: string;
  value: string;
  category?: string;
  createdAt?: string;
  updatedAt?: string;
  pinned?: boolean;
}

const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","of","to","in","on","at","by","for","with","and","or","but",
  "not","no","i","you","he","she","it","we","they","my","your","this","that",
  "these","those","what","when","where","why","how","can","could","would","should",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function recencyScore(timestamp: string | undefined, nowMs: number): number {
  if (!timestamp) return 0;
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return 0;
  const ageMs = Math.max(0, nowMs - t);
  // Half-life of ~14 days (1.21e9 ms): score = 0.5^(age/halflife).
  const halfLifeMs = 14 * 24 * 60 * 60 * 1000;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

export function rankMemories<T extends RankableMemory>(
  memories: T[],
  queryText: string,
  k = 8,
  nowMs: number = Date.now()
): T[] {
  if (memories.length <= k) return memories;

  const queryTokens = tokenize(queryText || "");
  const pinned = memories.filter((m) => m.pinned);
  const candidates = memories.filter((m) => !m.pinned);

  const scored = candidates.map((m) => {
    const memoryTokens = tokenize(`${m.key} ${m.value} ${m.category ?? ""}`);
    const overlap = jaccard(queryTokens, memoryTokens);
    const recency = recencyScore(m.updatedAt || m.createdAt, nowMs);
    return { memory: m, score: 0.6 * recency + 0.4 * overlap };
  });

  scored.sort((a, b) => b.score - a.score);
  // Pinned memories are added on top of the K-best slots (not counted toward K).
  const top = scored.slice(0, k).map((s) => s.memory);
  return [...pinned, ...top];
}
