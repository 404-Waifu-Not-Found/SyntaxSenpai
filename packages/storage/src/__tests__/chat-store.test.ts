import { describe, it, expect } from "vitest";
import { InMemoryChatStore } from "../chat-store";

function makeMsg(id: string, content = "hi") {
  return {
    id,
    role: "user" as const,
    content,
    createdAt: new Date().toISOString(),
  };
}

describe("InMemoryChatStore", () => {
  it("creates and fetches conversations", async () => {
    const store = new InMemoryChatStore();
    const conv = await store.createConversation("aria", "Test");
    expect(conv.waifuId).toBe("aria");
    expect(conv.title).toBe("Test");
    expect(conv.messageCount).toBe(0);

    const fetched = await store.getConversation(conv.id);
    expect(fetched?.id).toBe(conv.id);
  });

  it("appends messages and updates messageCount", async () => {
    const store = new InMemoryChatStore();
    const conv = await store.createConversation("aria");
    await store.addMessage(conv.id, makeMsg("m1"));
    await store.addMessage(conv.id, makeMsg("m2"));

    const msgs = await store.getMessages(conv.id);
    expect(msgs).toHaveLength(2);
    const refreshed = await store.getConversation(conv.id);
    expect(refreshed?.messageCount).toBe(2);
  });

  it("lists conversations filtered by waifuId", async () => {
    const store = new InMemoryChatStore();
    await store.createConversation("aria", "A");
    await store.createConversation("sakura", "B");
    await store.createConversation("aria", "C");

    expect(await store.listConversations("aria")).toHaveLength(2);
    expect(await store.listConversations()).toHaveLength(3);
  });

  it("updates conversation fields", async () => {
    const store = new InMemoryChatStore();
    const conv = await store.createConversation("aria", "Old");
    await store.updateConversation(conv.id, { title: "New" });
    const refreshed = await store.getConversation(conv.id);
    expect(refreshed?.title).toBe("New");
  });

  it("deletes conversations and their messages", async () => {
    const store = new InMemoryChatStore();
    const conv = await store.createConversation("aria");
    await store.addMessage(conv.id, makeMsg("m1"));
    await store.deleteConversation(conv.id);
    expect(await store.getConversation(conv.id)).toBeNull();
    expect(await store.getMessages(conv.id)).toEqual([]);
  });

  it("deletes a single message and decrements count", async () => {
    const store = new InMemoryChatStore();
    const conv = await store.createConversation("aria");
    await store.addMessage(conv.id, makeMsg("m1"));
    await store.addMessage(conv.id, makeMsg("m2"));
    await store.deleteMessage?.(conv.id, "m1");
    const msgs = await store.getMessages(conv.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("m2");
    expect((await store.getConversation(conv.id))?.messageCount).toBe(1);
  });

  it("stores and updates relationships", async () => {
    const store = new InMemoryChatStore();
    await store.setRelationship({
      waifuId: "aria",
      userId: "u1",
      affectionLevel: 10,
      selectedAIProvider: "anthropic",
      selectedModel: "claude-sonnet-4-6",
      createdAt: new Date().toISOString(),
      lastInteractedAt: new Date().toISOString(),
    });

    const r = await store.getRelationship("aria", "u1");
    expect(r?.affectionLevel).toBe(10);

    await store.updateRelationship("aria", "u1", { affectionLevel: 42 });
    expect((await store.getRelationship("aria", "u1"))?.affectionLevel).toBe(42);
  });
});
