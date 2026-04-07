import React from "react";
import { renderToString } from "react-dom/server";
import WaifuCard from "../components/WaifuCard";

test("WaifuCard includes favorite star in SSR", () => {
  const sampleWaifu = {
    id: "test-waifu",
    displayName: "Test Waifu",
    avatar: { imageUrl: "", emoji: "💖" },
    backstory: "A friendly test waifu",
    tags: ["test"],
    personalityTraits: { warmth: 5 },
  } as any;
  const html = renderToString(<WaifuCard waifu={sampleWaifu} />);
  if (!html.includes("☆") && !html.includes("★")) throw new Error("favorite star not rendered");
});
