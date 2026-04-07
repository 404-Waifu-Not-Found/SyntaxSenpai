import React, { useState, useRef, useEffect } from "react";
import {
  View,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { AIChatRuntime } from "@syntax-senpai/ai-core";
import { APIKeyManager } from "@syntax-senpai/storage";
import { builtInWaifus } from "@syntax-senpai/waifu-core";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export default function ChatScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedWaifuId, setSelectedWaifuId] = useState<string>(builtInWaifus[0]?.id || "aria");
  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [isInitializing, setIsInitializing] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const scrollViewRef = useRef<ScrollView>(null);

  const selectedWaifu = builtInWaifus.find((w) => w.id === selectedWaifuId) || builtInWaifus[0];

  useEffect(() => {
    const loadAppState = async () => {
      try {
        const state = await AsyncStorage.getItem("syntax-senpai-app-state");
        if (state) {
          const parsed = JSON.parse(state);
          setSelectedWaifuId(parsed.selectedWaifuId || builtInWaifus[0]?.id);
          setSelectedProvider(parsed.selectedProvider || "anthropic");
          if (!parsed.hasCompletedOnboarding) {
            setShowSettings(true);
          }
        } else {
          setShowSettings(true);
        }
      } catch (err) {
        console.error("Failed to load app state:", err);
        setShowSettings(true);
      } finally {
        setIsInitializing(false);
      }
    };

    loadAppState();
  }, []);

  const handleSetup = async (apiKey: string) => {
    if (!apiKey.trim()) {
      Alert.alert("Error", "Please enter an API key");
      return;
    }

    try {
      const keyManager = new APIKeyManager("mobile");
      await keyManager.setKey(selectedProvider, apiKey);

      await AsyncStorage.setItem(
        "syntax-senpai-app-state",
        JSON.stringify({
          selectedWaifuId,
          selectedProvider,
          hasCompletedOnboarding: true,
        })
      );

      setShowSettings(false);
      setApiKeyInput("");
    } catch (err) {
      Alert.alert("Setup Failed", err instanceof Error ? err.message : "Unknown error");
    }
  };

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: inputValue,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const keyManager = new APIKeyManager("mobile");
      const apiKey = await keyManager.getKey(selectedProvider);

      if (!apiKey) {
        throw new Error(`No API key configured for ${selectedProvider}`);
      }

      const runtime = new AIChatRuntime({
        provider: {
          type: selectedProvider as any,
          apiKey,
        } as any,
        model: selectedProvider === "openai" ? "gpt-4o" : "claude-3-5-sonnet-20241022",
        systemPrompt: `You are ${selectedWaifu.displayName}. ${selectedWaifu.backstory}`,
      });

      const aiMessages = messages.map((msg) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content: msg.content,
      }));

      let assistantContent = "";
      const assistantId = `assistant-${Date.now()}`;
      let added = false;

      for await (const chunk of runtime.streamMessage({
        text: userMessage.content,
        history: aiMessages,
      })) {
        if (chunk.type === "text_delta" && chunk.delta) {
          assistantContent += chunk.delta;

          if (!added) {
            setMessages((prev) => [...prev, {
              id: assistantId,
              role: "assistant",
              content: assistantContent,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }]);
            added = true;
          } else {
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg?.id === assistantId && lastMsg.role === "assistant") {
                return [
                  ...prev.slice(0, -1),
                  { ...lastMsg, content: assistantContent },
                ];
              }
              return prev;
            });
          }
        }
      }
    } catch (error) {
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: error instanceof Error ? error.message : "An error occurred",
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  if (isInitializing) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color="#6366f1" size="large" />
      </SafeAreaView>
    );
  }

  if (showSettings) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
          <Text style={{ fontSize: 28, marginBottom: 16, textAlign: "center", color: "white", fontWeight: "bold" }}>
            Setup SyntaxSenpai
          </Text>

          <View style={{ width: "100%", marginBottom: 20 }}>
            <Text style={{ color: "#d0d0d0", fontSize: 14, marginBottom: 8 }}>Waifu</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {builtInWaifus.map((w) => (
                <TouchableOpacity
                  key={w.id}
                  onPress={() => setSelectedWaifuId(w.id)}
                  style={{
                    padding: 12,
                    marginRight: 8,
                    borderRadius: 8,
                    backgroundColor: selectedWaifuId === w.id ? "#6366f1" : "#1a1a1a",
                    borderWidth: 2,
                    borderColor: selectedWaifuId === w.id ? "#6366f1" : "#333333",
                  }}
                >
                  <Text style={{ color: "white", fontWeight: selectedWaifuId === w.id ? "bold" : "normal" }}>
                    {w.displayName}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={{ width: "100%", marginBottom: 20 }}>
            <Text style={{ color: "#d0d0d0", fontSize: 14, marginBottom: 8 }}>Provider</Text>
            {["anthropic", "openai", "gemini", "groq"].map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setSelectedProvider(p)}
                style={{
                  padding: 12,
                  marginBottom: 8,
                  borderRadius: 8,
                  backgroundColor: selectedProvider === p ? "#6366f1" : "#1a1a1a",
                  borderWidth: 1,
                  borderColor: "#333333",
                }}
              >
                <Text style={{ color: "white", fontWeight: selectedProvider === p ? "bold" : "normal" }}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ width: "100%", marginBottom: 24 }}>
            <Text style={{ color: "#d0d0d0", fontSize: 14, marginBottom: 8 }}>API Key</Text>
            <TextInput
              placeholder="sk-..."
              placeholderTextColor="#606060"
              secureTextEntry
              value={apiKeyInput}
              onChangeText={setApiKeyInput}
              style={{
                backgroundColor: "#1a1a1a",
                borderWidth: 1,
                borderColor: "#333333",
                borderRadius: 8,
                color: "white",
                padding: 12,
                fontSize: 14,
              }}
            />
          </View>

          <TouchableOpacity
            onPress={() => handleSetup(apiKeyInput)}
            style={{
              width: "100%",
              backgroundColor: "#6366f1",
              padding: 16,
              borderRadius: 8,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "white", fontWeight: "bold", fontSize: 16 }}>
              Get Started
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        {/* Top Bar */}
        <View style={{
          borderBottomWidth: 1,
          borderBottomColor: "#1a1a1a",
          backgroundColor: "#0f0f0f",
          paddingVertical: 12,
          paddingHorizontal: 16,
        }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#10b981" }} />
              <Text style={{ fontSize: 12, fontWeight: "600", color: "#a0a0a0" }}>
                {selectedWaifu.displayName} · Online
              </Text>
            </View>
            <TouchableOpacity onPress={() => setShowSettings(true)}>
              <Text style={{ fontSize: 16 }}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Messages */}
        <ScrollView ref={scrollViewRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }} onContentSizeChange={scrollToBottom}>
          {messages.length === 0 && (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 40 }}>
              <Text style={{ fontSize: 24, marginBottom: 8, textAlign: "center", color: "#ffffff" }}>
                Chat with {selectedWaifu.displayName}
              </Text>
              <Text style={{ fontSize: 14, color: "#606060", textAlign: "center" }}>
                Start a conversation!
              </Text>
            </View>
          )}

          {messages.map((msg) => (
            <View key={msg.id} style={{ flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
              <View style={{
                maxWidth: "85%",
                backgroundColor: msg.role === "user" ? "#6366f1" : "#1a1a1a",
                borderRadius: 12,
                padding: 12,
              }}>
                <Text style={{ color: "#ffffff", fontSize: 14, lineHeight: 20 }}>
                  {msg.content}
                </Text>
                <Text style={{
                  fontSize: 12,
                  color: msg.role === "user" ? "#e0e0ff" : "#606060",
                  marginTop: 4,
                }}>
                  {msg.timestamp}
                </Text>
              </View>
            </View>
          ))}

          {isLoading && (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
              <ActivityIndicator color="#6366f1" size="small" />
              <Text style={{ color: "#a0a0a0", fontSize: 12 }}>
                {selectedWaifu.displayName} is typing...
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Input Area */}
        <View style={{
          borderTopWidth: 1,
          borderTopColor: "#1a1a1a",
          backgroundColor: "#0f0f0f",
          paddingVertical: 12,
          paddingHorizontal: 16,
          paddingBottom: Platform.OS === "ios" ? 20 : 12,
        }}>
          <View style={{
            flexDirection: "row",
            gap: 8,
            alignItems: "flex-end",
            borderWidth: 1,
            borderColor: "#333333",
            borderRadius: 12,
            paddingHorizontal: 12,
            backgroundColor: "#1a1a1a",
          }}>
            <TextInput
              style={{ flex: 1, color: "#ffffff", paddingVertical: 12, fontSize: 14 }}
              placeholder="Say something..."
              placeholderTextColor="#606060"
              value={inputValue}
              onChangeText={setInputValue}
              editable={!isLoading}
              multiline
            />
            <TouchableOpacity
              onPress={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              style={{
                backgroundColor: inputValue.trim() ? "#6366f1" : "#2a2a2a",
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 8,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {isLoading ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={{ color: "white", fontWeight: "600" }}>Send</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
