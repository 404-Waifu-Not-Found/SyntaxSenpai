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
import { useFocusEffect, useRouter } from "expo-router";
import { builtInWaifus } from "@syntax-senpai/waifu-core";
import type {
  StreamChunkPayload,
  StreamEndPayload,
  StreamErrorPayload,
} from "@syntax-senpai/ws-protocol";
import { useTheme } from "../../src/hooks/useTheme";
import { useWsConnection, sendAgentRequest } from "../../src/hooks/useWsConnection";
import { DEFAULT_APP_STATE, loadAppState, type AppState } from "../../src/hooks/useAppState";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  waifuId?: string;
  authorName?: string;
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
  const [appState, setAppState] = useState<AppState>(DEFAULT_APP_STATE);
  const scrollViewRef = useRef<ScrollView>(null);
  const conversationIdRef = useRef<string>(`conv-${Date.now()}`);
  const pendingClearVerificationRef = useRef(false);

  const selectedWaifu =
    builtInWaifus.find((waifu) => waifu.id === appState.selectedWaifuId) || builtInWaifus[0];
  const groupChatWaifus = appState.groupChatWaifuIds
    .map((waifuId) => builtInWaifus.find((waifu) => waifu.id === waifuId))
    .filter((waifu): waifu is (typeof builtInWaifus)[number] => !!waifu);
  const isGroupChat = appState.groupChatEnabled && groupChatWaifus.length > 1;
  const activeWaifus = isGroupChat ? groupChatWaifus : [selectedWaifu];
  const headerTitle = isGroupChat
    ? activeWaifus.map((waifu) => waifu.displayName).join(" · ")
    : selectedWaifu.displayName;

  useFocusEffect(
    useCallback(() => {
      loadAppState().then(setAppState).catch(() => {});
    }, [])
  );

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle stream chunks from remote desktop
  useWsConnection({
    onStreamChunk: useCallback(
      (_convId: string, chunk: string, meta: Pick<StreamChunkPayload, "messageId" | "waifuId" | "authorName" | "turnComplete">) => {
      const id = meta.messageId || `assistant-${meta.waifuId || "unknown"}`;
      const authorName =
        meta.authorName ||
        builtInWaifus.find((waifu) => waifu.id === meta.waifuId)?.displayName ||
        "Assistant";

      setMessages((prev) => {
        const existingIndex = prev.findIndex((msg) => msg.id === id);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = {
            ...next[existingIndex],
            content: next[existingIndex].content + chunk,
          };
          return next;
        }

        const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return [
          ...prev,
          {
            id,
            role: "assistant",
            content: chunk,
            timestamp: ts,
            waifuId: meta.waifuId,
            authorName,
          },
        ];
      });
    }, []),
    onStreamEnd: useCallback((_convId: string, final: string, payload: StreamEndPayload) => {
      const id = payload.messageId || `assistant-${payload.waifuId || "unknown"}`;
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setMessages((prev) => {
        const existingIndex = prev.findIndex((msg) => msg.id === id);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = {
            ...next[existingIndex],
            content: final || next[existingIndex].content,
            timestamp: next[existingIndex].timestamp || ts,
            waifuId: payload.waifuId || next[existingIndex].waifuId,
            authorName:
              payload.authorName ||
              next[existingIndex].authorName ||
              builtInWaifus.find((waifu) => waifu.id === payload.waifuId)?.displayName,
          };
          return next;
        }

        if (!final) return prev;

        return [
          ...prev,
          {
            id,
            role: "assistant",
            content: final,
            timestamp: ts,
            waifuId: payload.waifuId,
            authorName:
              payload.authorName ||
              builtInWaifus.find((waifu) => waifu.id === payload.waifuId)?.displayName,
          },
        ];
      });

      if (payload.turnComplete) {
        setIsLoading(false);
      }
    }, []),
    onStreamError: useCallback((_convId: string, error: string, payload: StreamErrorPayload) => {
      if (payload.turnComplete ?? true) {
        setIsLoading(false);
      }
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setMessages((prev) => [
        ...prev,
        {
          id: payload.messageId || `err-${Date.now()}`,
          role: "assistant",
          content: `Error: ${error}`,
          timestamp: ts,
          waifuId: payload.waifuId,
          authorName: payload.authorName,
        },
      ]);
    }, []),
  });

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading || !isPaired) return;

    const trimmedInput = inputValue.trim();
    const isClearCommand = /^\/clear$/i.test(trimmedInput);
    const isVerifyDeletionCommand = /^\/(?:verify|vierfy)\s+deletion$/i.test(trimmedInput);

    if (isClearCommand) {
      pendingClearVerificationRef.current = true;
      setInputValue("");
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: "Type /verify deletion to clear this chat history. (Conversation ID will stay the same.)",
          timestamp: ts,
        },
      ]);
      return;
    }

    if (pendingClearVerificationRef.current) {
      if (isVerifyDeletionCommand) {
        pendingClearVerificationRef.current = false;
        setInputValue("");
        setMessages([]);
      } else {
        pendingClearVerificationRef.current = false;
      }
      return;
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedInput,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const conversationId = conversationIdRef.current;
      const aiMessages = [...messages, userMessage].map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        waifuId: m.waifuId,
        authorName: m.authorName,
      }));

      sendAgentRequest({
        conversationId,
        messages: aiMessages,
        waifuId: selectedWaifu.id,
        providerConfig: { type: "", apiKey: "", model: "" },
        groupChat: {
          enabled: isGroupChat,
          waifuIds: activeWaifus.map((waifu) => waifu.id),
          maxRounds: 2,
        },
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
                {headerTitle}
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
                    {isGroupChat
                      ? `Group Chat with ${activeWaifus.map((waifu) => waifu.displayName).join(", ")}`
                      : `Chat with ${selectedWaifu.displayName}`}
                  </Text>
                  <Text style={{ fontSize: 14, color: "#606060", textAlign: "center" }}>
                    {isGroupChat
                      ? "Running on Desktop · The waifus can collaborate and hand tasks to each other."
                      : "Running on Desktop · Start a conversation!"}
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
                    {msg.role === "assistant" && msg.authorName && (
                      <Text
                        style={{
                          color: colors.primary,
                          fontSize: 12,
                          fontWeight: "700",
                          marginBottom: 6,
                        }}
                      >
                        {msg.authorName}
                      </Text>
                    )}
                    <Text style={{ color: colors.fg, fontSize: 14, lineHeight: 20 }}>{msg.content}</Text>
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
                    {isGroupChat ? "Group chat is replying..." : `${selectedWaifu.displayName} is typing...`}
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
                  placeholder={isGroupChat ? "Message the group or /cmd ls" : "Say something or /cmd ls"}
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
