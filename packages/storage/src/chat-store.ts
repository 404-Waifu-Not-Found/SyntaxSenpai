/**
 * Chat Message & Conversation Storage
 * Uses JSON files for persistence on desktop
 */

import type { Message } from "@syntax-senpai/ai-core";
import type { WaifuRelationship } from "@syntax-senpai/waifu-core";
import type { IChatStore, ConversationRecord, IMemoryStore, MemoryEntry } from "./types";

/**
 * In-memory chat store (for testing)
 */
export class InMemoryChatStore implements IChatStore {
  private conversations = new Map<string, ConversationRecord>();
  private messages = new Map<string, Message[]>();
  private relationships = new Map<string, WaifuRelationship>();

  async createConversation(
    waifuId: string,
    title?: string
  ): Promise<ConversationRecord> {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const conversation: ConversationRecord = {
      id,
      waifuId,
      title: title || "Untitled Conversation",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      favorited: false,
    };
    this.conversations.set(id, conversation);
    this.messages.set(id, []);
    return conversation;
  }

  async getConversation(id: string): Promise<ConversationRecord | null> {
    return this.conversations.get(id) || null;
  }

  async listConversations(waifuId?: string): Promise<ConversationRecord[]> {
    return Array.from(this.conversations.values()).filter((c) =>
      waifuId ? c.waifuId === waifuId : true
    );
  }

