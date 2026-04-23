/**
 * Lightweight keyword + punctuation classifier that guesses which
 * expression a waifu should wear for a given message.
 *
 * Intentionally dependency-free — no model downloads, no API calls.
 * Accuracy is "good enough for a friendly avatar", not diagnostic.
 */

export type Expression =
  | "neutral"
  | "happy"
  | "excited"
  | "thinking"
  | "confused"
  | "embarrassed"
  | "determined"
  | "sad";

export interface SentimentResult {
  expression: Expression;
  /** 0-1; strength of the winning signal. */
  intensity: number;
}

type KeywordRule = { words: string[]; weight: number };

const RULES: Record<Exclude<Expression, "neutral">, KeywordRule[]> = {
  happy: [
    { words: ["thank you", "thanks", "love it", "awesome", "great", "nice", "cute", "cozy"], weight: 1 },
    { words: ["yay", "woohoo", "perfect", "beautiful"], weight: 1.3 },
  ],
  excited: [
    { words: ["amazing", "incredible", "fantastic", "let's go", "can't wait", "shipping"], weight: 1 },
    { words: ["launch", "release", "win", "victory", "hype"], weight: 1.2 },
  ],
  thinking: [
    { words: ["let me think", "hmm", "analyzing", "checking", "investigating", "considering", "looking into"], weight: 1 },
    { words: ["probably", "i suspect", "it seems", "i'd guess"], weight: 0.8 },
  ],
  confused: [
    { words: ["confused", "don't understand", "unclear", "not sure", "what do you mean"], weight: 1 },
    { words: ["?!", "????", "wait what"], weight: 1.2 },
  ],
  embarrassed: [
    { words: ["sorry", "my bad", "oops", "whoops", "i messed up", "i was wrong"], weight: 1 },
    { words: ["apologize", "pardon"], weight: 1.1 },
  ],
  determined: [
    { words: ["let's do this", "on it", "got it", "will do", "handling it", "i'll fix", "i can do"], weight: 1 },
    { words: ["no problem", "leave it to me", "consider it done"], weight: 1.3 },
  ],
  sad: [
    { words: ["sorry to hear", "that's unfortunate", "it didn't work", "failed", "broken", "couldn't"], weight: 1 },
    { words: ["stuck", "frustrating", "disappointed", "bummer"], weight: 1.1 },
  ],
};

function scoreText(text: string): Map<Expression, number> {
  const lower = text.toLowerCase();
  const scores = new Map<Expression, number>();

  for (const [expr, ruleSet] of Object.entries(RULES) as [Exclude<Expression, "neutral">, KeywordRule[]][]) {
    let score = 0;
    for (const rule of ruleSet) {
      for (const word of rule.words) {
        // Simple substring match — good enough for this use-case.
        if (lower.includes(word)) score += rule.weight;
      }
    }
    if (score > 0) scores.set(expr, score);
  }

  // Punctuation-based boosts.
  const exclaimCount = (text.match(/!/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;
  if (exclaimCount >= 2) {
    scores.set("excited", (scores.get("excited") ?? 0) + 0.8);
  }
  if (questionCount >= 2) {
    scores.set("confused", (scores.get("confused") ?? 0) + 0.6);
  }
  if (/\.\.\.|…/.test(text)) {
    scores.set("thinking", (scores.get("thinking") ?? 0) + 0.4);
  }

  return scores;
}

export function classifySentiment(text: string): SentimentResult {
  const stripped = (text || "").trim();
  if (!stripped) return { expression: "neutral", intensity: 0 };

  const scores = scoreText(stripped);
  if (scores.size === 0) {
    return { expression: "neutral", intensity: 0 };
  }

  // Pick the highest-scoring expression.
  let best: Expression = "neutral";
  let bestScore = 0;
  for (const [expr, score] of scores) {
    if (score > bestScore) {
      best = expr;
      bestScore = score;
    }
  }

  // Normalize intensity: ~2 hits = 1.0.
  const intensity = Math.min(1, bestScore / 2);
  return { expression: best, intensity };
}

/** Short emoji used as a pip overlay in minimal UIs. */
export const EXPRESSION_EMOJI: Record<Expression, string> = {
  neutral: "🙂",
  happy: "😊",
  excited: "✨",
  thinking: "🤔",
  confused: "❓",
  embarrassed: "😳",
  determined: "💪",
  sad: "🥺",
};
