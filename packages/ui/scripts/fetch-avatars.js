#!/usr/bin/env node

// Fetch avatar PNGs (preferred) and SVGs from DiceBear for waifus defined in waifu-core.
// Saves to packages/ui/public/avatars/<waifuId>.png (fallback to .svg) with white background and square size.

const fs = require("fs/promises");
const path = require("path");

(async () => {
  try {
    const outDir = path.resolve(__dirname, "../public/avatars");
    await fs.mkdir(outDir, { recursive: true });
    console.log("Output dir:", outDir);

    let seeds = [];
    try {
      const modPath = path.resolve(__dirname, "../../waifu-core/dist/index.js");
      const mod = await import("file://" + modPath);
      const waifus = mod.builtInWaifus || [];
      seeds = waifus.map((w) => w.id).filter(Boolean);
    } catch (e) {
      console.warn("Could not import built waifu-core, falling back to sample seeds", e && e.message);
      seeds = [
        "demo-waifu-001",
        "demo-waifu-002",
        "demo-waifu-003",
        "demo-waifu-004",
        "demo-waifu-005",
      ];
    }

    seeds = [...new Set(seeds)].slice(0, 40);

    for (const seed of seeds) {
      try {
        const pngUrl = `https://avatars.dicebear.com/api/adventurer/${encodeURIComponent(seed)}.png?background=%23ffffff&size=512`;
        console.log("Fetching", pngUrl);
        const res = await fetch(pngUrl);
        if (res.ok) {
          const arr = await res.arrayBuffer();
          const buf = Buffer.from(arr);
          const filePath = path.join(outDir, `${seed}.png`);
          await fs.writeFile(filePath, buf);
          console.log("Saved", filePath);
          continue;
        } else {
          console.warn("PNG fetch failed", pngUrl, res.status, "- falling back to svg");
        }

        const svgUrl = `https://avatars.dicebear.com/api/adventurer/${encodeURIComponent(seed)}.svg?background=%23ffffff&size=512`;
        const res2 = await fetch(svgUrl);
        if (!res2.ok) {
          console.error("Failed to fetch", svgUrl, res2.status);
          continue;
        }
        const svg = await res2.text();
        const filePathSvg = path.join(outDir, `${seed}.svg`);
        await fs.writeFile(filePathSvg, svg, "utf8");
        console.log("Saved", filePathSvg);
      } catch (err) {
        console.error("Error fetching seed", seed, err && err.message);
      }
    }

    console.log("Done fetching avatars");
    process.exit(0);
  } catch (err) {
    console.error("Fatal error", err);
    process.exit(1);
  }
})();
