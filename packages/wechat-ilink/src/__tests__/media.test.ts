import { createDecipheriv, createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";

import { encryptForUpload, resolveUploadTarget, uploadImage, WeChatImageUploadError } from "../media";
import type { Credentials } from "../types";

const CREDS: Credentials = { token: "test-token", uin: "test", userId: "me" };
const PNG = Buffer.from("\x89PNG\r\n\x1a\nmock-png-data", "binary");

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("encryptForUpload", () => {
  it("encrypts with a fresh 16-byte key and preserves the plaintext MD5", () => {
    const key = Buffer.alloc(16, 0x42);
    const plain = Buffer.from("hello-wechat-ilink-image-payload");
    const out = encryptForUpload(plain, key);
    expect(out.aesKeyHex).toBe(key.toString("hex"));
    expect(out.rawMd5).toBe(createHash("md5").update(plain).digest("hex"));
    expect(out.rawSize).toBe(plain.length);

    const dec = createDecipheriv("aes-128-ecb", new Uint8Array(key), null);
    expect(Buffer.concat([dec.update(out.cipher), dec.final()])).toEqual(plain);
  });

  it("uses PKCS#7 padding and rejects a malformed AES key", () => {
    for (const len of [0, 1, 15, 16, 17, 31, 32]) {
      const out = encryptForUpload(Buffer.alloc(len, 0xaa));
      expect(out.cipherSize).toBe(Math.floor(len / 16) * 16 + 16);
    }
    expect(() => encryptForUpload(PNG, Buffer.alloc(8))).toThrow("16 bytes");
  });
});

describe("resolveUploadTarget", () => {
  it("prefers upload_full_url over an opaque upload_param", () => {
    const target = resolveUploadTarget(
      { upload_full_url: "https://cdn.example/upload?signature=abc", upload_param: "opaque" },
      "file-key",
    );
    expect(target).toEqual({ url: "https://cdn.example/upload?signature=abc", shape: "full_url" });
  });

  it("supports absolute URLs and legacy base64 JSON envelopes", () => {
    expect(resolveUploadTarget({ upload_param: "https://cdn.example/upload" }, "f").shape).toBe("absolute_param");
    const legacy = Buffer.from(JSON.stringify({ url: "https://cdn.example/legacy" })).toString("base64");
    expect(resolveUploadTarget({ upload_param: legacy }, "f")).toEqual({
      url: "https://cdn.example/legacy", shape: "json_param",
    });
  });

  it("builds the documented CDN URL for opaque encrypted parameters", () => {
    const target = resolveUploadTarget({ upload_param: "opaque+/= token" }, "file/key", "https://cdn.example/c2c");
    expect(target.shape).toBe("opaque_param");
    const url = new URL(target.url);
    expect(url.pathname).toBe("/c2c/upload");
    expect(url.searchParams.get("encrypted_query_param")).toBe("opaque+/= token");
    expect(url.searchParams.get("filekey")).toBe("file/key");
  });

  it("names an absent or invalid response shape without leaking parameter data", () => {
    expect(() => resolveUploadTarget({}, "f")).toThrowError(WeChatImageUploadError);
    try {
      resolveUploadTarget({ upload_param: 42 } as never, "f");
    } catch (err) {
      expect(err).toMatchObject({ code: "MISSING_UPLOAD_TARGET", targetShape: "invalid" });
      expect(String(err)).not.toContain("42");
    }
  });
});

describe("uploadImage", () => {
  it("requests no thumbnail, POSTs encrypted bytes, and builds the CDN media reference", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (calls.length === 1) return jsonResponse({
        upload_full_url: "https://cdn.example/upload?signature=secret",
        upload_param: "opaque-param",
      });
      return new Response(null, { status: 200, headers: { "x-encrypted-param": "download-token" } });
    }) as typeof fetch;

    const item = await uploadImage(CREDS, "peer-1", PNG, { fetchImpl });
    expect(calls).toHaveLength(2);
    const request = JSON.parse(String(calls[0].init.body));
    expect(request).toMatchObject({
      media_type: 1, to_user_id: "peer-1", rawsize: PNG.length,
      no_need_thumb: true, filesize: Math.floor(PNG.length / 16) * 16 + 16,
    });
    expect(request.aeskey).toMatch(/^[0-9a-f]{32}$/);
    expect(request).not.toHaveProperty("thumb_rawsize");
    expect(calls[1].url).toBe("https://cdn.example/upload?signature=secret");
    expect(calls[1].init.method).toBe("POST");
    expect(item).toEqual({
      type: 2,
      image_item: {
        media: {
          encrypt_query_param: "download-token",
          aes_key: Buffer.from(request.aeskey).toString("base64"),
          encrypt_type: 1,
        },
        mid_size: request.filesize,
      },
    });
  });

  it("uses the CDN fallback for a real opaque upload_param and retries a server error", async () => {
    let cdnAttempts = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("getuploadurl")) return jsonResponse({ upload_param: "opaque+token" });
      cdnAttempts++;
      expect(new URL(String(url)).searchParams.get("encrypted_query_param")).toBe("opaque+token");
      return cdnAttempts === 1
        ? new Response("temporary", { status: 503 })
        : new Response(null, { status: 200, headers: { "x-encrypted-param": "download" } });
    }) as typeof fetch;
    const item = await uploadImage(CREDS, "peer-1", PNG, { fetchImpl, cdnBaseUrl: "https://cdn.example/c2c" });
    expect(cdnAttempts).toBe(2);
    expect(item.image_item?.media?.encrypt_query_param).toBe("download");
  });

  it("reports CDN client status and response body without retrying", async () => {
    let cdnAttempts = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("getuploadurl")) return jsonResponse({ upload_full_url: "https://cdn.example/upload" });
      cdnAttempts++;
      return new Response("bad signature", { status: 403 });
    }) as typeof fetch;
    await expect(uploadImage(CREDS, "peer-1", PNG, { fetchImpl })).rejects.toMatchObject({
      code: "CDN_CLIENT_ERROR", targetShape: "full_url", status: 403, responseBody: "bad signature",
    });
    expect(cdnAttempts).toBe(1);
  });

  it("rejects a successful CDN status without the required download header", async () => {
    let cdnAttempts = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("getuploadurl")) return jsonResponse({ upload_param: "opaque" });
      cdnAttempts++;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await expect(uploadImage(CREDS, "peer-1", PNG, { fetchImpl })).rejects.toMatchObject({
      code: "CDN_MISSING_DOWNLOAD_PARAM", targetShape: "opaque_param", status: 200,
    });
    expect(cdnAttempts).toBe(3);
  });

  it("times out a stalled CDN request and retries it a bounded number of times", async () => {
    let cdnAttempts = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("getuploadurl")) return jsonResponse({ upload_full_url: "https://cdn.example/upload" });
      cdnAttempts++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }) as typeof fetch;
    await expect(uploadImage(CREDS, "peer-1", PNG, {
      fetchImpl, cdnUploadTimeoutMs: 5,
    })).rejects.toMatchObject({ code: "CDN_NETWORK_ERROR", targetShape: "full_url" });
    expect(cdnAttempts).toBe(3);
  });
});
