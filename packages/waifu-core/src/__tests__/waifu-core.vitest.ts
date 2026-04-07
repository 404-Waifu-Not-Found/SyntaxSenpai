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
});
