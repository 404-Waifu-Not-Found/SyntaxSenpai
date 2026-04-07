import type { Waifu } from "@syntax-senpai/waifu-core";
import { filterWaifus } from "./filterWaifus";

export function applyFavoritesAndFilter(
  waifus: Waifu[],
  favorites: string[] = [],
  query = "",
  onlyFavorites = false
): Waifu[] {
  const filtered = filterWaifus(waifus || [], query);
  if (onlyFavorites) return filtered.filter((w) => favorites.includes((w as any).id));
  return filtered.slice().sort((a, b) => {
    const fa = favorites.includes((a as any).id);
    const fb = favorites.includes((b as any).id);
    if (fa === fb) return 0;
    return fa ? -1 : 1; // favorites first
  });
}
