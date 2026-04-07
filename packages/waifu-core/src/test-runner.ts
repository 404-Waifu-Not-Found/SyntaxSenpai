import assert from "assert";
import { builtInWaifus } from "./index.js";
import { buildSystemPrompt } from "./personality.js";

if (!Array.isArray(builtInWaifus) || (builtInWaifus as any).length === 0) {
  console.error("No built-in waifus found");
  process.exit(1);
}

const w = (builtInWaifus as any)[0];

assert.ok(typeof w.id === "string", "id should be a string");
assert.ok(typeof w.displayName === "string", "displayName should be a string");
assert.ok(w.personalityTraits && typeof w.personalityTraits.warmth === "number", "personalityTraits present");

// Validate system prompt builder produces a usable prompt
const relationship = {
  waifuId: w.id,
  userId: "test-user",
  affectionLevel: 42,
  selectedAIProvider: w.preferredAIProvider || "openai",
  selectedModel: w.preferredModel || "gpt-4o-mini",
  createdAt: new Date().toISOString(),
  lastInteractedAt: new Date().toISOString(),
};
const context = {
  userId: "test-user",
  waifuNickname: "Friend",
  affectionLevel: 42,
  availableTools: ["webSearch"],
  platform: "desktop",
};
const prompt = buildSystemPrompt(w as any, relationship as any, context as any);
assert.ok(typeof prompt === "string" && prompt.includes(w.displayName), "system prompt should include displayName");

console.log("waifu-core tests passed");
process.exit(0);
