/**
 * WebSocket protocol types for phone↔desktop communication
 */

import type { Message, StreamChunk } from "@syntax-senpai/ai-core";
import type { WaifuRelationship } from "@syntax-senpai/waifu-core";

export type WSMessageType =
  // Pairing & auth
  | "pair_request"
  | "pair_accepted"
  | "pair_rejected"
  | "ping"
  | "pong"
  // Agent delegation
  | "agent_request"
  | "agent_response"
  | "stream_chunk"
  | "stream_end"
  | "stream_error"
  // Tool execution
  | "tool_result"
  // State sync
  | "waifu_state_sync"
  | "settings_sync"
  | "error";

/**
 * Base WebSocket message envelope
 */
export interface WSMessage<T = unknown> {
  id: string; // uuid for request/response correlation
  type: WSMessageType;
  payload: T;
  timestamp: number;
}

/**
 * Pairing initiation from mobile
 */
export interface PairRequestPayload {
  deviceName: string;
  deviceId: string; // persistent uuid stored on mobile
  publicKey: string; // ECDH public key for session key derivation
}

/**
 * Pairing accepted by desktop
 */
export interface PairAcceptedPayload {
  deviceId: string;
  sessionId: string;
  publicKey: string; // desktop's ECDH public key
  pin?: string; // optional 6-digit PIN for TOFU confirmation
}

/**
 * Pairing rejected
 */
export interface PairRejectedPayload {
  reason: string;
}

/**
 * Mobile requests desktop to execute an agent turn
 */
export interface AgentRequestPayload {
  conversationId: string;
  messages: MobileChatMessage[];
  waifuId: string;
  relationshipSnapshot: WaifuRelationship;
  providerConfig: {
    type: string;
    apiKey: string;
    model: string;
  };
  groupChat?: {
    enabled: boolean;
    waifuIds: string[];
    maxRounds?: number;
  };
}

export interface MobileChatMessage extends Message {
  waifuId?: string;
  authorName?: string;
}

/**
 * Desktop streams back response chunks
 */
export interface StreamChunkPayload {
  conversationId: string;
  chunk: StreamChunk;
  messageId?: string;
  waifuId?: string;
  authorName?: string;
  turnComplete?: boolean;
}

/**
 * Stream completed successfully
 */
export interface StreamEndPayload {
  conversationId: string;
  finalMessage: string;
  messageId?: string;
  waifuId?: string;
  authorName?: string;
  turnComplete?: boolean;
}

/**
 * Stream encountered error
 */
export interface StreamErrorPayload {
  conversationId: string;
  error: string;
  messageId?: string;
  waifuId?: string;
  authorName?: string;
  turnComplete?: boolean;
}

/**
 * Desktop syncs current waifu state to mobile
 */
export interface WaifuStateSyncPayload {
  waifuId: string;
  relationship: WaifuRelationship;
}

/**
 * Settings sync between devices
 */
export interface SettingsSyncPayload {
  key: string;
  value: unknown;
  direction: "mobile->desktop" | "desktop->mobile";
}

/**
 * Error payload for generic error messages
 */
export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Type guards
 */
export function isPairRequest(msg: WSMessage): msg is WSMessage<PairRequestPayload> {
  return msg.type === "pair_request";
}

export function isAgentRequest(msg: WSMessage): msg is WSMessage<AgentRequestPayload> {
  return msg.type === "agent_request";
}

export function isStreamChunk(msg: WSMessage): msg is WSMessage<StreamChunkPayload> {
  return msg.type === "stream_chunk";
}
