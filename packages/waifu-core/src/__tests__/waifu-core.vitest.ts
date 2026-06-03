import { test } from 'vitest'
import { builtInWaifus } from "../index";
import { buildSystemPrompt } from "../personality";

test("builtInWaifus and system prompt", () => {
  if (!Array.isArray(builtInWaifus) || builtInWaifus.length === 0) throw new Error("No waifus");
  const w = builtInWaifus[0] as any;
  const rel = {
    waifuId: w.id,
    userId: "test",
    affectionLevel: 10,
    selectedAIProvider: w.preferredAIProvider || "openai",
    selectedModel: w.preferredModel || "gpt-4o-mini",
    createdAt: new Date().toISOString(),
    lastInteractedAt: new Date().toISOString(),
  } as any;
  const prompt = buildSystemPrompt(w as any, rel, { userId: "test" } as any);
  if (!prompt || !prompt.includes(w.displayName)) throw new Error("Prompt missing displayName");
  if (!prompt.includes("When chatting in Chinese, address the user as: 用户")) {
    throw new Error("Prompt missing default Chinese user address rule");
  }
  if (!prompt.includes('if the user excitedly says "kskbl"')) {
    throw new Error("Prompt missing casual internet abbreviation guidance");
  }
});

test("system prompt uses configured nickname for Chinese address", () => {
  const w = builtInWaifus[0] as any;
  const rel = {
    waifuId: w.id,
    userId: "test",
    nickname: "老公",
    affectionLevel: 10,
    selectedAIProvider: w.preferredAIProvider || "openai",
    selectedModel: w.preferredModel || "gpt-4o-mini",
    createdAt: new Date().toISOString(),
    lastInteractedAt: new Date().toISOString(),
  } as any;
  const prompt = buildSystemPrompt(w as any, rel, { userId: "test" } as any);
  if (!prompt.includes("When chatting in Chinese, address the user as: 老公")) {
    throw new Error("Prompt did not use configured nickname for Chinese address");
  }
});
