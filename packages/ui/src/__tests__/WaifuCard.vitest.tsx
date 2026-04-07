import React from "react";
import { renderToString } from "react-dom/server";
import { WaifuCard } from "../components/WaifuCard";

test("WaifuCard SSR includes displayName", () => {
  const sampleWaifu = {
    id: "test-waifu",
    displayName: "Test Waifu",
    avatar: { imageUrl: "", emoji: "💖" },
    backstory: "A friendly test waifu with many stories",
    tags: ["test", "demo"],
    personalityTraits: { warmth: 5, openness: 5 },
    preferredAIProvider: "openai",
    preferredModel: "gpt-4o-mini",
  } as any;
  const html = renderToString(<WaifuCard waifu={sampleWaifu} />);
  if (!html.includes(sampleWaifu.displayName)) throw new Error("displayName not found in SSR output");
});
