import { getFavorites, setFavorites, toggleFavoriteSync } from "../hooks/useFavorites";

beforeEach(() => {
  // clear localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
});

test("getFavorites returns empty array by default", () => {
  const f = getFavorites();
  if (!Array.isArray(f) || f.length !== 0) throw new Error("expected empty favorites");
});

test("setFavorites persists and getFavorites reads back", () => {
  setFavorites(["a"]);
  const f = getFavorites();
  if (f.length !== 1 || f[0] !== "a") throw new Error("set/get failed");
});

test("toggleFavoriteSync toggles correctly", () => {
  setFavorites(["x"]);
  let res = toggleFavoriteSync("y");
  if (!res.includes("y")) throw new Error("toggle add failed");
  res = toggleFavoriteSync("x");
  if (res.includes("x")) throw new Error("toggle remove failed");
});
