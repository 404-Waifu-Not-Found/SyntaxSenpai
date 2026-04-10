import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SplashScreen from "expo-splash-screen";
import { Stack, useRouter } from "expo-router";
import { loadThemeFromStorage } from "../src/hooks/useTheme";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    const checkOnboarding = async () => {
      await loadThemeFromStorage().catch(() => {});
      try {
        const state = await AsyncStorage.getItem("syntax-senpai-app-state");
        if (state) {
          const parsed = JSON.parse(state);
          setHasCompletedOnboarding(parsed.hasCompletedOnboarding || false);
        } else {
          setHasCompletedOnboarding(false);
        }
      } catch (err) {
        console.error("Failed to check onboarding:", err);
        setHasCompletedOnboarding(false);
      } finally {
        await SplashScreen.hideAsync();
      }
    };

    checkOnboarding();
  }, []);

  useEffect(() => {
    if (hasCompletedOnboarding === true) {
      router.replace("/(main)/chat");
    } else if (hasCompletedOnboarding === false) {
      router.replace("/(onboarding)");
    }
  }, [hasCompletedOnboarding, router]);

  if (hasCompletedOnboarding === null) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(main)" />
      </Stack>
    </GestureHandlerRootView>
  );
}
