import React, { useState } from "react";
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { APIKeyManager } from "@syntax-senpai/storage";
import { builtInWaifus } from "@syntax-senpai/waifu-core";

type OnboardingStep = "welcome" | "select-waifu" | "setup-api" | "done";

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", displayName: "Claude 3.5" },
  { id: "openai", name: "OpenAI", displayName: "GPT-4o" },
  { id: "groq", name: "Groq", displayName: "Groq (Free)" },
  { id: "together-ai", name: "Together AI", displayName: "Together AI" },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [selectedWaifu, setSelectedWaifu] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleStart = () => {
    setStep("select-waifu");
  };

  const handleWaifuSelect = (waifuId: string) => {
    setSelectedWaifu(waifuId);
    setStep("setup-api");
  };

  const handleSetupComplete = async () => {
    if (!apiKey.trim()) {
      setError("Please enter an API key");
      return;
    }
    if (!selectedWaifu) {
      setError("Please select a waifu");
      return;
    }

    setIsLoading(true);
    try {
      const keyManager = new APIKeyManager("mobile");
      await keyManager.setKey(selectedProvider, apiKey);

      // Persist app state
      await AsyncStorage.setItem(
        "syntax-senpai-app-state",
        JSON.stringify({
          selectedWaifuId: selectedWaifu,
          selectedProvider,
          hasCompletedOnboarding: true,
        })
      );

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save setup");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === "setup-api") {
      setSelectedWaifu(null);
      setStep("select-waifu");
      setError("");
    } else if (step === "select-waifu") {
      setStep("welcome");
      setError("");
    }
  };

  const handleDone = () => {
    router.replace("/(main)/chat");
  };

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: "#0f0f0f",
      }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 16,
      }}
    >
      {/* Welcome Step */}
      {step === "welcome" && (
        <View style={{ width: "100%", maxWidth: 400, alignItems: "center" }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: "#6366f1",
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <Text style={{ fontSize: 48 }}>✨</Text>
          </View>

          <Text
            style={{
              fontSize: 28,
              fontWeight: "bold",
              color: "#ffffff",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            SyntaxSenpai
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: "#a0a0a0",
              marginBottom: 24,
              textAlign: "center",
            }}
          >
            Your AI companion that codes with you
          </Text>

          <View style={{ marginBottom: 24, gap: 12 }}>
            <Text style={{ color: "#d0d0d0", fontSize: 14, textAlign: "center" }}>
              ✓ Chat with your waifu in real-time
            </Text>
            <Text style={{ color: "#d0d0d0", fontSize: 14, textAlign: "center" }}>
              ✓ Get help with coding and more
            </Text>
            <Text style={{ color: "#d0d0d0", fontSize: 14, textAlign: "center" }}>
              ✓ All conversations saved locally
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleStart}
            style={{
              backgroundColor: "#6366f1",
              paddingVertical: 12,
              paddingHorizontal: 32,
              borderRadius: 8,
              width: "100%",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
              Let's Begin
            </Text>
          </TouchableOpacity>

          <Text style={{ fontSize: 12, color: "#606060", textAlign: "center" }}>
            Takes less than a minute to set up
          </Text>
        </View>
      )}

      {/* Select Waifu Step */}
      {step === "select-waifu" && (
        <View style={{ width: "100%", maxWidth: 400 }}>
          <Text
            style={{
              fontSize: 24,
              fontWeight: "bold",
              color: "#ffffff",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            Choose Your Waifu
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: "#a0a0a0",
              marginBottom: 24,
              textAlign: "center",
            }}
          >
            Pick your favorite AI companion
          </Text>

          <View
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginBottom: 24,
            }}
          >
            {builtInWaifus.map((waifu) => (
              <TouchableOpacity
                key={waifu.id}
                onPress={() => handleWaifuSelect(waifu.id)}
                style={{
                  padding: 16,
                  borderRadius: 8,
                  borderWidth: 2,
                  borderColor:
                    selectedWaifu === waifu.id ? "#6366f1" : "#333333",
                  backgroundColor:
                    selectedWaifu === waifu.id
                      ? "rgba(99, 102, 241, 0.1)"
                      : "#1a1a1a",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color: "#ffffff",
                  }}
                >
                  {waifu.displayName}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity
              onPress={handleBack}
              style={{
                flex: 1,
                backgroundColor: "#2a2a2a",
                paddingVertical: 12,
                borderRadius: 8,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
                Back
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => selectedWaifu && handleWaifuSelect(selectedWaifu)}
              disabled={!selectedWaifu}
              style={{
                flex: 1,
                backgroundColor: selectedWaifu ? "#6366f1" : "#1a1a1a",
                paddingVertical: 12,
                borderRadius: 8,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
                Continue
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Setup API Step */}
      {step === "setup-api" && selectedWaifu && (
        <View style={{ width: "100%", maxWidth: 400 }}>
          <Text
            style={{
              fontSize: 24,
              fontWeight: "bold",
              color: "#ffffff",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            Setup Your AI Provider
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: "#a0a0a0",
              marginBottom: 24,
              textAlign: "center",
            }}
          >
            Choose which AI service to use
          </Text>

          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: "#d0d0d0", fontSize: 14, marginBottom: 8 }}>
              AI Provider
            </Text>
            <View
              style={{
                borderWidth: 1,
                borderColor: "#333333",
                borderRadius: 8,
                backgroundColor: "#1a1a1a",
                overflow: "hidden",
              }}
            >
              <TouchableOpacity
                style={{
                  padding: 12,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#ffffff" }}>
                  {PROVIDERS.find((p) => p.id === selectedProvider)?.displayName}
                </Text>
                <Text style={{ color: "#a0a0a0" }}>▼</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: "#606060", marginTop: 8 }}>
              Get a free API key from your chosen provider
            </Text>
          </View>

          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: "#d0d0d0", fontSize: 14, marginBottom: 8 }}>
              API Key
            </Text>
            <TextInput
              placeholder="sk-..."
              placeholderTextColor="#606060"
              secureTextEntry
              value={apiKey}
              onChangeText={(text) => {
                setApiKey(text);
                setError("");
              }}
              style={{
                borderWidth: 1,
                borderColor: error ? "#ef4444" : "#333333",
                borderRadius: 8,
                backgroundColor: "#1a1a1a",
                color: "#ffffff",
                padding: 12,
                fontSize: 14,
              }}
            />
            {error && (
              <Text style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>
                {error}
              </Text>
            )}
          </View>

          <View
            style={{
              backgroundColor: "rgba(26, 26, 26, 0.5)",
              borderWidth: 1,
              borderColor: "#333333",
              borderRadius: 8,
              padding: 12,
              marginBottom: 24,
            }}
          >
            <Text style={{ fontSize: 12, color: "#d0d0d0" }}>
              💡 Your API key is stored securely and never sent to our servers.
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity
              onPress={handleBack}
              style={{
                flex: 1,
                backgroundColor: "#2a2a2a",
                paddingVertical: 12,
                borderRadius: 8,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
                Back
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSetupComplete}
              disabled={isLoading}
              style={{
                flex: 1,
                backgroundColor: "#6366f1",
                paddingVertical: 12,
                borderRadius: 8,
                alignItems: "center",
              }}
            >
              {isLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
                  Get Started
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Done Step */}
      {step === "done" && (
        <View style={{ width: "100%", maxWidth: 400, alignItems: "center" }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>🎉</Text>
          <Text
            style={{
              fontSize: 24,
              fontWeight: "bold",
              color: "#ffffff",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            You're All Set!
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: "#a0a0a0",
              marginBottom: 24,
              textAlign: "center",
            }}
          >
            Start chatting with your waifu now
          </Text>

          <TouchableOpacity
            onPress={handleDone}
            style={{
              backgroundColor: "#6366f1",
              paddingVertical: 12,
              paddingHorizontal: 32,
              borderRadius: 8,
              width: "100%",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
              Open Chat
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}
