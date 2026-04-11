import React, { useState, useRef, useEffect, useCallback } from "react";
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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { builtInWaifus } from "@syntax-senpai/waifu-core";
import { useTheme } from "../../src/hooks/useTheme";
import { useWsConnection, sendAgentRequest } from "../../src/hooks/useWsConnection";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export default function ChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { connectionState } = useWsConnection();
  const isPaired = connectionState === "paired";
  const isConnecting = connectionState === "connecting";

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedWaifuId, setSelectedWaifuId] = useState<string>(builtInWaifus[0]?.id || "aria");
  const scrollViewRef = useRef<ScrollView>(null);
  const pendingRemoteId = useRef<string | null>(null);

  const selectedWaifu = builtInWaifus.find((w) => w.id === selectedWaifuId) || builtInWaifus[0];

  useEffect(() => {
    const loadAppState = async () => {
      try {
        const state = await AsyncStorage.getItem("syntax-senpai-app-state");
        if (state) {
          const parsed = JSON.parse(state);
          setSelectedWaifuId(parsed.selectedWaifuId || builtInWaifus[0]?.id);
        }
      } catch (err) {
        console.error("Failed to load app state:", err);
      }
    };
    loadAppState();
  }, []);

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle stream chunks from remote desktop
  useWsConnection({
    onStreamChunk: useCallback((_convId: string, chunk: string) => {
      setMessages((prev) => {
        const id = pendingRemoteId.current;
        if (!id) return prev;
        const last = prev[prev.length - 1];
        if (last?.id === id) {
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        }
        const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return [...prev, { id, role: "assistant", content: chunk, timestamp: ts }];
      });
    }, []),
    onStreamEnd: useCallback((_convId: string, _final: string) => {
      pendingRemoteId.current = null;
      setIsLoading(false);
    }, []),
    onStreamError: useCallback((_convId: string, error: string) => {
      pendingRemoteId.current = null;
      setIsLoading(false);
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: `Error: ${error}`, timestamp: ts },
      ]);
    }, []),
  });

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading || !isPaired) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: inputValue,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const conversationId = `conv-${Date.now()}`;
      const assistantId = `assistant-remote-${Date.now()}`;
      pendingRemoteId.current = assistantId;

      const aiMessages = [...messages, userMessage].map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      sendAgentRequest({
        conversationId,
        messages: aiMessages,
        waifuId: selectedWaifuId,
        providerConfig: { type: "", apiKey: "", model: "" },
      });
    } catch (error) {
      setIsLoading(false);
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: error instanceof Error ? error.message : "An error occurred",
          timestamp: ts,
        },
      ]);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        {/* Top Bar */}
        <View
          style={{
            borderBottomWidth: 1,
            borderBottomColor: colors.surface,
            backgroundColor: colors.bg,
            paddingVertical: 12,
            paddingHorizontal: 16,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: isPaired ? "#10b981" : isConnecting ? "#f59e0b" : "#4b5563",
                }}
              />
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.fg }}>
                {selectedWaifu.displayName}
              </Text>
              <Text style={{ fontSize: 12, color: colors.fg + "60" }}>
                {isPaired
                  ? "· Connected to Desktop"
                  : isConnecting
                  ? "· Connecting..."
                  : "· Not connected"}
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/(main)/settings")}>
              <Text style={{ fontSize: 16, color: colors.fg + "80" }}>⚙</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Not connected state */}
        {!isPaired ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>🖥️</Text>
            <Text
              style={{
                fontSize: 20,
                fontWeight: "bold",
                color: colors.fg,
                textAlign: "center",
                marginBottom: 8,
              }}
            >
              {isConnecting ? "Connecting..." : "Connect to Desktop"}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: colors.fg + "80",
                textAlign: "center",
                lineHeight: 22,
                marginBottom: 28,
              }}
            >
              {isConnecting
                ? "Please wait while we establish a connection to your desktop."
                : "Open Settings and scan the QR code from your desktop app to start chatting via the desktop API."}
            </Text>
            {isConnecting ? (
              <ActivityIndicator color={colors.primary} size="large" />
            ) : (
              <TouchableOpacity
                style={{
                  backgroundColor: colors.primary,
                  paddingVertical: 14,
                  paddingHorizontal: 32,
                  borderRadius: 10,
                }}
                onPress={() => router.push("/(main)/settings")}
              >
                <Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "600" }}>Open Settings</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {/* Messages */}
            <ScrollView
              ref={scrollViewRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              onContentSizeChange={scrollToBottom}
            >
              {messages.length === 0 && (
                <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 40 }}>
                  <Text style={{ fontSize: 24, marginBottom: 8, textAlign: "center", color: "#ffffff" }}>
                    Chat with {selectedWaifu.displayName}
                  </Text>
                  <Text style={{ fontSize: 14, color: "#606060", textAlign: "center" }}>
                    Running on Desktop · Start a conversation!
                  </Text>
                </View>
              )}

              {messages.map((msg) => (
                <View key={msg.id} style={{ flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                  <View
                    style={{
                      maxWidth: "85%",
                      backgroundColor: msg.role === "user" ? colors.userBubble : colors.assistantBubble,
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontSize: 14, lineHeight: 20 }}>{msg.content}</Text>
                    <Text
                      style={{
                        fontSize: 12,
                        color: msg.role === "user" ? "#e0e0ff" : "#606060",
                        marginTop: 4,
                      }}
                    >
                      {msg.timestamp}
                    </Text>
                  </View>
                </View>
              ))}

              {isLoading && (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text style={{ color: "#a0a0a0", fontSize: 12 }}>
                    {selectedWaifu.displayName} is typing...
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Input Area */}
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.surface,
                backgroundColor: colors.bg,
                paddingVertical: 12,
                paddingHorizontal: 16,
                paddingBottom: Platform.OS === "ios" ? 20 : 12,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  alignItems: "flex-end",
                  borderWidth: 1,
                  borderColor: colors.surface2,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  backgroundColor: colors.surface,
                }}
              >
                <TextInput
                  style={{ flex: 1, color: colors.fg, paddingVertical: 12, fontSize: 14 }}
                  placeholder="Say something..."
                  placeholderTextColor={colors.fg + "40"}
                  value={inputValue}
                  onChangeText={setInputValue}
                  editable={!isLoading}
                  multiline
                />
                <TouchableOpacity
                  onPress={handleSendMessage}
                  disabled={!inputValue.trim() || isLoading}
                  style={{
                    backgroundColor: inputValue.trim() ? colors.primary : colors.surface2,
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
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
