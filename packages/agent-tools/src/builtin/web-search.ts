/**
 * Web search via DuckDuckGo Instant Answer API (no key required).
 * Falls back to the HTML results page parsed minimally for topic links.
 */

import type { ToolImplementation } from "../types";
import type { SearchTools } from "../types";

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: unknown }>;
  Answer?: string;
  AnswerType?: string;
}

export const webSearchTool: ToolImplementation<SearchTools.WebSearchInput, {
  summary: string;
  results: Array<{ title: string; url: string; snippet: string }>;
}> = {
  definition: {
    name: "web_search",
    description:
      "Search the web for information. Returns a short summary plus up to N related result links. Use for factual questions or current events.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (natural language)." },
        limit: { type: "integer", description: "Max results (1-10).", default: 5 },
        safeSearch: { type: "boolean", default: true },
      },
      required: ["query"],
    },
  },
  requiresPermission: "networkAccess",
  async execute(input) {
    const query = (input?.query ?? "").trim();
    if (!query) return { success: false, error: "query is required" };

    const limit = clamp(input.limit ?? 5, 1, 10);
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&skip_disambig=1`;

    try {
      const resp = await fetch(url, { headers: { accept: "application/json" } });
      if (!resp.ok) {
        return { success: false, error: `DuckDuckGo responded ${resp.status}` };
      }
      const data = (await resp.json()) as DuckDuckGoResponse;

      const summary =
        data.Answer?.trim() ||
        data.AbstractText?.trim() ||
        `No instant answer for "${query}".`;

      const results = flattenTopics(data.RelatedTopics ?? [])
        .slice(0, limit)
        .map((t) => ({
          title: firstLine(t.Text ?? "Untitled"),
          url: t.FirstURL ?? "",
          snippet: t.Text ?? "",
        }));

      if (data.AbstractURL && data.AbstractText) {
        results.unshift({
          title: data.Heading || query,
          url: data.AbstractURL,
          snippet: data.AbstractText,
        });
      }

      const displayLines = [summary, ...results.map((r) => `- ${r.title} — ${r.url}`)];
      return {
        success: true,
        data: { summary, results: results.slice(0, limit) },
        displayText: displayLines.join("\n"),
      };
    } catch (err) {
      return { success: false, error: `Web search failed: ${errMsg(err)}` };
    }
  },
};

function flattenTopics(
  topics: Array<{ Text?: string; FirstURL?: string; Topics?: unknown }>
): Array<{ Text?: string; FirstURL?: string }> {
  const out: Array<{ Text?: string; FirstURL?: string }> = [];
  for (const t of topics) {
    if (Array.isArray((t as { Topics?: unknown }).Topics)) {
      out.push(...flattenTopics((t as { Topics: typeof topics }).Topics));
    } else if (t.FirstURL) {
      out.push({ Text: t.Text, FirstURL: t.FirstURL });
    }
  }
  return out;
}

function firstLine(s: string): string {
  const i = s.indexOf(" - ");
  return i === -1 ? s : s.slice(0, i);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
