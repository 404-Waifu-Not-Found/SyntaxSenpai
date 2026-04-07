import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SplashScreen from "expo-splash-screen";
import { Stack, useRouter } from "expo-router";

// Prevent splash screen from auto hiding
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null);

  React.useEffect(() => {
    // Check onboarding status
    const checkOnboarding = async () => {
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

  // Redirect based on onboarding status
  useEffect(() => {
    if (hasCompletedOnboarding === true) {
      router.replace("/(main)/chat");
    } else if (hasCompletedOnboarding === false) {
      router.replace("/(onboarding)");
    }
  }, [hasCompletedOnboarding, router]);

  if (hasCompletedOnboarding === null) {
    return null; // Still loading
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