  async updateConversation(
    id: string,
    updates: Partial<ConversationRecord>
  ): Promise<void> {
    const conv = this.conversations.get(id);
    if (conv) {
      this.conversations.set(id, { ...conv, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async deleteConversation(id: string): Promise<void> {
    this.conversations.delete(id);
    this.messages.delete(id);
  }

  async addMessage(conversationId: string, message: Message): Promise<void> {
    const messages = this.messages.get(conversationId) || [];
    messages.push(message);
    this.messages.set(conversationId, messages);

    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.messageCount = messages.length;
      conv.updatedAt = new Date().toISOString();
    }
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return this.messages.get(conversationId) || [];
  }

  async deleteMessages(conversationId: string, beforeDate?: string): Promise<void> {
    if (beforeDate) {
      const messages = this.messages.get(conversationId) || [];
      const filtered = messages.filter((m) => (m.createdAt || "") >= beforeDate);
      this.messages.set(conversationId, filtered);
    } else {
      this.messages.delete(conversationId);
    }
  }

  async setRelationship(relationship: WaifuRelationship): Promise<void> {
    const key = `${relationship.waifuId}:${relationship.userId}`;
    this.relationships.set(key, relationship);
  }

  async getRelationship(
    waifuId: string,
    userId: string
  ): Promise<WaifuRelationship | null> {
    return this.relationships.get(`${waifuId}:${userId}`) || null;
  }

  async updateRelationship(
    waifuId: string,
    userId: string,
    updates: Partial<WaifuRelationship>
  ): Promise<void> {
    const key = `${waifuId}:${userId}`;
    const current = this.relationships.get(key);
    if (current) {
      this.relationships.set(key, { ...current, ...updates });
    }
  }
}

/**
 * JSON-file-based chat store for desktop.
 * Replaces the SQLite store to avoid native-module issues with better-sqlite3.
 */
export class DesktopSQLiteChatStore implements IChatStore {
  private filePath: string;
  private data: {
    conversations: Record<string, ConversationRecord>;
    messages: Record<string, Message[]>;
    relationships: Record<string, WaifuRelationship>;
  };

  constructor(dbPath?: string) {
    const fs = require("fs");
    const path = require("path");

    // Derive JSON path from the provided path (swap .sqlite → .json, or use default)
    if (dbPath) {
      this.filePath = dbPath.replace(/\.sqlite$/, "") + ".json";
    } else {
      this.filePath = path.join(
        process.env.HOME || process.env.USERPROFILE || ".",
        ".syntax-senpai",
        "chats.json"
      );
    }

    // Ensure parent directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing data or start fresh
    if (fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      } catch {
        this.data = { conversations: {}, messages: {}, relationships: {} };
      }
    } else {
      this.data = { conversations: {}, messages: {}, relationships: {} };
    }
  }

  private flush(): void {
    try {
      const fs = require("fs");
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to write chat data:", err);
    }
  }

  async createConversation(
    waifuId: string,
    title?: string
  ): Promise<ConversationRecord> {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const conversation: ConversationRecord = {
      id,
      waifuId,
      title: title || "Untitled Conversation",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      favorited: false,
    };
    this.data.conversations[id] = conversation;
    this.data.messages[id] = [];
    this.flush();
    return conversation;
  }

  async getConversation(id: string): Promise<ConversationRecord | null> {
    return this.data.conversations[id] || null;
  }

  async listConversations(waifuId?: string): Promise<ConversationRecord[]> {
    const all = Object.values(this.data.conversations);
    const filtered = waifuId ? all.filter((c) => c.waifuId === waifuId) : all;
    return filtered.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  async updateConversation(
    id: string,
    updates: Partial<ConversationRecord>
  ): Promise<void> {
    const conv = this.data.conversations[id];
    if (!conv) return;

    // Only overwrite fields that are actually provided
    if (updates.title !== undefined) conv.title = updates.title;
    if (updates.summary !== undefined) conv.summary = updates.summary;
    if (updates.messageCount !== undefined) conv.messageCount = updates.messageCount;
    if (updates.favorited !== undefined) conv.favorited = updates.favorited;
    conv.updatedAt = new Date().toISOString();

    this.flush();
  }

  async deleteConversation(id: string): Promise<void> {
    delete this.data.conversations[id];
    delete this.data.messages[id];
    this.flush();
  }

  async addMessage(conversationId: string, message: Message): Promise<void> {
    if (!this.data.messages[conversationId]) {
      this.data.messages[conversationId] = [];
    }
    this.data.messages[conversationId].push({
      id: message.id,
      role: message.role,
      content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      createdAt: (message as any).timestamp || message.createdAt || new Date().toISOString(),
    } as any);

    const conv = this.data.conversations[conversationId];
    if (conv) {
      conv.messageCount = this.data.messages[conversationId].length;
      conv.updatedAt = new Date().toISOString();
    }
    this.flush();
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return this.data.messages[conversationId] || [];
  }

  async deleteMessages(conversationId: string, beforeDate?: string): Promise<void> {
    if (beforeDate) {
      const msgs = this.data.messages[conversationId] || [];
      this.data.messages[conversationId] = msgs.filter(
        (m) => ((m as any).createdAt || "") >= beforeDate
      );
    } else {
      this.data.messages[conversationId] = [];
    }
    this.flush();
  }

  async setRelationship(relationship: WaifuRelationship): Promise<void> {
    const key = `${relationship.waifuId}:${relationship.userId}`;
    this.data.relationships[key] = relationship;
    this.flush();
  }

  async getRelationship(
    waifuId: string,
    userId: string
  ): Promise<WaifuRelationship | null> {
    return this.data.relationships[`${waifuId}:${userId}`] || null;
  }

  async updateRelationship(
    waifuId: string,
    userId: string,
    updates: Partial<WaifuRelationship>
  ): Promise<void> {
    const key = `${waifuId}:${userId}`;
    const current = this.data.relationships[key];
    if (current) {
      this.data.relationships[key] = { ...current, ...updates };
      this.flush();
    }
  }

  async toggleFavorite(id: string): Promise<boolean> {
    const conv = this.data.conversations[id];
    if (!conv) return false;

    conv.favorited = !conv.favorited;
    conv.updatedAt = new Date().toISOString();
    this.flush();
    return !!conv.favorited;
  }
}

/**
 * JSON-file-based persistent AI memory store
 */
export class DesktopMemoryStore implements IMemoryStore {
  private filePath: string;
  private data: Record<string, MemoryEntry>;

  constructor(dbOrPath?: any) {
    const fs = require("fs");
    const path = require("path");

    const basePath = typeof dbOrPath === "string" ? dbOrPath : undefined;
    if (basePath) {
      this.filePath = basePath.replace(/\.sqlite$/, "") + "-memory.json";
    } else {
      this.filePath = path.join(
        process.env.HOME || process.env.USERPROFILE || ".",
        ".syntax-senpai",
        "memory.json"
      );
    }

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      } catch {
        this.data = {};
      }
    } else {
      this.data = {};
    }
  }

  private flush(): void {
    try {
      const fs = require("fs");
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to write memory data:", err);
    }
  }

  async setMemory(key: string, value: string, category = 'general'): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.data[key];
    this.data[key] = {
      key,
      value,
      category,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.flush();
  }

  async getMemory(key: string): Promise<MemoryEntry | null> {
    return this.data[key] || null;
  }

  async getAllMemories(): Promise<MemoryEntry[]> {
    return Object.values(this.data).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  async getMemoriesByCategory(category: string): Promise<MemoryEntry[]> {
    return Object.values(this.data)
      .filter((m) => m.category === category)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  async deleteMemory(key: string): Promise<void> {
    delete this.data[key];
    this.flush();
  }

  async clearAllMemories(): Promise<void> {
    this.data = {};
    this.flush();
  }
}

/**
 * Create chat store for the platform
 */
export function createChatStore(platform: "mobile" | "desktop" | "test" = "desktop", dbPath?: string): IChatStore {
  if (platform === "test" || platform === "mobile") {
    return new InMemoryChatStore();
  }
  return new DesktopSQLiteChatStore(dbPath);
}

/**
 * Create memory store for persistent AI memory
 */
export function createMemoryStore(dbPath?: string): IMemoryStore {
  return new DesktopMemoryStore(dbPath);
}
