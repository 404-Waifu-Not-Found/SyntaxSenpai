import { Stack } from "expo-router";

export default function MainLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="chat" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="scan" options={{ presentation: "modal" }} />
      <Stack.Screen name="pair-confirm" />
    </Stack>
  );
}
