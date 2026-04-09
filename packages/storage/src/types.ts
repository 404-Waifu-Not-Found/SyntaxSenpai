/**
 * Storage abstraction types
 */

import type { Message } from "@syntax-senpai/ai-core";
import type { WaifuRelationship } from "@syntax-senpai/waifu-core";

/**
 * Platform-agnostic keystore interface
 */
export interface KeystoreAdapter {
  set(service: string, account: string, secret: string): Promise<void>;
  get(service: string, account: string): Promise<string | null>;
  delete(service: string, account: string): Promise<void>;
  list(service: string): Promise<string[]>;
}

/**
 * High-level API key manager
 */
export interface IAPIKeyManager {
  setKey(providerId: string, key: string): Promise<void>;
  getKey(providerId: string): Promise<string | null>;
  deleteKey(providerId: string): Promise<void>;
  hasKey(providerId: string): Promise<boolean>;
  listConfiguredProviders(): Promise<string[]>;
}

/**
 * Chat store interface
 */
export interface IChatStore {
  // Conversations
  createConversation(
    waifuId: string,
    title?: string
  ): Promise<ConversationRecord>;
  getConversation(id: string): Promise<ConversationRecord | null>;
  listConversations(waifuId?: string): Promise<ConversationRecord[]>;
  updateConversation(
    id: string,
    updates: Partial<ConversationRecord>
  ): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  // Messages
  addMessage(conversationId: string, message: Message): Promise<void>;
  getMessages(conversationId: string): Promise<Message[]>;
  deleteMessages(conversationId: string, beforeDate?: string): Promise<void>;

  // Relationships
  setRelationship(relationship: WaifuRelationship): Promise<void>;
  getRelationship(waifuId: string, userId: string): Promise<WaifuRelationship | null>;
  updateRelationship(
    waifuId: string,
    userId: string,
    updates: Partial<WaifuRelationship>
  ): Promise<void>;
}

/**
 * Conversation record in database
 */
export interface ConversationRecord {
  id: string;
  waifuId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  messageCount: number;
  favorited?: boolean;
}

/**
 * A single AI memory entry persisted across chats
 */
export interface MemoryEntry {
  key: string;
  value: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Persistent AI memory store interface
 */
export interface IMemoryStore {
  setMemory(key: string, value: string, category?: string): Promise<void>;
  getMemory(key: string): Promise<MemoryEntry | null>;
  getAllMemories(): Promise<MemoryEntry[]>;
  getMemoriesByCategory(category: string): Promise<MemoryEntry[]>;
  deleteMemory(key: string): Promise<void>;
  clearAllMemories(): Promise<void>;
}

/**
 * Encryption key derivation options
 */
export interface KeyDerivationOptions {
  iterations?: number;
  algorithm?: string;
  salt?: Buffer;
}
