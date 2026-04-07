import React from "react";
import ReactDOMServer from "react-dom/server";
import WaifuCard from "./components/WaifuCard.js";
import { builtInWaifus } from "@syntax-senpai/waifu-core";
import assert from "assert";

const waifu = (builtInWaifus as any)[0];

const html = ReactDOMServer.renderToStaticMarkup(React.createElement(WaifuCard, { waifu, showAvatar: false }));

if (!html.includes(waifu.displayName)) {
  console.error("SSR render failed: displayName not found in output");
  process.exit(1);
}

console.log("UI SSR test passed");
process.exit(0);
