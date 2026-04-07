import { builtInWaifus } from "@syntax-senpai/waifu-core";
import type { Waifu } from "@syntax-senpai/waifu-core";

export function useWaifus() {
  // Return a shallow copy to avoid accidental mutation of the built-in array
  const waifus = (builtInWaifus as unknown as Waifu[]).slice();

  function findById(id: string) {
    return waifus.find((w) => w.id === id);
  }

  return { waifus, findById };
}
