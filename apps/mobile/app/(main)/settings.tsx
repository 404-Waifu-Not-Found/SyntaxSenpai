import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme, THEME_PRESETS } from "../../src/hooks/useTheme";
import { useWsConnection, disconnectFromDesktop } from "../../src/hooks/useWsConnection";

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, presetId, setPreset } = useTheme();
  const { connectionState } = useWsConnection();

  const isPaired = connectionState === "paired";
  const isConnecting = connectionState === "connecting";

  const connectionDot = isPaired ? "#10b981" : isConnecting ? "#f59e0b" : "#4b5563";
  const connectionLabel = isPaired
    ? "Connected to Desktop"
    : isConnecting
    ? "Connecting..."
    : "Not connected";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.surface }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.fg }]}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Theme Section */}
        <Text style={[styles.sectionTitle, { color: colors.fg + "80" }]}>THEME</Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.themeGrid}>
            {THEME_PRESETS.map((preset) => {
              const selected = preset.id === presetId;
              return (
                <TouchableOpacity
                  key={preset.id}
                  style={[
                    styles.presetCard,
                    { backgroundColor: colors.surface2, borderColor: selected ? colors.primary : "transparent" },
                  ]}
                  onPress={() => setPreset(preset.id)}
                  activeOpacity={0.7}
                >
                  {/* Color swatches */}
                  <View style={styles.swatches}>
                    {preset.swatchColors.map((color, i) => (
                      <View
                        key={i}
                        style={[styles.swatch, { backgroundColor: color }]}
                      />
                    ))}
                  </View>
                  <Text
                    style={[
                      styles.presetName,
                      { color: selected ? colors.primary : colors.fg },
                    ]}
                    numberOfLines={1}
                  >
                    {preset.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Desktop Connection Section */}
        <Text style={[styles.sectionTitle, { color: colors.fg + "80", marginTop: 24 }]}>
          DESKTOP CONNECTION
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.cardDesc, { color: colors.fg + "70" }]}>
            Pair your phone to use the chatbot on your computer remotely via your local network.
          </Text>

          {/* Status Row */}
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: connectionDot }]} />
            <Text style={[styles.statusLabel, { color: colors.fg }]}>{connectionLabel}</Text>
          </View>

          {/* Scan Button */}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/(main)/scan")}
          >
            <Text style={styles.primaryBtnText}>
              {isPaired ? "Scan New QR Code" : "Scan QR Code"}
            </Text>
          </TouchableOpacity>

          {/* Disconnect Button */}
          {isPaired && (
            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: "#ef4444" }]}
              onPress={() => disconnectFromDesktop()}
            >
              <Text style={[styles.outlineBtnText, { color: "#ef4444" }]}>Disconnect</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 40,
    alignItems: "flex-start",
  },
  backIcon: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "300",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 14,
    padding: 14,
  },
  themeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  presetCard: {
    width: "46%",
    borderRadius: 10,
    padding: 12,
    borderWidth: 2,
  },
  swatches: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
  },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  presetName: {
    fontSize: 12,
    fontWeight: "600",
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  outlineBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  outlineBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
