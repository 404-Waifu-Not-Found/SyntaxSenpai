import { filterWaifus } from "../utils/filterWaifus";

const sample = [
  { id: "a", displayName: "Sakura", backstory: "A friendly flower girl", tags: ["cute", "flower"] },
  { id: "b", displayName: "Akira", backstory: "Tech-savvy engineer", tags: ["smart"] },
  { id: "c", displayName: "Mio", backstory: "Quiet and curious", tags: ["shy"] },
] as any;

test("filter by name", () => {
  const out = filterWaifus(sample, "sakura");
  if (out.length !== 1 || out[0].id !== "a") throw new Error("filter by name failed");
});

test("filter by tag", () => {
  const out = filterWaifus(sample, "flower");
  if (out.length !== 1 || out[0].id !== "a") throw new Error("filter by tag failed");
});

test("empty query returns all", () => {
  const out = filterWaifus(sample, "");
  if (out.length !== 3) throw new Error("empty query failed");
});
