import { expect, test } from 'vitest'
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

test("persona prompt renders with CSP-style dynamic code generation disabled", () => {
  const waifu = {
    ...builtInWaifus[0],
    systemPromptTemplate: "Hi {{ displayName }}! {{backstory}} Warmth: {{personalityTraits.warmth}}. Missing: {{unknown}}",
  };
  const originalFunction = Object.getOwnPropertyDescriptor(globalThis, "Function")!;
  Object.defineProperty(globalThis, "Function", {
    configurable: true,
    writable: true,
    value: () => { throw new EvalError("unsafe-eval is disabled"); },
  });
  try {
    const prompt = buildSystemPrompt(waifu, {
      waifuId: waifu.id,
      userId: "test",
      affectionLevel: 85,
    } as any, { userId: "test" } as any);
    expect(prompt).toContain(`Hi ${waifu.displayName}! ${waifu.backstory} Warmth: 85. Missing: `);
    expect(prompt).not.toContain("{{");
  } finally {
    Object.defineProperty(globalThis, "Function", originalFunction);
  }
});

test("every built-in persona template resolves without runtime compilation", () => {
  for (const waifu of builtInWaifus) {
    const prompt = buildSystemPrompt(waifu, {
      waifuId: waifu.id,
      userId: "test",
      affectionLevel: 50,
    } as any, { userId: "test" } as any);
    expect(prompt).toContain(`## Character Brief\nYou are ${waifu.displayName}`);
    expect(prompt).toContain(waifu.backstory);
    expect(prompt).not.toContain("{{");
  }
});
