import { applyFavoritesAndFilter } from "../utils/applyFavoritesAndFilter";

const sample = [
  { id: "a", displayName: "Sakura", tags: ["cute"], backstory: "..." },
  { id: "b", displayName: "Akira", tags: ["tech"] },
  { id: "c", displayName: "Mio" },
] as any;

test("favorites first sorts", () => {
  const res = applyFavoritesAndFilter(sample, ["b"], "", false);
  if (res[0].id !== "b") throw new Error("favorites not first");
});

test("only favorites filters", () => {
  const res = applyFavoritesAndFilter(sample, ["b"], "", true);
  if (res.length !== 1 || res[0].id !== "b") throw new Error("only favorites filtering failed");
});
