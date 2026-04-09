import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  fg: string;
  primary: string;
  accent: string;
  userBubble: string;
  assistantBubble: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  swatchColors: [string, string, string];
  colors: ThemeColors;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "default",
    name: "Default",
    swatchColors: ["#6366f1", "#ec4899", "#0f0f0f"],
    colors: { bg: "#0f0f0f", surface: "#111216", surface2: "#0d0f13", fg: "#ffffff", primary: "#6366f1", accent: "#ec4899", userBubble: "#4f46e5", assistantBubble: "#1a1a2e" },
  },
  {
    id: "ocean",
    name: "Ocean",
    swatchColors: ["#0ea5e9", "#06b6d4", "#0a0f1a"],
    colors: { bg: "#0a0f1a", surface: "#0d1525", surface2: "#081018", fg: "#e0f2fe", primary: "#0ea5e9", accent: "#06b6d4", userBubble: "#0369a1", assistantBubble: "#0c1a2e" },
  },
  {
    id: "sunset",
    name: "Sunset",
    swatchColors: ["#f97316", "#ef4444", "#1a0f0a"],
    colors: { bg: "#1a0f0a", surface: "#201410", surface2: "#150d08", fg: "#fff7ed", primary: "#f97316", accent: "#ef4444", userBubble: "#c2410c", assistantBubble: "#2a1810" },
  },
  {
    id: "emerald",
    name: "Emerald",
    swatchColors: ["#10b981", "#34d399", "#0a1a14"],
    colors: { bg: "#0a1a14", surface: "#0d2018", surface2: "#081510", fg: "#ecfdf5", primary: "#10b981", accent: "#34d399", userBubble: "#047857", assistantBubble: "#0f2a1e" },
  },
  {
    id: "rose",
    name: "Rose",
    swatchColors: ["#f43f5e", "#fb7185", "#1a0a10"],
    colors: { bg: "#1a0a10", surface: "#201015", surface2: "#150810", fg: "#fff1f2", primary: "#f43f5e", accent: "#fb7185", userBubble: "#be123c", assistantBubble: "#2a1018" },
  },
  {
    id: "cherry-blossom",
    name: "Cherry Blossom",
    swatchColors: ["#f9a8d4", "#f472b6", "#ffffff"],
    colors: { bg: "#ffffff", surface: "#fff5fb", surface2: "#fde7f3", fg: "#3f1630", primary: "#f472b6", accent: "#f9a8d4", userBubble: "#db2777", assistantBubble: "#fff0f7" },
  },
  {
    id: "lavender",
    name: "Lavender",
    swatchColors: ["#a78bfa", "#c084fc", "#120f1a"],
    colors: { bg: "#120f1a", surface: "#181425", surface2: "#100d18", fg: "#f5f3ff", primary: "#a78bfa", accent: "#c084fc", userBubble: "#7c3aed", assistantBubble: "#1e1830" },
  },
  {
    id: "amber",
    name: "Amber",
    swatchColors: ["#f59e0b", "#fbbf24", "#1a150a"],
    colors: { bg: "#1a150a", surface: "#201a10", surface2: "#151008", fg: "#fffbeb", primary: "#f59e0b", accent: "#fbbf24", userBubble: "#b45309", assistantBubble: "#2a2010" },
  },
  {
    id: "midnight",
    name: "Midnight",
    swatchColors: ["#6366f1", "#818cf8", "#050510"],
    colors: { bg: "#050510", surface: "#0a0a1a", surface2: "#060612", fg: "#e0e7ff", primary: "#6366f1", accent: "#818cf8", userBubble: "#4338ca", assistantBubble: "#10102a" },
  },
  {
    id: "light-mode",
    name: "Light Mode",
    swatchColors: ["#3b82f6", "#f59e0b", "#f8fafc"],
    colors: { bg: "#ffffff", surface: "#ffffff", surface2: "#f8fafc", fg: "#1f2937", primary: "#3b82f6", accent: "#f59e0b", userBubble: "#2563eb", assistantBubble: "#ffffff" },
  },
];

const STORAGE_KEY = "syntax-senpai-theme";

// Module-level singleton so all hook instances share state
let currentColors: ThemeColors = THEME_PRESETS[0].colors;
let currentPresetId = "default";
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

export async function loadThemeFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { presetId } = JSON.parse(raw);
      const preset = THEME_PRESETS.find((p) => p.id === presetId);
      if (preset) {
        currentColors = preset.colors;
        currentPresetId = preset.id;
        notifyListeners();
      }
    }
  } catch {
    // use defaults
  }
}

export async function setThemePreset(id: string): Promise<void> {
  const preset = THEME_PRESETS.find((p) => p.id === id);
  if (!preset) return;
  currentColors = preset.colors;
  currentPresetId = id;
  notifyListeners();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: id }));
  } catch {
    // ignore storage errors
  }
}

export function useTheme() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const update = () => forceUpdate((n) => n + 1);
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);

  const setPreset = useCallback((id: string) => {
    setThemePreset(id);
  }, []);

  return {
    colors: currentColors,
    presetId: currentPresetId,
    presets: THEME_PRESETS,
    setPreset,
  };
}
