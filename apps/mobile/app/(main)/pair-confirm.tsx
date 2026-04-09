import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useWsConnection } from "../../src/hooks/useWsConnection";
import { useTheme } from "../../src/hooks/useTheme";

export default function PairConfirmScreen() {
  const router = useRouter();
  const { wsUrl, token } = useLocalSearchParams<{ wsUrl: string; token: string }>();
  const { colors } = useTheme();
  const { connectionState, errorMessage, connect } = useWsConnection();
  const [didConnect, setDidConnect] = useState(false);

  useEffect(() => {
    if (wsUrl && token && !didConnect) {
      setDidConnect(true);
      connect(wsUrl, token);
    }
  }, [wsUrl, token, didConnect, connect]);

  // Navigate back to chat once paired
  useEffect(() => {
    if (connectionState === "paired") {
      const timer = setTimeout(() => {
        router.replace("/(main)/chat");
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [connectionState, router]);

  const hostDisplay = wsUrl
    ? wsUrl.replace("ws://", "").split(":")[0]
    : "desktop";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.content}>
        {connectionState === "connecting" && (
          <>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.title, { color: colors.fg }]}>Connecting...</Text>
            <Text style={[styles.subtitle, { color: colors.fg + "80" }]}>
              Connecting to {hostDisplay}
            </Text>
          </>
        )}

        {connectionState === "paired" && (
          <>
            <View style={[styles.successIcon, { backgroundColor: "#10b98120" }]}>
              <Text style={styles.successEmoji}>✓</Text>
            </View>
            <Text style={[styles.title, { color: colors.fg }]}>Connected!</Text>
            <Text style={[styles.subtitle, { color: colors.fg + "80" }]}>
              Your phone is now paired with the desktop chatbot.
            </Text>
          </>
        )}

        {connectionState === "error" && (
          <>
            <View style={[styles.errorIcon, { backgroundColor: "#ef444420" }]}>
              <Text style={styles.errorEmoji}>✕</Text>
            </View>
            <Text style={[styles.title, { color: colors.fg }]}>Connection Failed</Text>
            <Text style={[styles.subtitle, { color: colors.fg + "80" }]}>
              {errorMessage || "Could not connect to the desktop app."}
            </Text>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (wsUrl && token) connect(wsUrl, token);
              }}
            >
              <Text style={styles.buttonText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonOutline, { borderColor: colors.primary }]}
              onPress={() => router.replace("/(main)/scan")}
            >
              <Text style={[styles.buttonOutlineText, { color: colors.primary }]}>Scan Again</Text>
            </TouchableOpacity>
          </>
        )}

        {connectionState === "disconnected" && !didConnect && (
          <>
            <Text style={[styles.title, { color: colors.fg }]}>No QR Data</Text>
            <Text style={[styles.subtitle, { color: colors.fg + "80" }]}>
              Please go back and scan a QR code first.
            </Text>
          </>
        )}

        {(connectionState === "error" || connectionState === "disconnected") && (
          <TouchableOpacity
            style={styles.cancelLink}
            onPress={() => router.back()}
          >
            <Text style={[styles.cancelText, { color: colors.fg + "60" }]}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  successEmoji: {
    fontSize: 32,
    color: "#10b981",
    fontWeight: "bold",
  },
  errorIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  errorEmoji: {
    fontSize: 32,
    color: "#ef4444",
    fontWeight: "bold",
  },
  button: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  buttonOutline: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  buttonOutlineText: {
    fontSize: 15,
    fontWeight: "600",
  },
  cancelLink: {
    marginTop: 8,
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 14,
  },
});
