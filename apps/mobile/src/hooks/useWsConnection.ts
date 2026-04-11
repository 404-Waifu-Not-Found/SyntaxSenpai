import { useState, useEffect, useRef, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type {
  WSMessage,
  PairAcceptedPayload,
  StreamChunkPayload,
  StreamEndPayload,
  StreamErrorPayload,
} from "@syntax-senpai/ws-protocol";

export type ConnectionState = "disconnected" | "connecting" | "paired" | "error";

interface PersistedConnection {
  wsUrl: string;
  sessionId: string;
}

const STORAGE_KEY = "syntax-senpai-ws-connection";
const DEVICE_ID_KEY = "syntax-senpai-device-id";
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 3000;

// Module-level singleton shared across all hook instances
interface WsState {
  connectionState: ConnectionState;
  sessionId: string | null;
  deviceName: string;
  wsUrl: string | null;
  errorMessage: string | null;
}

let wsState: WsState = {
  connectionState: "disconnected",
  sessionId: null,
  deviceName: "My Phone",
  wsUrl: null,
  errorMessage: null,
};

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const stateListeners = new Set<() => void>();
type StreamChunkHandler = (requestId: string, chunk: string) => void;
type StreamEndHandler = (requestId: string, finalMessage: string) => void;
type StreamErrorHandler = (requestId: string, error: string) => void;

let onStreamChunkCb: StreamChunkHandler | null = null;
let onStreamEndCb: StreamEndHandler | null = null;
let onStreamErrorCb: StreamErrorHandler | null = null;

function createMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function notifyListeners() {
  stateListeners.forEach((fn) => fn());
}

function setState(updates: Partial<WsState>) {
  wsState = { ...wsState, ...updates };
  notifyListeners();
}

async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing) return existing;
    // Generate a simple UUID-like string
    const id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return "mobile-device";
  }
}

function handleWsMessage(raw: string) {
  let msg: WSMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type === "pair_accepted") {
    const payload = msg.payload as PairAcceptedPayload;
    setState({
      connectionState: "paired",
      sessionId: payload.sessionId,
      errorMessage: null,
    });
    reconnectAttempts = 0;
    // Persist for reconnection
    if (wsState.wsUrl) {
      AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ wsUrl: wsState.wsUrl, sessionId: payload.sessionId } as PersistedConnection)
      ).catch(() => {});
    }
    return;
  }

  if (msg.type === "pair_rejected") {
    setState({ connectionState: "error", errorMessage: "Pairing rejected by desktop" });
    ws?.close();
    return;
  }

  if (msg.type === "stream_chunk") {
    const payload = msg.payload as StreamChunkPayload;
    if (payload.chunk.type === "text_delta" && payload.chunk.delta) {
      onStreamChunkCb?.(payload.conversationId, payload.chunk.delta);
    }
    return;
  }

  if (msg.type === "stream_end") {
    const payload = msg.payload as StreamEndPayload;
    onStreamEndCb?.(payload.conversationId, payload.finalMessage);
    return;
  }

  if (msg.type === "stream_error") {
    const payload = msg.payload as StreamErrorPayload;
    onStreamErrorCb?.(payload.conversationId, payload.error);
    return;
  }

  if (msg.type === "pong") {
    return;
  }
}

function openSocket(url: string, token: string, deviceId: string) {
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
  }

  setState({ connectionState: "connecting", wsUrl: url, errorMessage: null });

  ws = new WebSocket(url);

  ws.onopen = () => {
    const pairRequest: WSMessage = {
      id: createMessageId(),
      type: "pair_request",
      payload: {
        deviceName: wsState.deviceName,
        deviceId,
        publicKey: "",
      },
      timestamp: Date.now(),
    };
    ws?.send(JSON.stringify(pairRequest));
  };

  ws.onmessage = (event) => {
    handleWsMessage(event.data);
  };

  ws.onerror = () => {
    setState({ connectionState: "error", errorMessage: "Connection error" });
  };

  ws.onclose = () => {
    const wasPaired = wsState.connectionState === "paired";
    if (wasPaired && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      setState({ connectionState: "connecting" });
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => {
        if (wsState.wsUrl) {
          getOrCreateDeviceId().then((id) => {
            openSocket(wsState.wsUrl!, token, id);
          });
        }
      }, RECONNECT_DELAY_MS);
    } else if (!wasPaired) {
      setState({ connectionState: "disconnected" });
    } else {
      setState({ connectionState: "disconnected", errorMessage: "Lost connection to desktop" });
    }
  };
}

export async function connectToDesktop(wsUrl: string, token: string): Promise<void> {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts = 0;
  const deviceId = await getOrCreateDeviceId();
  openSocket(wsUrl, token, deviceId);
}

export function disconnectFromDesktop(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent auto-reconnect
  ws?.close();
  ws = null;
  setState({ connectionState: "disconnected", sessionId: null, wsUrl: null, errorMessage: null });
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

export function sendAgentRequest(payload: {
  conversationId: string;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  waifuId: string;
  providerConfig: { type: string; apiKey: string; model: string };
}): void {
  if (!ws || wsState.connectionState !== "paired") return;

  const msg: WSMessage = {
    id: createMessageId(),
    type: "agent_request",
    payload: {
      ...payload,
      relationshipSnapshot: {
        waifuId: payload.waifuId,
        userId: "mobile-user",
        affectionLevel: 40,
        selectedAIProvider: payload.providerConfig.type,
        selectedModel: payload.providerConfig.model,
        createdAt: new Date().toISOString(),
        lastInteractedAt: new Date().toISOString(),
      },
    },
    timestamp: Date.now(),
  };
  ws.send(JSON.stringify(msg));
}

export function useWsConnection(options?: {
  onStreamChunk?: StreamChunkHandler;
  onStreamEnd?: StreamEndHandler;
  onStreamError?: StreamErrorHandler;
}) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (options?.onStreamChunk) onStreamChunkCb = options.onStreamChunk;
    if (options?.onStreamEnd) onStreamEndCb = options.onStreamEnd;
    if (options?.onStreamError) onStreamErrorCb = options.onStreamError;
  });

  useEffect(() => {
    const update = () => forceUpdate((n) => n + 1);
    stateListeners.add(update);
    return () => { stateListeners.delete(update); };
  }, []);

  const connect = useCallback((wsUrl: string, token: string) => {
    return connectToDesktop(wsUrl, token);
  }, []);

  const disconnect = useCallback(() => {
    disconnectFromDesktop();
  }, []);

  return {
    connectionState: wsState.connectionState,
    sessionId: wsState.sessionId,
    wsUrl: wsState.wsUrl,
    errorMessage: wsState.errorMessage,
    connect,
    disconnect,
  };
}
