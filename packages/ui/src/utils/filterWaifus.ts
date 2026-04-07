import type { Waifu } from "@syntax-senpai/waifu-core";

export function filterWaifus(waifus: Waifu[], query?: string): Waifu[] {
  const lower = (query || "").trim().toLowerCase();
  if (!lower) return waifus;
  return waifus.filter((w) => {
    if (!w) return false;
    if (w.displayName && w.displayName.toLowerCase().includes(lower)) return true;
    if (w.backstory && w.backstory.toLowerCase().includes(lower)) return true;
    if (w.tags && w.tags.join(" ").toLowerCase().includes(lower)) return true;
    return false;
  });
}
