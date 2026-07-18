/**
 * HTTP client for the Tencent OpenClaw iLink personal-WeChat API.
 *
 * All endpoints accept `POST` with a JSON body. Auth headers are mandatory
 * on every call except the QR-login bootstrap (which has its own dedicated
 * paths inside `auth.ts`).
 */

import { randomBytes } from "node:crypto";

import {
  Credentials,
  GetConfigResponse,
  GetUpdatesResponse,
  GetUploadUrlRequest,
  GetUploadUrlResponse,
  IlinkProtocolError,
  IlinkSessionExpiredError,
  MessageItem,
  SendMessageRequest,
  SendMessageResponse,
  ErrCode,
} from "./types";

/**
 * Base URL for the iLink gateway. Overridable via env (and via test seam in
 * the Bot's constructor) so we can point at a staging deployment if Tencent
 * ever publishes one.
 */
export const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";

/** Per-endpoint sub-path. The docs spec just the leaf name, no /api prefix. */
export const Endpoint = {
  GET_UPDATES: "/ilink/bot/getupdates",
  SEND_MESSAGE: "/ilink/bot/sendmessage",
  GET_UPLOAD_URL: "/ilink/bot/getuploadurl",
  GET_CONFIG: "/ilink/bot/getconfig",
  SEND_TYPING: "/ilink/bot/sendtyping",
} as const;

export interface ApiOptions {
  baseUrl?: string;
  /** Test/DI seam — defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** AbortSignal forwarded to fetch (used for long-poll cancellation). */
  signal?: AbortSignal;
  /** Per-request override; otherwise no timeout (long-poll uses signal). */
  timeoutMs?: number;
}

/** iLink requires a fresh base64-encoded random uint32 on every request. */
function createRequestUin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf-8").toString("base64");
}

function authHeaders(creds: Credentials): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${creds.token}`,
    "X-WECHAT-UIN": createRequestUin(),
  };
}

/**
 * Low-level POST. Throws IlinkSessionExpiredError when the server reports
 * errcode -14 so the bot loop can react centrally. Other negative `ret`
 * values become IlinkProtocolError so the caller chooses what to do.
 */
export async function ilinkPost<TRes>(
  endpoint: string,
  body: unknown,
  creds: Credentials,
  opts: ApiOptions = {},
): Promise<TRes> {
  const base = opts.baseUrl ?? ILINK_BASE_URL;
  const f = opts.fetchImpl ?? fetch;

  // If both an external signal and a timeoutMs are provided, chain them.
  let signal = opts.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    const ctl = new AbortController();
    timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
    if (signal) {
      signal.addEventListener("abort", () => ctl.abort(), { once: true });
    }
    signal = ctl.signal;
  }

  let res: Response;
  try {
    res = await f(base + endpoint, {
      method: "POST",
      headers: authHeaders(creds),
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await safeText(res);
    throw new IlinkProtocolError(
      `iLink HTTP ${res.status} on ${endpoint}: ${text.slice(0, 200)}`,
      0,
    );
  }

  const json = (await res.json()) as TRes & { ret?: number; errcode?: number; errmsg?: string };
  // Some endpoints (getuploadurl) omit `ret` on success; only treat as failure
  // when present and non-zero, OR when an explicit errcode is set.
  const ret = (json as any).ret;
  const errcode = (json as any).errcode;
  if (typeof errcode === "number" && errcode !== 0) {
    if (errcode === ErrCode.SESSION_TIMEOUT) {
      throw new IlinkSessionExpiredError((json as any).errmsg);
    }
    throw new IlinkProtocolError(
      `iLink ${endpoint} errcode=${errcode}: ${(json as any).errmsg ?? "unknown error"}`,
      errcode,
    );
  }
  if (typeof ret === "number" && ret !== 0 && !(typeof errcode === "number")) {
    throw new IlinkProtocolError(`iLink ${endpoint} ret=${ret}`, ret);
  }
  return json;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// ── Typed wrappers ──────────────────────────────────────────────────────────

export function getUpdates(
  creds: Credentials,
  getUpdatesBuf: string,
  opts: ApiOptions = {},
): Promise<GetUpdatesResponse> {
  return ilinkPost<GetUpdatesResponse>(
    Endpoint.GET_UPDATES,
    { get_updates_buf: getUpdatesBuf ?? "" },
    creds,
    opts,
  );
}

export function sendMessage(
  creds: Credentials,
  body: SendMessageRequest,
  opts: ApiOptions = {},
): Promise<SendMessageResponse> {
  return ilinkPost<SendMessageResponse>(Endpoint.SEND_MESSAGE, body, creds, opts);
}

export function getUploadUrl(
  creds: Credentials,
  body: GetUploadUrlRequest,
  opts: ApiOptions = {},
): Promise<GetUploadUrlResponse> {
  return ilinkPost<GetUploadUrlResponse>(Endpoint.GET_UPLOAD_URL, body, creds, opts);
}

export function getConfig(
  creds: Credentials,
  contextToken: string | undefined,
  opts: ApiOptions = {},
): Promise<GetConfigResponse> {
  return ilinkPost<GetConfigResponse>(
    Endpoint.GET_CONFIG,
    { ilink_user_id: creds.userId, ...(contextToken ? { context_token: contextToken } : {}) },
    creds,
    opts,
  );
}

export function sendTyping(
  creds: Credentials,
  toUserId: string,
  typingTicket: string,
  status: 1 | 2,
  opts: ApiOptions = {},
): Promise<{ ret: number }> {
  return ilinkPost<{ ret: number }>(
    Endpoint.SEND_TYPING,
    { ilink_user_id: toUserId, typing_ticket: typingTicket, status },
    creds,
    opts,
  );
}

// ── Convenience builders ────────────────────────────────────────────────────

export function buildTextItem(text: string): MessageItem {
  return { type: 1, text_item: { text } };
}

export function buildImageItem(image: NonNullable<MessageItem["image_item"]>): MessageItem {
  return { type: 2, image_item: image };
}
