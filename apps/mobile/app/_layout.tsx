import React from "react";
import { Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(main)" />
      </Stack>
    </GestureHandlerRootView>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View
        style={{
          flex: 1,
          backgroundColor: "#0f0f0f",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text style={{ color: "#ffffff", fontSize: 22, fontWeight: "700", marginBottom: 12 }}>
          App failed to load
        </Text>
        <Text style={{ color: "#d4d4d8", lineHeight: 22, marginBottom: 20 }}>
          {props.error.message || "Unknown startup error"}
        </Text>
        <Text
          onPress={props.retry}
          style={{ color: "#818cf8", fontSize: 16, fontWeight: "600" }}
        >
          Try again
        </Text>
      </View>
    </GestureHandlerRootView>
  );
}
