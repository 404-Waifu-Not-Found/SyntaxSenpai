import { describe, it, expect, vi } from "vitest";

import { Endpoint } from "../api";
import { WeChatIlinkBot, getMessageText } from "../bot";
import type { Credentials, WeixinMessage } from "../types";

const CREDS: Credentials = { token: "tok", uin: "uin", userId: "self" };

function rawResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Park a fetch call until the request's abort signal fires, then reject. */
function parkUntilAbort(signal?: AbortSignal | null): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    if (!signal) return; // never resolves, but tests must use a signal
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });
}

describe("WeChatIlinkBot.loop", () => {
  it("emits a 'message' event for each inbound, skips own bot echoes, advances cursor", async () => {
    const inbound: WeixinMessage = {
      message_id: 1,
      from_user_id: "peer",
      to_user_id: "self",
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "yo" } }],
      context_token: "ctx",
    };
    const ownEcho: WeixinMessage = { message_id: 2, from_user_id: "self", message_type: 2 };

    let call = 0;
    let firstCursor: string | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(url).toContain(Endpoint.GET_UPDATES);
      call++;
      if (call === 1) {
        firstCursor = body.get_updates_buf ?? "";
        return rawResponse({ ret: 0, msgs: [inbound, ownEcho], get_updates_buf: "c1" });
      }
      return parkUntilAbort(init?.signal);
    });

    const bot = new WeChatIlinkBot(CREDS, { fetchImpl });
    const received: WeixinMessage[] = [];
    bot.on("message", (m) => received.push(m));
    bot.start();

    // Wait one microtask cycle for the first poll to resolve.
    await new Promise((r) => setTimeout(r, 20));

    bot.stop();
    await new Promise((r) => setTimeout(r, 20));

    expect(received).toEqual([inbound]);
    expect(firstCursor).toBe(""); // first request sends empty cursor
    expect(getMessageText(inbound)).toBe("yo");
  });

  it("emits a repeated inbound message only once when iLink replays it", async () => {
    const inbound: WeixinMessage = {
      message_id: 7,
      from_user_id: "peer",
      message_type: 1,
      item_list: [{ type: 1, text_item: { text: "only once" } }],
    };
    let call = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      call++;
      if (call <= 2) return rawResponse({ ret: 0, msgs: [inbound], get_updates_buf: `c${call}` });
      return parkUntilAbort(init?.signal);
    });
    const bot = new WeChatIlinkBot(CREDS, { fetchImpl });
    const received: WeixinMessage[] = [];
    bot.on("message", (message) => received.push(message));
    bot.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    bot.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(received).toEqual([inbound]);
  });
  it("emits 'expired' on errcode -14 and stops the loop", async () => {
    const fetchImpl = vi.fn(async () => rawResponse({ ret: 0, errcode: -14, errmsg: "x" }));
    const bot = new WeChatIlinkBot(CREDS, { fetchImpl, minRetryMs: 5 });
    const expired = vi.fn();
    const closed = vi.fn();
    bot.on("expired", expired);
    bot.on("closed", closed);
    bot.start();
    await new Promise((r) => setTimeout(r, 40));
    expect(expired).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(bot.isRunning()).toBe(false);
  });

  it("emits 'error' on transient failures and backs off without crashing", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      if (calls <= 2) return new Response("oops", { status: 502 });
      return parkUntilAbort(init?.signal);
    });
    const bot = new WeChatIlinkBot(CREDS, { fetchImpl, minRetryMs: 5, maxRetryMs: 20 });
    const errors: Error[] = [];
    bot.on("error", (e) => errors.push(e));
    bot.start();
    await new Promise((r) => setTimeout(r, 80));
    const closed = new Promise<void>((r) => bot.once("closed", () => r()));
    bot.stop();
    await closed;
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(bot.isRunning()).toBe(false);
  });
});

describe("sendText", () => {
  it("posts to /sendmessage with the right shape", async () => {
    let seenUrl = "";
    let seenBody: any = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = input.toString();
      seenBody = JSON.parse((init?.body as string) ?? "{}");
      return rawResponse({ ret: 0, message_id: 99 });
    });
    const bot = new WeChatIlinkBot(CREDS, { fetchImpl });
    const out = await bot.sendText("peer-1", "hello", "ctx-9");
    expect(seenUrl).toContain(Endpoint.SEND_MESSAGE);
    expect(seenBody.msg.to_user_id).toBe("peer-1");
    expect(seenBody.msg.context_token).toBe("ctx-9");
    expect(seenBody.msg.from_user_id).toBe("");
    expect(seenBody.msg.message_type).toBe(2);
    expect(seenBody.msg.message_state).toBe(2);
    expect(typeof seenBody.msg.client_id).toBe("string");
    expect(seenBody.msg.item_list[0]).toEqual({ type: 1, text_item: { text: "hello" } });
    expect(out.message_id).toBe(99);
  });
});
