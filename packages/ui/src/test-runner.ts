import { useWaifus } from "./hooks/useWaifus";

const { waifus } = useWaifus();
if (!Array.isArray(waifus) || waifus.length === 0) {
  console.error("UI: no waifus returned by useWaifus");
  process.exit(1);
}

console.log(`UI: found ${waifus.length} waifu(s)`);
process.exit(0);
