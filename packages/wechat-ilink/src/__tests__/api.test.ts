import { describe, it, expect, vi } from "vitest";

import {
  Endpoint,
  buildTextItem,
  getConfig,
  getUpdates,
  ilinkPost,
  sendMessage,
} from "../api";
import { IlinkProtocolError, IlinkSessionExpiredError, type Credentials } from "../types";

const CREDS: Credentials = { token: "tok-abc", uin: "AAECAw==", userId: "u1" };

function mockFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    responder(input.toString(), init ?? {}),
  );
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("ilinkPost envelope", () => {
  it("sends required auth headers", async () => {
    const f = mockFetch((_url, init) => {
      const headers = new Headers(init.headers as HeadersInit);
      expect(headers.get("authorizationtype")).toBe("ilink_bot_token");
      expect(headers.get("authorization")).toBe("Bearer tok-abc");
      expect(headers.get("x-wechat-uin")).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(headers.get("content-type")).toBe("application/json");
      return jsonResponse({ ret: 0 });
    });
    await ilinkPost("/x", { hi: 1 }, CREDS, { fetchImpl: f });
    expect(f).toHaveBeenCalledOnce();
  });

  it("maps errcode -14 to IlinkSessionExpiredError", async () => {
    const f = mockFetch(() => jsonResponse({ ret: 0, errcode: -14, errmsg: "session" }));
    await expect(
      ilinkPost("/x", {}, CREDS, { fetchImpl: f }),
    ).rejects.toBeInstanceOf(IlinkSessionExpiredError);
  });

  it("maps other negative ret/errcode to IlinkProtocolError", async () => {
    const f1 = mockFetch(() => jsonResponse({ ret: -3 }));
    await expect(ilinkPost("/x", {}, CREDS, { fetchImpl: f1 })).rejects.toBeInstanceOf(
      IlinkProtocolError,
    );
    const f2 = mockFetch(() => jsonResponse({ ret: 0, errcode: -5, errmsg: "boom" }));
    await expect(ilinkPost("/x", {}, CREDS, { fetchImpl: f2 })).rejects.toBeInstanceOf(
      IlinkProtocolError,
    );
  });

  it("treats HTTP non-2xx as protocol error", async () => {
    const f = mockFetch(() => new Response("nope", { status: 500 }));
    await expect(ilinkPost("/x", {}, CREDS, { fetchImpl: f })).rejects.toThrow(/HTTP 500/);
  });

  it("accepts responses with no ret field (e.g. getuploadurl)", async () => {
    const f = mockFetch(() => jsonResponse({ upload_param: "https://cdn/x" }));
    const out = await ilinkPost<{ upload_param: string }>("/x", {}, CREDS, { fetchImpl: f });
    expect(out.upload_param).toBe("https://cdn/x");
  });
});

describe("typed wrappers", () => {
  it("getUpdates passes the cursor through", async () => {
    let seenBody: unknown;
    const f = mockFetch(async (url, init) => {
      expect(url).toContain(Endpoint.GET_UPDATES);
      seenBody = JSON.parse(init.body as string);
      return jsonResponse({ ret: 0, msgs: [], get_updates_buf: "next-cursor" });
    });
    const res = await getUpdates(CREDS, "prev-cursor", { fetchImpl: f });
    expect(seenBody).toEqual({ get_updates_buf: "prev-cursor" });
    expect(res.get_updates_buf).toBe("next-cursor");
  });

  it("sendMessage forwards the full envelope", async () => {
    let seen: any;
    const f = mockFetch(async (_u, init) => {
      seen = JSON.parse(init.body as string);
      return jsonResponse({ ret: 0, message_id: 42 });
    });
    const res = await sendMessage(
      CREDS,
      { msg: { to_user_id: "peer-1", item_list: [buildTextItem("hi")] } },
      { fetchImpl: f },
    );
    expect(seen.msg.to_user_id).toBe("peer-1");
    expect(seen.msg.item_list[0]).toEqual({ type: 1, text_item: { text: "hi" } });
    expect(res.message_id).toBe(42);
  });

  it("getConfig includes context_token only when provided", async () => {
    let body1: any;
    let body2: any;
    const f = mockFetch(async (_u, init) => {
      const parsed = JSON.parse(init.body as string);
      if (!body1) body1 = parsed;
      else body2 = parsed;
      return jsonResponse({ ret: 0 });
    });
    await getConfig(CREDS, undefined, { fetchImpl: f });
    await getConfig(CREDS, "ctx-1", { fetchImpl: f });
    expect("context_token" in body1).toBe(false);
    expect(body2.context_token).toBe("ctx-1");
    expect(body1.ilink_user_id).toBe("u1");
  });
});
