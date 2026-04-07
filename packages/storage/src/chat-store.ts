/**
 * Chat Message & Conversation Storage
 * Uses SQLite for persistence across all platforms
 */

import type { Message } from "@syntax-senpai/ai-core";
import type { WaifuRelationship } from "@syntax-senpai/waifu-core";
import type { IChatStore, ConversationRecord } from "./types";

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
 * SQLite-based chat store for desktop
 */
export class DesktopSQLiteChatStore implements IChatStore {
  private db: any;

  constructor(dbPath?: string) {
    // Database will be initialized on first use
    this.initDB(dbPath);
  }

  private initDB(dbPath?: string): void {
    try {
      // Lazy load better-sqlite3
      const Database = require("better-sqlite3");
      this.db = new Database(dbPath || ":memory:");

      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          waifu_id TEXT NOT NULL,
          title TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          summary TEXT,
          message_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          tool_calls TEXT,
          tool_call_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        );

        CREATE TABLE IF NOT EXISTS waifu_relationships (
          waifu_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          affection_level INTEGER DEFAULT 0,
          memory_summary TEXT,
          selected_provider TEXT NOT NULL,
          selected_model TEXT NOT NULL,
          nickname TEXT,
          created_at TEXT NOT NULL,
          last_interacted_at TEXT NOT NULL,
          PRIMARY KEY (waifu_id, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_waifu ON conversations(waifu_id);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      `);
    } catch (error) {
      console.warn("SQLite not available, using in-memory store");
      this.db = null;
    }
  }

  async createConversation(
    waifuId: string,
    title?: string
  ): Promise<ConversationRecord> {
    if (!this.db) return new InMemoryChatStore().createConversation(waifuId, title);

    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, waifu_id, title, created_at, updated_at, message_count)
      VALUES (?, ?, ?, ?, ?, 0)
    `);
    stmt.run(id, waifuId, title || "Untitled Conversation", now, now);

    return {
      id,
      waifuId,
      title: title || "Untitled Conversation",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };
  }

  async getConversation(id: string): Promise<ConversationRecord | null> {
    if (!this.db) return null;

    const stmt = this.db.prepare(`
      SELECT id, waifu_id, title, created_at, updated_at, message_count, summary
      FROM conversations WHERE id = ?
    `);
    const row = stmt.get(id) as any;
    return row ? this.rowToConversation(row) : null;
  }

  async listConversations(waifuId?: string): Promise<ConversationRecord[]> {
    if (!this.db) return [];

    const query = waifuId
      ? "SELECT * FROM conversations WHERE waifu_id = ? ORDER BY updated_at DESC"
      : "SELECT * FROM conversations ORDER BY updated_at DESC";

    const stmt = this.db.prepare(query);
    const rows = waifuId ? stmt.all(waifuId) : stmt.all();
    return rows.map((row: any) => this.rowToConversation(row));
  }

  async updateConversation(
    id: string,
    updates: Partial<ConversationRecord>
  ): Promise<void> {
    if (!this.db) return;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE conversations
      SET title = ?, summary = ?, message_count = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(
      updates.title,
      updates.summary,
      updates.messageCount,
      now,
      id
    );
  }

  async deleteConversation(id: string): Promise<void> {
    if (!this.db) return;

    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  async addMessage(conversationId: string, message: Message): Promise<void> {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, tool_calls, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      message.id,
      conversationId,
      message.role,
      typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.createdAt || new Date().toISOString()
    );

    // Update conversation message count
    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?");
    const { count } = countStmt.get(conversationId) as any;
    const updateStmt = this.db.prepare("UPDATE conversations SET message_count = ?, updated_at = ? WHERE id = ?");
    updateStmt.run(count, new Date().toISOString(), conversationId);
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    if (!this.db) return [];

    const stmt = this.db.prepare(`
      SELECT id, role, content, tool_calls, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(conversationId) as any[];
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      createdAt: row.created_at,
    }));
  }

  async deleteMessages(conversationId: string, beforeDate?: string): Promise<void> {
    if (!this.db) return;

    if (beforeDate) {
      this.db.prepare("DELETE FROM messages WHERE conversation_id = ? AND created_at < ?").run(
        conversationId,
        beforeDate
      );
    } else {
      this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
    }
  }

  async setRelationship(relationship: WaifuRelationship): Promise<void> {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO waifu_relationships
      (waifu_id, user_id, affection_level, memory_summary, selected_provider, selected_model, nickname, created_at, last_interacted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      relationship.waifuId,
      relationship.userId,
      relationship.affectionLevel || 0,
      relationship.memorySummary || null,
      relationship.selectedAIProvider,
      relationship.selectedModel,
      relationship.nickname || null,
      relationship.createdAt,
      relationship.lastInteractedAt
    );
  }

  async getRelationship(
    waifuId: string,
    userId: string
  ): Promise<WaifuRelationship | null> {
    if (!this.db) return null;

    const stmt = this.db.prepare(`
      SELECT * FROM waifu_relationships
      WHERE waifu_id = ? AND user_id = ?
    `);
    const row = stmt.get(waifuId, userId) as any;
    return row ? this.rowToRelationship(row) : null;
  }

  async updateRelationship(
    waifuId: string,
    userId: string,
    updates: Partial<WaifuRelationship>
  ): Promise<void> {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      UPDATE waifu_relationships
      SET affection_level = ?, memory_summary = ?, last_interacted_at = ?
      WHERE waifu_id = ? AND user_id = ?
    `);
    stmt.run(
      updates.affectionLevel,
      updates.memorySummary,
      new Date().toISOString(),
      waifuId,
      userId
    );
  }

  private rowToConversation(row: any): ConversationRecord {
    return {
      id: row.id,
      waifuId: row.waifu_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      summary: row.summary,
    };
  }

  private rowToRelationship(row: any): WaifuRelationship {
    return {
      waifuId: row.waifu_id,
      userId: row.user_id,
      affectionLevel: row.affection_level,
      memorySummary: row.memory_summary,
      selectedAIProvider: row.selected_provider,
      selectedModel: row.selected_model,
      nickname: row.nickname,
      createdAt: row.created_at,
      lastInteractedAt: row.last_interacted_at,
    };
  }
}

/**
 * Create chat store for the platform
 */
export function createChatStore(platform: "mobile" | "desktop" | "test" = "desktop"): IChatStore {
  if (platform === "test" || platform === "mobile") {
    return new InMemoryChatStore();
  }
  return new DesktopSQLiteChatStore();
}
