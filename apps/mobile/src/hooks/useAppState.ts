import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { builtInWaifus } from "@syntax-senpai/waifu-core";

interface AppState {
  selectedWaifuId: string;
  selectedProvider: string;
  selectedModel?: string;
  hasCompletedOnboarding: boolean;
}

const DEFAULT_STATE: AppState = {
  selectedWaifuId: builtInWaifus[0]?.id || "aria",
  selectedProvider: "anthropic",
  hasCompletedOnboarding: false,
};

const STORAGE_KEY = "syntax-senpai-app-state";

export function useAppState() {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(true);

  // Load state from AsyncStorage
  useEffect(() => {
    const loadState = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          setState(JSON.parse(stored));
        }
      } catch (err) {
        console.error("Failed to load app state:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadState();
  }, []);

  // Save state to AsyncStorage
  const updateState = async (updates: Partial<AppState>) => {
    const newState = { ...state, ...updates };
    setState(newState);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    } catch (err) {
      console.error("Failed to save app state:", err);
    }
  };

  return {
    state,
    isLoading,
    updateState,
  };
}
