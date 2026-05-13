/**
 * Bot lifecycle for an authenticated iLink session: long-poll loop +
 * outbound sends. Designed for a single account; consumers spin up one
 * instance per logged-in WeChat account.
 *
 * Emitted events:
 *  - `message`    (msg: WeixinMessage)  — a fresh inbound from a peer
 *  - `error`      (err: Error)          — transient HTTP/protocol error
 *  - `expired`                           — session-expired signal from server (-14)
 *  - `closed`                            — loop has terminated
 */

import { EventEmitter } from "node:events";

import {
  ApiOptions,
  buildTextItem,
  getUpdates,
  ILINK_BASE_URL,
  sendMessage as ilinkSendMessage,
  sendTyping as ilinkSendTyping,
} from "./api";
import { uploadImage } from "./media";
import {
  Credentials,
  IlinkSessionExpiredError,
  MessageItem,
  SendMessageResponse,
  WeixinMessage,
} from "./types";

export interface BotOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Minimum delay between retries after a transient error (ms). */
  minRetryMs?: number;
  /** Maximum backoff delay (ms). */
  maxRetryMs?: number;
}

export class WeChatIlinkBot extends EventEmitter {
  private creds: Credentials;
  private opts: Required<BotOptions>;
  private running = false;
  private loopAbort: AbortController | null = null;
  private cursor = "";

  constructor(creds: Credentials, opts: BotOptions = {}) {
    super();
    this.creds = creds;
    this.opts = {
      baseUrl: opts.baseUrl ?? ILINK_BASE_URL,
      fetchImpl: opts.fetchImpl ?? fetch,
      minRetryMs: opts.minRetryMs ?? 1_000,
      maxRetryMs: opts.maxRetryMs ?? 30_000,
    };
  }

  /** Update credentials in place (e.g. after a re-pair). Bot must be stopped. */
  setCredentials(creds: Credentials): void {
    if (this.running) throw new Error("Cannot update credentials while bot is running");
    this.creds = creds;
    this.cursor = "";
  }

  getCredentials(): Credentials {
    return this.creds;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopAbort = new AbortController();
    void this.loop().finally(() => {
      this.running = false;
      this.emit("closed");
    });
  }

  stop(): void {
    if (!this.running) return;
    this.loopAbort?.abort();
  }

  isRunning(): boolean {
    return this.running;
  }

  private apiOpts(extra?: ApiOptions): ApiOptions {
    return {
      baseUrl: this.opts.baseUrl,
      fetchImpl: this.opts.fetchImpl,
      signal: this.loopAbort?.signal,
      ...(extra ?? {}),
    };
  }

  private async loop(): Promise<void> {
    let backoff = this.opts.minRetryMs;
    while (this.running && !this.loopAbort?.signal.aborted) {
      try {
        const res = await getUpdates(this.creds, this.cursor, this.apiOpts());
        this.cursor = res.get_updates_buf ?? this.cursor;
        const msgs = res.msgs ?? [];
        for (const msg of msgs) {
          // Ignore our own outgoing messages echoed back (message_type 2 = BOT).
          if (msg.message_type === 2) continue;
          this.emit("message", msg);
        }
        backoff = this.opts.minRetryMs;
      } catch (err) {
        if (this.loopAbort?.signal.aborted) break;
        if (err instanceof IlinkSessionExpiredError) {
          this.emit("expired");
          break;
        }
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
        await sleep(backoff, this.loopAbort?.signal);
        backoff = Math.min(this.opts.maxRetryMs, Math.floor(backoff * 1.7));
      }
    }
  }

  // ── Outbound ──────────────────────────────────────────────────────────────

  async sendText(toUserId: string, text: string, contextToken?: string): Promise<SendMessageResponse> {
    return ilinkSendMessage(
      this.creds,
      {
        msg: {
          to_user_id: toUserId,
          context_token: contextToken,
          item_list: [buildTextItem(text)],
        },
      },
      this.apiOpts(),
    );
  }

  async sendImage(toUserId: string, png: Buffer, contextToken?: string): Promise<SendMessageResponse> {
    const item = await uploadImage(this.creds, toUserId, png, this.apiOpts());
    return ilinkSendMessage(
      this.creds,
      {
        msg: {
          to_user_id: toUserId,
          context_token: contextToken,
          item_list: [item],
        },
      },
      this.apiOpts(),
    );
  }

  async sendItems(toUserId: string, items: MessageItem[], contextToken?: string): Promise<SendMessageResponse> {
    return ilinkSendMessage(
      this.creds,
      {
        msg: { to_user_id: toUserId, context_token: contextToken, item_list: items },
      },
      this.apiOpts(),
    );
  }

  async sendTyping(toUserId: string, typingTicket: string, status: 1 | 2): Promise<void> {
    await ilinkSendTyping(this.creds, toUserId, typingTicket, status, this.apiOpts());
  }
}

/** Extract the plain-text body from an inbound message's item_list. */
export function getMessageText(msg: WeixinMessage): string {
  if (!Array.isArray(msg.item_list)) return "";
  return msg.item_list
    .map((it) => (it.type === 1 && it.text_item?.text ? it.text_item.text : ""))
    .filter((s) => s.length > 0)
    .join("\n");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
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
