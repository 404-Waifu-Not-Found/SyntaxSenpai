#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

(async () => {
  try {
    const outDir = path.resolve(__dirname, "../public/avatars");
    const files = await fs.readdir(outDir).catch(() => []);
    if (!files || files.length === 0) {
      console.error("No avatar files found in", outDir);
      process.exit(1);
    }

    let ok = true;
    for (const f of files) {
      const full = path.join(outDir, f);
      if (!f.toLowerCase().endsWith(".svg")) {
        console.warn("Skipping non-svg:", f);
        continue;
      }
      const content = await fs.readFile(full, "utf8");
      if (!content.includes("<svg")) {
        console.error(f, "is not an svg");
        ok = false;
        continue;
      }
      const vb = content.match(/viewBox=["']([0-9.\s-]+)["']/);
      if (vb) {
        const nums = vb[1].trim().split(/\s+/).map(Number);
        if (nums.length === 4) {
          if (nums[2] !== nums[3]) {
            console.error(f, "viewBox not square:", vb[1]);
            ok = false;
          }
        } else {
          console.warn(f, "unexpected viewBox format:", vb[1]);
          ok = false;
        }
      } else {
        const w = content.match(/width=["']([0-9.]+)["']/);
        const h = content.match(/height=["']([0-9.]+)["']/);
        if (w && h) {
          if (w[1] !== h[1]) {
            console.error(f, "width/height mismatch", w[1], h[1]);
            ok = false;
          }
        } else {
          console.warn("Unable to determine size for", f);
          ok = false;
        }
      }
    }

    if (!ok) {
      console.error("Avatar verification failed");
      process.exit(2);
    }

    console.log("All avatars verified ok");
    process.exit(0);
  } catch (err) {
    console.error("Error verifying avatars", err && err.message);
    process.exit(1);
  }
})();
