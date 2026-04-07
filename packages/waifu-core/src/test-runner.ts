import assert from "assert";
import { builtInWaifus } from "./index.js";

if (!Array.isArray(builtInWaifus) || (builtInWaifus as any).length === 0) {
  console.error("No built-in waifus found");
  process.exit(1);
}

const w = (builtInWaifus as any)[0];

assert.ok(typeof w.id === "string", "id should be a string");
assert.ok(typeof w.displayName === "string", "displayName should be a string");
assert.ok(w.personalityTraits && typeof w.personalityTraits.warmth === "number", "personalityTraits present");

console.log("waifu-core tests passed");
process.exit(0);
