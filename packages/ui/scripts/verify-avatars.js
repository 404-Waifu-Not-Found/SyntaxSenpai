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
      const lower = f.toLowerCase();
      const buf = await fs.readFile(full);

      if (lower.endsWith('.png')) {
        if (!Buffer.isBuffer(buf) || buf.length < 24) {
          console.error(f, 'is too small or not a png');
          ok = false;
          continue;
        }
        // PNG IHDR width & height are 4 bytes each at offset 16 and 20 (big-endian)
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        if (width !== height) {
          console.error(f, 'png not square', width, height);
          ok = false;
        }
        continue;
      }

      if (lower.endsWith('.svg')) {
        const content = buf.toString('utf8');
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
        continue;
      }

      console.warn('Unknown avatar file type:', f);
      ok = false;
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
