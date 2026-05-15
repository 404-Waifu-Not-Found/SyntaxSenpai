/**
 * QR-code login flow for the official Tencent OpenClaw iLink personal-WeChat
 * protocol (https://github.com/Tencent/openclaw-weixin).
 *
 * Flow:
 *  1. `GET /ilink/bot/get_bot_qrcode?bot_type=3` → `{ qrcode, qrcode_img_content }`.
 *     `qrcode` is the opaque id used for polling; `qrcode_img_content` is the
 *     URL string the caller encodes into a QR image. Scanning that QR with the
 *     real WeChat app drives the official pairing handshake.
 *  2. Long-poll `GET /ilink/bot/get_qrcode_status?qrcode=<qrcode>` until the
 *     status reaches `confirmed` (or `expired`). The endpoint is a server-side
 *     long-poll and returns `wait` on each client-side timeout.
 *  3. On `confirmed` the server returns `{ bot_token, ilink_user_id, baseurl }`,
 *     which become the persisted `Credentials`.
 */

import { Credentials } from "./types";

/** Official iLink gateway. Overridable for staging deployments / tests. */
const LOGIN_BASE_URL = "https://ilinkai.weixin.qq.com";

export const LoginEndpoint = {
  GET_QRCODE: "ilink/bot/get_bot_qrcode",
  QRCODE_STATUS: "ilink/bot/get_qrcode_status",
} as const;

/** `bot_type` query value for the iLink QR-login endpoint (personal bot). */
export const DEFAULT_BOT_TYPE = "3";

/** Client-side cap for a single `get_qrcode_status` long-poll request (ms). */
const QR_STATUS_LONG_POLL_MS = 35_000;

export interface StartQrLoginOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** `bot_type` query parameter. Default "3". */
  botType?: string;
  /** Total timeout for the user to scan + confirm (ms). Default 5 min. */
  timeoutMs?: number;
}

export interface QrLoginHandle {
  /**
   * QR payload string from the official iLink endpoint
   * (`qrcode_img_content`). Encode it into a QR image (e.g. with `qrcode`);
   * scanning it with the WeChat app drives the real pairing handshake.
   */
  qrPayload: string;
  /** Abort the login attempt. Rejects the `done` promise. */
  cancel(): void;
  /** Resolves once the user has scanned + confirmed in WeChat. */
  done: Promise<Credentials>;
}

interface QrCodeResponse {
  qrcode?: string;
  qrcode_img_content?: string;
}

interface QrCodeStatusResponse {
  status?: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  display_name?: string;
}

/** `X-WECHAT-UIN` header value: random uint32 → decimal string → base64. */
export function generateUin(): string {
  const buf = new Uint8Array(4);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 4; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  const uint32 = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  const decimal = String(uint32);
  if (typeof btoa === "function") return btoa(decimal);
  return Buffer.from(decimal, "utf-8").toString("base64");
}

/**
 * Start a QR-login against the official Tencent iLink endpoint. Returns
 * immediately with the QR payload so the UI can render it; `done` resolves
 * when the user finishes scanning + confirming in the WeChat app.
 */
export async function startQrLogin(opts: StartQrLoginOptions = {}): Promise<QrLoginHandle> {
  const base = ensureTrailingSlash(opts.baseUrl ?? LOGIN_BASE_URL);
  const f = opts.fetchImpl ?? fetch;
  const botType = opts.botType ?? DEFAULT_BOT_TYPE;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  const uin = generateUin();
  const ctl = new AbortController();

  // Step 1 — fetch a QR code from the official iLink endpoint.
  const qrUrl = new URL(LoginEndpoint.GET_QRCODE, base);
  qrUrl.searchParams.set("bot_type", botType);
  const createRes = await f(qrUrl.toString(), { method: "GET", signal: ctl.signal });
  if (!createRes.ok) {
    throw new Error(`get_bot_qrcode failed: HTTP ${createRes.status}`);
  }
  const create = (await createRes.json()) as QrCodeResponse;
  const qrId = String(create.qrcode ?? "");
  const qrPayload = String(create.qrcode_img_content ?? "");
  if (!qrId || !qrPayload) {
    throw new Error("get_bot_qrcode response missing qrcode/qrcode_img_content");
  }

  // Step 2 — long-poll the scan status until confirmed / expired / timeout.
  const done: Promise<Credentials> = (async () => {
    const startedAt = Date.now();
    while (true) {
      if (ctl.signal.aborted) throw new Error("QR login cancelled");
      if (Date.now() - startedAt > timeoutMs) throw new Error("QR login timed out");

      const statusUrl = new URL(LoginEndpoint.QRCODE_STATUS, base);
      statusUrl.searchParams.set("qrcode", qrId);

      // `get_qrcode_status` is a server long-poll; cap each request
      // client-side and treat a client timeout as a normal "wait" tick.
      const reqCtl = new AbortController();
      const onOuterAbort = () => reqCtl.abort();
      ctl.signal.addEventListener("abort", onOuterAbort, { once: true });
      const timer = setTimeout(() => reqCtl.abort(), QR_STATUS_LONG_POLL_MS);

      let status: QrCodeStatusResponse;
      try {
        const res = await f(statusUrl.toString(), {
          method: "GET",
          headers: { "iLink-App-ClientVersion": "1" },
          signal: reqCtl.signal,
        });
        if (!res.ok) {
          throw new Error(`get_qrcode_status failed: HTTP ${res.status}`);
        }
        status = (await res.json()) as QrCodeStatusResponse;
      } catch (err) {
        if (ctl.signal.aborted) throw new Error("QR login cancelled");
        // Client-side long-poll timeout or transient error — poll again.
        status = { status: "wait" };
        void err;
      } finally {
        clearTimeout(timer);
        ctl.signal.removeEventListener("abort", onOuterAbort);
      }

      switch (status.status) {
        case "confirmed": {
          const token = String(status.bot_token ?? "");
          const userId = String(status.ilink_user_id ?? "");
          if (!token || !userId) {
            throw new Error(
              "get_qrcode_status confirmed but missing bot_token/ilink_user_id",
            );
          }
          return {
            token,
            uin,
            userId,
            displayName:
              typeof status.display_name === "string" ? status.display_name : undefined,
            baseUrl:
              typeof status.baseurl === "string" && status.baseurl
                ? status.baseurl
                : undefined,
          };
        }
        case "expired":
          throw new Error("QR code expired before scan — restart pairing");
        case "scaned":
        case "wait":
        default:
          await sleep(1000, ctl.signal);
      }
    }
  })();

  return {
    qrPayload,
    cancel: () => ctl.abort(),
    done,
  };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
