import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { loadThemeFromStorage, THEME_PRESETS } from "../src/hooks/useTheme";
import { loadAppState } from "../src/hooks/useAppState";

export default function IndexScreen() {
  const router = useRouter();
  const [targetHref, setTargetHref] = useState<"/(main)/chat" | "/(onboarding)" | null>(null);
  const [didTimeout, setDidTimeout] = useState(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDidTimeout(true);
    }, 4000);

    const bootstrap = async () => {
      await loadThemeFromStorage().catch(() => {});

      try {
        const state = await loadAppState();
        setTargetHref(state.hasCompletedOnboarding ? "/(main)/chat" : "/(onboarding)");
      } catch (err) {
        console.error("Failed to check onboarding:", err);
        setTargetHref("/(onboarding)");
      }
    };

    bootstrap();

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  if (targetHref) {
    return <Redirect href={targetHref} />;
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: THEME_PRESETS[0].colors.bg,
        padding: 24,
      }}
    >
      <ActivityIndicator color={THEME_PRESETS[0].colors.primary} size="large" />
      <Text
        style={{
          color: THEME_PRESETS[0].colors.fg,
          marginTop: 16,
          fontSize: 16,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        Loading SyntaxSenpai...
      </Text>
      {didTimeout && (
        <View style={{ marginTop: 24, width: "100%", maxWidth: 320, gap: 12 }}>
          <Text
            style={{
              color: THEME_PRESETS[0].colors.fg,
              opacity: 0.8,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            Startup is taking longer than expected. You can continue to onboarding manually.
          </Text>
          <TouchableOpacity
            onPress={() => router.replace("/(onboarding)")}
            style={{
              backgroundColor: THEME_PRESETS[0].colors.primary,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "700" }}>
              Open Onboarding
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
