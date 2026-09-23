/** Image upload for Tencent's iLink CDN protocol. */

import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { ApiOptions, buildImageItem, getUploadUrl } from "./api";
import { Credentials, GetUploadUrlResponse, MediaType, MessageItem } from "./types";

const DEFAULT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const CDN_UPLOAD_ATTEMPTS = 3;
const CDN_UPLOAD_TIMEOUT_MS = 20_000;

export type UploadTargetShape = "full_url" | "absolute_param" | "json_param" | "opaque_param" | "missing" | "invalid";
export type ImageUploadErrorCode =
  | "INVALID_IMAGE"
  | "UPLOAD_URL_ERROR"
  | "MISSING_UPLOAD_TARGET"
  | "CDN_CLIENT_ERROR"
  | "CDN_SERVER_ERROR"
  | "CDN_NETWORK_ERROR"
  | "CDN_MISSING_DOWNLOAD_PARAM";

export class WeChatImageUploadError extends Error {
  readonly stage = "image_upload";

  constructor(
    readonly code: ImageUploadErrorCode,
    readonly targetShape: UploadTargetShape,
    message: string,
    readonly status?: number,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = "WeChatImageUploadError";
  }
}

export interface EncryptedBlob {
  cipher: Buffer;
  rawMd5: string;
  rawSize: number;
  cipherSize: number;
  /** Fresh per-upload AES-128 key, passed to getuploadurl as hex. */
  aesKeyHex: string;
}

/** Tencent's sender uses a random AES key, not the plaintext MD5 as the key. */
export function encryptForUpload(plain: Buffer, aesKey: Buffer = randomBytes(16)): EncryptedBlob {
  if (aesKey.length !== 16) throw new Error("Image AES key must be 16 bytes");
  const plainView = new Uint8Array(plain.buffer, plain.byteOffset, plain.byteLength);
  const md5 = createHash("md5").update(plainView).digest("hex");
  const keyView = new Uint8Array(aesKey.buffer, aesKey.byteOffset, aesKey.byteLength);
  const cipher = createCipheriv("aes-128-ecb", keyView, null);
  cipher.setAutoPadding(true);
  const updated = cipher.update(plainView);
  const final = cipher.final();
  const out = Buffer.from(new Uint8Array([...updated, ...final]));
  return {
    cipher: out,
    rawMd5: md5,
    rawSize: plain.length,
    cipherSize: out.length,
    aesKeyHex: aesKey.toString("hex"),
  };
}

export interface UploadTarget {
  url: string;
  shape: UploadTargetShape;
}

function absoluteHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Resolve the documented full URL, or build a CDN URL from an opaque upload_param. */
export function resolveUploadTarget(
  uploadInfo: GetUploadUrlResponse,
  filekey: string,
  cdnBaseUrl = DEFAULT_CDN_BASE_URL,
): UploadTarget {
  const full = uploadInfo?.upload_full_url;
  if (typeof full === "string" && full.trim()) {
    const url = absoluteHttpUrl(full.trim());
    if (url) return { url, shape: "full_url" };
  }

  const raw = uploadInfo?.upload_param;
  if (typeof raw !== "string" || !raw.trim()) {
    const shape: UploadTargetShape = full || raw ? "invalid" : "missing";
    throw new WeChatImageUploadError(
      "MISSING_UPLOAD_TARGET",
      shape,
      `getuploadurl returned no usable upload target (shape=${shape}; expected upload_full_url or upload_param)`,
    );
  }
  const param = raw.trim();
  const absolute = absoluteHttpUrl(param);
  if (absolute) return { url: absolute, shape: "absolute_param" };

  // Older gateways returned a JSON envelope. Keep it compatible, but do not
  // assume an opaque encrypted token is JSON or expose that token in errors.
  for (const candidate of [param, Buffer.from(param, "base64").toString("utf8")]) {
    try {
      const value = JSON.parse(candidate) as { url?: unknown; upload_full_url?: unknown };
      const nested = value.upload_full_url ?? value.url;
      if (typeof nested === "string") {
        const url = absoluteHttpUrl(nested);
        if (url) return { url, shape: "json_param" };
      }
    } catch {
      // Opaque encrypted parameters are the normal modern response shape.
    }
  }

  const base = absoluteHttpUrl(cdnBaseUrl);
  if (!base) {
    throw new WeChatImageUploadError("MISSING_UPLOAD_TARGET", "invalid", "CDN base URL is invalid");
  }
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/upload`;
  url.searchParams.set("encrypted_query_param", param);
  url.searchParams.set("filekey", filekey);
  return { url: url.toString(), shape: "opaque_param" };
}

function safeResponseBody(body: string): string {
  return body.slice(0, 512).replace(/https?:\/\/\S+/gi, "[redacted URL]");
}

/** POST encrypted bytes; the response header is the download reference. */
async function uploadToCdn(
  target: UploadTarget,
  blob: Buffer,
  fetchImpl: typeof fetch,
  externalSignal?: AbortSignal,
  timeoutMs = CDN_UPLOAD_TIMEOUT_MS,
): Promise<string> {
  const body = new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  let lastError: WeChatImageUploadError | undefined;
  for (let attempt = 1; attempt <= CDN_UPLOAD_ATTEMPTS; attempt++) {
    if (externalSignal?.aborted) throw externalSignal.reason;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
      const res = await fetchImpl(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: body as BodyInit,
        signal,
      });
      if (res.status !== 200) {
        const responseBody = safeResponseBody(await res.text().catch(() => ""));
        const code = res.status >= 400 && res.status < 500 ? "CDN_CLIENT_ERROR" : "CDN_SERVER_ERROR";
        throw new WeChatImageUploadError(
          code,
          target.shape,
          `CDN image upload failed (shape=${target.shape}, HTTP ${res.status})${responseBody ? `: ${responseBody}` : ""}`,
          res.status,
          responseBody,
        );
      }
      const downloadParam = res.headers.get("x-encrypted-param")?.trim();
      if (!downloadParam) {
        throw new WeChatImageUploadError(
          "CDN_MISSING_DOWNLOAD_PARAM",
          target.shape,
          `CDN image upload returned HTTP 200 without x-encrypted-param (shape=${target.shape})`,
          res.status,
          safeResponseBody(await res.text().catch(() => "")),
        );
      }
      return downloadParam;
    } catch (err) {
      if (externalSignal?.aborted) throw err;
      lastError = err instanceof WeChatImageUploadError
        ? err
        : new WeChatImageUploadError(
          "CDN_NETWORK_ERROR",
          target.shape,
          `CDN image upload network/timeout failure (shape=${target.shape}, attempt=${attempt})`,
        );
      if (lastError.code === "CDN_CLIENT_ERROR" || attempt === CDN_UPLOAD_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

/** Encrypt, upload, and return the real iLink image-item media reference. */
export async function uploadImage(
  creds: Credentials,
  toUserId: string,
  png: Buffer,
  apiOpts: ApiOptions = {},
): Promise<MessageItem> {
  if (!png.length) {
    throw new WeChatImageUploadError("INVALID_IMAGE", "missing", "Cannot upload an empty image");
  }
  const main = encryptForUpload(png);
  const filekey = randomBytes(16).toString("hex");

  // No separate thumbnail is generated. Tell the gateway explicitly rather
  // than uploading the same full-size PNG twice as a fake thumbnail.
  let uploadInfo: GetUploadUrlResponse;
  try {
    uploadInfo = await getUploadUrl(
      creds,
      {
        filekey,
        media_type: MediaType.IMAGE,
        to_user_id: toUserId,
        rawsize: main.rawSize,
        rawfilemd5: main.rawMd5,
        filesize: main.cipherSize,
        no_need_thumb: true,
        aeskey: main.aesKeyHex,
      },
      { ...apiOpts, timeoutMs: apiOpts.timeoutMs ?? CDN_UPLOAD_TIMEOUT_MS },
    );
  } catch (err) {
    throw new WeChatImageUploadError(
      "UPLOAD_URL_ERROR",
      "missing",
      `getuploadurl failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const target = resolveUploadTarget(uploadInfo, filekey, apiOpts.cdnBaseUrl);
  const downloadParam = await uploadToCdn(
    target,
    main.cipher,
    apiOpts.fetchImpl ?? fetch,
    apiOpts.signal,
    apiOpts.cdnUploadTimeoutMs ?? CDN_UPLOAD_TIMEOUT_MS,
  );
  return buildImageItem({
    media: {
      encrypt_query_param: downloadParam,
      aes_key: Buffer.from(main.aesKeyHex).toString("base64"),
      encrypt_type: 1,
    },
    mid_size: main.cipherSize,
  });
}
