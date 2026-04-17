import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { builtInWaifus } from "@syntax-senpai/waifu-core";

export interface AppState {
  selectedWaifuId: string;
  selectedProvider: string;
  selectedModel?: string;
  hasCompletedOnboarding: boolean;
  groupChatEnabled: boolean;
  groupChatWaifuIds: string[];
}

export const APP_STATE_STORAGE_KEY = "syntax-senpai-app-state";

export const DEFAULT_APP_STATE: AppState = {
  selectedWaifuId: builtInWaifus[0]?.id || "aria",
  selectedProvider: "anthropic",
  hasCompletedOnboarding: false,
  groupChatEnabled: false,
  groupChatWaifuIds: builtInWaifus.slice(0, 2).map((waifu) => waifu.id),
};

function getFallbackGroupWaifuIds(selectedWaifuId: string) {
  const waifuIds = builtInWaifus.map((waifu) => waifu.id);
  const first = waifuIds.includes(selectedWaifuId) ? selectedWaifuId : waifuIds[0] || "aria";
  const second = waifuIds.find((waifuId) => waifuId !== first) || first;
  return Array.from(new Set([first, second])).slice(0, 4);
}

export function normalizeAppState(input?: Partial<AppState> | null): AppState {
  const merged = {
    ...DEFAULT_APP_STATE,
    ...(input || {}),
  };

  const validWaifuIds = new Set(builtInWaifus.map((waifu) => waifu.id));
  const selectedWaifuId = validWaifuIds.has(merged.selectedWaifuId)
    ? merged.selectedWaifuId
    : DEFAULT_APP_STATE.selectedWaifuId;

  const requestedGroupWaifus = Array.isArray(merged.groupChatWaifuIds)
    ? merged.groupChatWaifuIds.filter(
        (waifuId): waifuId is string => typeof waifuId === "string" && validWaifuIds.has(waifuId)
      )
    : [];

  const groupChatWaifuIds = Array.from(new Set(requestedGroupWaifus));
  const fallbackGroupWaifuIds = getFallbackGroupWaifuIds(selectedWaifuId);

  return {
    ...merged,
    selectedWaifuId,
    groupChatEnabled: !!merged.groupChatEnabled,
    groupChatWaifuIds:
      groupChatWaifuIds.length >= 2 ? groupChatWaifuIds.slice(0, 4) : fallbackGroupWaifuIds,
  };
}

export async function loadAppState(): Promise<AppState> {
  try {
    const stored = await AsyncStorage.getItem(APP_STATE_STORAGE_KEY);
    if (!stored) {
      return DEFAULT_APP_STATE;
    }
    return normalizeAppState(JSON.parse(stored));
  } catch (err) {
    console.error("Failed to load app state:", err);
    return DEFAULT_APP_STATE;
  }
}

export async function saveAppState(state: Partial<AppState>): Promise<AppState> {
  const normalized = normalizeAppState(state);
  try {
    await AsyncStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(normalized));
  } catch (err) {
    console.error("Failed to save app state:", err);
  }
  return normalized;
}

export function useAppState() {
  const [state, setState] = useState<AppState>(DEFAULT_APP_STATE);
  const [isLoading, setIsLoading] = useState(true);

  // Load state from AsyncStorage
  useEffect(() => {
    const loadState = async () => {
      try {
        setState(await loadAppState());
      } finally {
        setIsLoading(false);
      }
    };

    loadState();
  }, []);

  // Save state to AsyncStorage
  const updateState = async (updates: Partial<AppState>) => {
    const newState = normalizeAppState({ ...state, ...updates });
    setState(newState);
    await saveAppState(newState);
  };

  return {
    state,
    isLoading,
    updateState,
  };
}
