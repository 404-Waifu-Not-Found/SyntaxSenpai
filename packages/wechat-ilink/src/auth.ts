/**
 * QR-code login flow for the iLink personal-WeChat protocol.
 *
 * The official Tencent CLI prints a QR to the terminal; we need the raw
 * payload as a string so we can render it inside our own Settings UI.
 *
 * Flow (mirrors `co-pine/wx-robot-ilink` and the protocol description):
 *  1. `POST /ilink/bot/login/createqrcode` → returns `{ qr_payload, login_token }`.
 *  2. UI renders the QR; user scans in WeChat.
 *  3. We poll `POST /ilink/bot/login/checkqrstatus { login_token }` every
 *     ~2 s until it returns `{ scanned: true, confirmed: true, bearer,
 *     uin, user_id, display_name }`.
 *  4. Those fields become a `Credentials` record that the caller persists.
 *
 * The endpoint names and response shapes are best-effort from the public
 * docs — the auth surface is the only part of the protocol that is
 * sparsely documented compared to the bot endpoints, so we keep the
 * decoder permissive (any of a few field-name variants is accepted).
 */

import { Credentials } from "./types";

const LOGIN_BASE_URL = "https://ilinkai.weixin.qq.com";

export const LoginEndpoint = {
  CREATE_QR: "/ilink/bot/login/createqrcode",
  CHECK_QR: "/ilink/bot/login/checkqrstatus",
} as const;

export interface StartQrLoginOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Polling cadence (ms). Default 2000. */
  pollIntervalMs?: number;
  /** Total timeout for the user to scan + confirm (ms). Default 5 min. */
  timeoutMs?: number;
}

export interface QrLoginHandle {
  /** Raw QR payload string — feed to a QR-code renderer (e.g. `qrcode`). */
  qrPayload: string;
  /** Abort the login attempt. Resolves the `done` promise with a rejection. */
  cancel(): void;
  /** Resolves once the user has scanned + confirmed in WeChat. */
  done: Promise<Credentials>;
}

/** Random base64-encoded uint32 for the X-WECHAT-UIN header. */
export function generateUin(): string {
  const buf = new Uint8Array(4);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 4; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  // Node + browser both support btoa via globalThis; fall back to Buffer.
  const bin = String.fromCharCode(...buf);
  if (typeof btoa === "function") return btoa(bin);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return Buffer.from(buf).toString("base64");
}

/**
 * Start a QR-login. Returns immediately with the QR payload so the UI can
 * render it; `done` resolves when the user finishes scanning.
 */
export async function startQrLogin(opts: StartQrLoginOptions = {}): Promise<QrLoginHandle> {
  const base = opts.baseUrl ?? LOGIN_BASE_URL;
  const f = opts.fetchImpl ?? fetch;
  const pollMs = opts.pollIntervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  const uin = generateUin();
  const ctl = new AbortController();

  const createRes = await f(base + LoginEndpoint.CREATE_QR, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": uin,
    },
    body: JSON.stringify({}),
    signal: ctl.signal,
  });
  if (!createRes.ok) {
    throw new Error(`createqrcode failed: HTTP ${createRes.status}`);
  }
  const create = (await createRes.json()) as Record<string, unknown>;
  const qrPayload = String(create.qr_payload ?? create.qr_url ?? create.qrcode ?? "");
  const loginToken = String(create.login_token ?? create.token ?? "");
  if (!qrPayload || !loginToken) {
    throw new Error("createqrcode response missing qr_payload/login_token");
  }

  const done: Promise<Credentials> = (async () => {
    const startedAt = Date.now();
    while (true) {
      if (ctl.signal.aborted) throw new Error("QR login cancelled");
      if (Date.now() - startedAt > timeoutMs) throw new Error("QR login timed out");

      const checkRes = await f(base + LoginEndpoint.CHECK_QR, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          AuthorizationType: "ilink_bot_token",
          "X-WECHAT-UIN": uin,
        },
        body: JSON.stringify({ login_token: loginToken }),
        signal: ctl.signal,
      });
      if (!checkRes.ok) {
        await sleep(pollMs, ctl.signal);
        continue;
      }
      const check = (await checkRes.json()) as Record<string, unknown>;
      const confirmed = Boolean(
        check.confirmed === true ||
          check.status === "confirmed" ||
          check.state === 2,
      );
      const bearer = String(check.bearer ?? check.token ?? check.access_token ?? "");
      const userId = String(check.user_id ?? check.userId ?? check.ilink_user_id ?? "");
      if (confirmed && bearer && userId) {
        return {
          token: bearer,
          uin,
          userId,
          displayName: typeof check.display_name === "string" ? check.display_name : undefined,
        };
      }
      // 'expired'/'cancelled' from server side
      if (check.status === "expired" || check.state === -1) {
        throw new Error("QR login expired before scan");
      }
      await sleep(pollMs, ctl.signal);
    }
  })();

  return {
    qrPayload,
    cancel: () => ctl.abort(),
    done,
  };
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
