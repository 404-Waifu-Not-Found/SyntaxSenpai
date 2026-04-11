import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  Alert,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { APIKeyManager } from "@syntax-senpai/storage";
import { PROVIDERS_WITH_MODELS } from "../../src/constants/providers";
import { useTheme, THEME_PRESETS } from "../../src/hooks/useTheme";
import { useWsConnection, disconnectFromDesktop } from "../../src/hooks/useWsConnection";

const KEY_PROVIDERS = PROVIDERS_WITH_MODELS.slice(0, 6);

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, presetId, setPreset } = useTheme();
  const { connectionState } = useWsConnection();
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});

  const isPaired = connectionState === "paired";
  const isConnecting = connectionState === "connecting";
  const connectionDot = isPaired ? "#10b981" : isConnecting ? "#f59e0b" : "#4b5563";
  const connectionLabel = isPaired
    ? "Connected to Desktop"
    : isConnecting
    ? "Connecting..."
    : "Not connected";

  useEffect(() => {
    const checkKeys = async () => {
      const keyManager = new APIKeyManager("mobile");
      const results: Record<string, boolean> = {};
      for (const p of KEY_PROVIDERS) {
        results[p.id] = await keyManager.hasKey(p.id);
      }
      setSavedKeys(results);
    };
    checkKeys();
  }, []);

  const saveApiKey = async (providerId: string) => {
    const key = keyInputs[providerId]?.trim();
    if (!key) {
      Alert.alert("Error", "Please enter an API key");
      return;
    }
    try {
      const keyManager = new APIKeyManager("mobile");
      await keyManager.setKey(providerId, key);
      setSavedKeys((prev) => ({ ...prev, [providerId]: true }));
      setKeyInputs((prev) => ({ ...prev, [providerId]: "" }));
      setEditingProvider(null);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to save key");
    }
  };

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

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
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
                  <View style={styles.swatches}>
                    {preset.swatchColors.map((color, i) => (
                      <View key={i} style={[styles.swatch, { backgroundColor: color }]} />
                    ))}
                  </View>
                  <Text
                    style={[styles.presetName, { color: selected ? colors.primary : colors.fg }]}
                    numberOfLines={1}
                  >
                    {preset.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* API Keys Section */}
        <Text style={[styles.sectionTitle, { color: colors.fg + "80", marginTop: 24 }]}>
          API KEYS
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.cardDesc, { color: colors.fg + "70" }]}>
            Stored securely on this device. Used when not connected to desktop.
          </Text>
          {KEY_PROVIDERS.map((provider, idx) => (
            <View
              key={provider.id}
              style={[
                styles.keyRow,
                idx < KEY_PROVIDERS.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.surface2,
                },
              ]}
            >
              <View style={styles.keyRowHeader}>
                <Text style={[styles.keyRowLabel, { color: colors.fg }]}>{provider.label}</Text>
                <View style={styles.keyRowRight}>
                  {savedKeys[provider.id] && editingProvider !== provider.id && (
                    <View style={[styles.keyBadge, { backgroundColor: "#10b98120" }]}>
                      <Text style={styles.keyBadgeText}>SET</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    onPress={() =>
                      setEditingProvider(editingProvider === provider.id ? null : provider.id)
                    }
                  >
                    <Text style={[styles.keyAction, { color: colors.primary }]}>
                      {editingProvider === provider.id
                        ? "Cancel"
                        : savedKeys[provider.id]
                        ? "Update"
                        : "Set"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              {editingProvider === provider.id && (
                <View style={{ marginTop: 10, gap: 8 }}>
                  <TextInput
                    placeholder="Paste API key..."
                    placeholderTextColor={colors.fg + "40"}
                    secureTextEntry
                    value={keyInputs[provider.id] || ""}
                    onChangeText={(text) =>
                      setKeyInputs((prev) => ({ ...prev, [provider.id]: text }))
                    }
                    style={[styles.keyInput, { color: colors.fg, backgroundColor: colors.surface2 }]}
                    autoFocus
                  />
                  <TouchableOpacity
                    style={[styles.saveKeyBtn, { backgroundColor: colors.primary }]}
                    onPress={() => saveApiKey(provider.id)}
                  >
                    <Text style={styles.saveKeyBtnText}>Save Key</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* Desktop Connection Section */}
        <Text style={[styles.sectionTitle, { color: colors.fg + "80", marginTop: 24 }]}>
          DESKTOP CONNECTION
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.cardDesc, { color: colors.fg + "70" }]}>
            Connect to your desktop app to use its API key and run AI through the desktop.
          </Text>

          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: connectionDot }]} />
            <Text style={[styles.statusLabel, { color: colors.fg }]}>{connectionLabel}</Text>
          </View>

          {!isPaired && (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push("/(main)/scan")}
              disabled={isConnecting}
            >
              <Text style={styles.primaryBtnText}>
                {isConnecting ? "Connecting..." : "Scan QR Code"}
              </Text>
            </TouchableOpacity>
          )}

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
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: 40, alignItems: "flex-start" },
  backIcon: { fontSize: 28, lineHeight: 32, fontWeight: "300" },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  scrollContent: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: { borderRadius: 14, padding: 14 },
  themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  presetCard: { width: "46%", borderRadius: 10, padding: 12, borderWidth: 2 },
  swatches: { flexDirection: "row", gap: 6, marginBottom: 8 },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  presetName: { fontSize: 12, fontWeight: "600" },
  cardDesc: { fontSize: 13, lineHeight: 20, marginBottom: 14 },
  keyRow: { paddingVertical: 12 },
  keyRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  keyRowLabel: { fontSize: 14, fontWeight: "500" },
  keyRowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  keyBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  keyBadgeText: { color: "#10b981", fontSize: 10, fontWeight: "700" },
  keyAction: { fontSize: 13, fontWeight: "600" },
  keyInput: {
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  saveKeyBtn: { paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  saveKeyBtnText: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 14, fontWeight: "500" },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryBtnText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  outlineBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  outlineBtnText: { fontSize: 15, fontWeight: "600" },
});
