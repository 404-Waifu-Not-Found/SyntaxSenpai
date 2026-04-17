import { useState, useEffect, useRef, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type {
  WSMessage,
  PairAcceptedPayload,
  StreamChunkPayload,
  StreamEndPayload,
  StreamErrorPayload,
  MobileChatMessage,
} from "@syntax-senpai/ws-protocol";

export type ConnectionState = "disconnected" | "connecting" | "paired" | "error";

interface PersistedConnection {
  wsUrl: string;
  sessionId: string;
  reconnectCandidates?: string[];
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
let reconnectCandidates: string[] = [];
let currentReconnectIndex = 0;
let hasAttemptedRestore = false;

const stateListeners = new Set<() => void>();
type StreamEndHandler = (requestId: string, finalMessage: string, payload: StreamEndPayload) => void;
type StreamErrorHandler = (requestId: string, error: string, payload: StreamErrorPayload) => void;
type StreamMessageMeta = Pick<StreamChunkPayload, "messageId" | "waifuId" | "authorName" | "turnComplete">;
type RichStreamChunkHandler = (requestId: string, chunk: string, meta: StreamMessageMeta) => void;

let onStreamChunkCb: RichStreamChunkHandler | null = null;
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

function normalizeReconnectCandidates(primaryUrl: string, extras: string[] = []) {
  return Array.from(
    new Set(
      [primaryUrl, ...extras].filter(
        (value): value is string => typeof value === "string" && value.startsWith("ws://")
      )
    )
  );
}

function setReconnectTargets(primaryUrl: string, extras: string[] = []) {
  reconnectCandidates = normalizeReconnectCandidates(primaryUrl, extras);
  currentReconnectIndex = reconnectCandidates.findIndex((url) => url === primaryUrl);
  if (currentReconnectIndex < 0) currentReconnectIndex = 0;
}

function getNextReconnectUrl() {
  if (reconnectCandidates.length === 0) {
    return wsState.wsUrl;
  }
  const nextUrl = reconnectCandidates[currentReconnectIndex % reconnectCandidates.length];
  currentReconnectIndex = (currentReconnectIndex + 1) % reconnectCandidates.length;
  return nextUrl;
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
        JSON.stringify({
          wsUrl: wsState.wsUrl,
          sessionId: payload.sessionId,
          reconnectCandidates,
        } as PersistedConnection)
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
      onStreamChunkCb?.(payload.conversationId, payload.chunk.delta, {
        messageId: payload.messageId,
        waifuId: payload.waifuId,
        authorName: payload.authorName,
        turnComplete: payload.turnComplete,
      });
    }
    return;
  }

  if (msg.type === "stream_end") {
    const payload = msg.payload as StreamEndPayload;
    onStreamEndCb?.(payload.conversationId, payload.finalMessage, payload);
    return;
  }

  if (msg.type === "stream_error") {
    const payload = msg.payload as StreamErrorPayload;
    onStreamErrorCb?.(payload.conversationId, payload.error, payload);
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
        const nextUrl = getNextReconnectUrl();
        if (nextUrl) {
          getOrCreateDeviceId().then((id) => {
            openSocket(nextUrl, token, id);
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

export async function connectToDesktop(
  wsUrl: string,
  token: string,
  options?: { reconnectCandidates?: string[] }
): Promise<void> {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts = 0;
  setReconnectTargets(wsUrl, options?.reconnectCandidates || []);
  const deviceId = await getOrCreateDeviceId();
  openSocket(wsUrl, token, deviceId);
}

export function disconnectFromDesktop(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent auto-reconnect
  ws?.close();
  ws = null;
  reconnectCandidates = [];
  currentReconnectIndex = 0;
  setState({ connectionState: "disconnected", sessionId: null, wsUrl: null, errorMessage: null });
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

export function sendAgentRequest(payload: {
  conversationId: string;
  messages: MobileChatMessage[];
  waifuId: string;
  providerConfig: { type: string; apiKey: string; model: string };
  groupChat?: {
    enabled: boolean;
    waifuIds: string[];
    maxRounds?: number;
  };
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
  onStreamChunk?: RichStreamChunkHandler;
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

  useEffect(() => {
    if (hasAttemptedRestore) return;
    hasAttemptedRestore = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw || ws || wsState.connectionState === "paired" || wsState.connectionState === "connecting") {
          return;
        }

        const parsed = JSON.parse(raw) as PersistedConnection;
        if (!parsed?.wsUrl) return;

        return connectToDesktop(parsed.wsUrl, "", {
          reconnectCandidates: parsed.reconnectCandidates || [],
        }).catch(() => {});
      })
      .catch(() => {});
  }, []);

  const connect = useCallback((wsUrl: string, token: string, options?: { reconnectCandidates?: string[] }) => {
    return connectToDesktop(wsUrl, token, options);
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
