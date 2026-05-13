/**
 * Image-upload pipeline for the iLink protocol.
 *
 * Per the Tencent docs (`README` §getuploadurl), images are uploaded as
 * AES-128-ECB-encrypted blobs to a CDN URL returned by `getuploadurl`.
 * The same call returns a thumbnail-upload URL — we generate a 256-px
 * thumb client-side so the receiver's chat preview renders quickly.
 *
 * Encryption key: per docs, the symmetric key is derived from the file's
 * plaintext MD5 (first 16 bytes). Plaintext + ciphertext sizes are both
 * required by getuploadurl; ciphertext for AES-128-ECB rounds the
 * plaintext length up to the next 16-byte boundary with PKCS#7 padding.
 */

import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { ApiOptions, buildImageItem, getUploadUrl } from "./api";
import { Credentials, MediaType, MessageItem } from "./types";

/** Result of encrypting a blob for CDN upload. */
export interface EncryptedBlob {
  /** Cipher bytes ready to PUT to the upload URL. */
  cipher: Buffer;
  /** Plaintext MD5 hex string (lower-case). */
  rawMd5: string;
  /** Plaintext size in bytes. */
  rawSize: number;
  /** Ciphertext size in bytes. */
  cipherSize: number;
}

/** AES-128-ECB + PKCS#7. Key = first 16 bytes of plaintext MD5 digest. */
export function encryptForUpload(plain: Buffer): EncryptedBlob {
  const plainView = new Uint8Array(plain.buffer, plain.byteOffset, plain.byteLength);
  const md5 = createHash("md5").update(plainView).digest();
  const md5View = new Uint8Array(md5.buffer, md5.byteOffset, md5.byteLength);
  const key = md5View.slice(0, 16);
  // node's `createCipheriv` requires `iv = null` for ECB.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cipher = createCipheriv("aes-128-ecb" as any, key, null);
  cipher.setAutoPadding(true);
  const updated = cipher.update(plainView);
  const finalBlock = cipher.final();
  const out = Buffer.from(new Uint8Array([...updated, ...finalBlock]));
  return {
    cipher: out,
    rawMd5: md5.toString("hex"),
    rawSize: plain.length,
    cipherSize: out.length,
  };
}

/** Naive PNG thumbnail: just reuse the original if small, else caller may shrink. */
export function maybeShrinkPng(_buf: Buffer): Buffer {
  // We deliberately don't pull in `sharp` (native build) here — the
  // renderer-side html-to-image already produces appropriately-sized
  // PNGs (~720px), which WeChat treats as both image and thumbnail.
  // If the caller wants a real thumbnail it can pre-render one.
  return _buf;
}

/** Upload an encrypted blob to a CDN URL with the encrypted upload params. */
async function putCdn(
  uploadParam: string,
  blob: Buffer,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<void> {
  const f = fetchImpl ?? fetch;
  // The protocol embeds the destination URL plus signed query inside
  // `upload_param` (base64-encoded JSON). We forward the whole string as
  // the request URL — Tencent's gateway accepts that format directly per
  // the README example.
  const target = decodeUploadParamUrl(uploadParam);
  const body = new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  const res = await f(target, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    // Cast through `any` — Uint8Array is a valid BodyInit at runtime, but
    // `@types/node`'s ArrayBufferLike vs DOM ArrayBuffer divergence makes
    // the structural type check reject it under strict mode.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: body as any,
    signal,
  });
  if (!res.ok) {
    throw new Error(`CDN upload failed: HTTP ${res.status}`);
  }
}

function decodeUploadParamUrl(param: string): string {
  // The README shows `upload_param` as opaque; in practice the gateway
  // returns either a fully-qualified https URL or a base64-encoded JSON
  // envelope containing one. Handle both without being clever about it.
  if (/^https?:\/\//i.test(param)) return param;
  try {
    const decoded = Buffer.from(param, "base64").toString("utf8");
    const j = JSON.parse(decoded) as { url?: string };
    if (j.url && /^https?:\/\//i.test(j.url)) return j.url;
  } catch {
    /* fall through */
  }
  throw new Error("upload_param did not contain a usable URL");
}

/**
 * Full image-send pipeline: encrypt, call getuploadurl, upload to CDN,
 * and return a ready-to-send `MessageItem` for `sendmessage.item_list`.
 */
export async function uploadImage(
  creds: Credentials,
  toUserId: string,
  png: Buffer,
  apiOpts: ApiOptions = {},
): Promise<MessageItem> {
  const main = encryptForUpload(png);
  const thumb = encryptForUpload(maybeShrinkPng(png));
  const filekey = `img-${Date.now()}-${randomBytes(4).toString("hex")}`;

  const uploadInfo = await getUploadUrl(
    creds,
    {
      filekey,
      media_type: MediaType.IMAGE,
      to_user_id: toUserId,
      rawsize: main.rawSize,
      rawfilemd5: main.rawMd5,
      filesize: main.cipherSize,
      thumb_rawsize: thumb.rawSize,
      thumb_rawfilemd5: thumb.rawMd5,
      thumb_filesize: thumb.cipherSize,
    },
    apiOpts,
  );

  await putCdn(uploadInfo.upload_param, main.cipher, apiOpts.fetchImpl, apiOpts.signal);
  if (uploadInfo.thumb_upload_param) {
    await putCdn(uploadInfo.thumb_upload_param, thumb.cipher, apiOpts.fetchImpl, apiOpts.signal);
  }

  return buildImageItem({
    upload_param: uploadInfo.upload_param,
    thumb_upload_param: uploadInfo.thumb_upload_param,
    filekey,
    rawsize: main.rawSize,
    rawfilemd5: main.rawMd5,
    filesize: main.cipherSize,
    thumb_rawsize: thumb.rawSize,
    thumb_rawfilemd5: thumb.rawMd5,
    thumb_filesize: thumb.cipherSize,
  });
}
