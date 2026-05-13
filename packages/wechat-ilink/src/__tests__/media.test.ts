import { createDecipheriv, createHash } from "node:crypto";
import { describe, it, expect } from "vitest";

import { encryptForUpload } from "../media";

describe("encryptForUpload", () => {
  it("uses AES-128-ECB with key = first 16 bytes of plaintext MD5", () => {
    const plain = Buffer.from("hello-wechat-ilink-image-payload");
    const out = encryptForUpload(plain);

    const plainView = new Uint8Array(plain.buffer, plain.byteOffset, plain.byteLength);
    const md5 = createHash("md5").update(plainView).digest();
    expect(out.rawMd5).toBe(md5.toString("hex"));
    expect(out.rawSize).toBe(plain.length);

    const md5View = new Uint8Array(md5.buffer, md5.byteOffset, md5.byteLength);
    const key = md5View.slice(0, 16);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dec = createDecipheriv("aes-128-ecb" as any, key, null);
    dec.setAutoPadding(true);
    const cipherView = new Uint8Array(out.cipher.buffer, out.cipher.byteOffset, out.cipher.byteLength);
    const updated = dec.update(cipherView);
    const finalBlock = dec.final();
    const round = new Uint8Array([...updated, ...finalBlock]);
    const plainBytes = new Uint8Array(plain.buffer, plain.byteOffset, plain.byteLength);
    expect(round.length).toBe(plainBytes.length);
    for (let i = 0; i < round.length; i++) expect(round[i]).toBe(plainBytes[i]);
  });

  it("ciphertext size is plaintext rounded up to 16-byte boundary (PKCS#7)", () => {
    for (const len of [0, 1, 15, 16, 17, 31, 32]) {
      const plain = Buffer.alloc(len, 0xaa);
      const out = encryptForUpload(plain);
      const expected = Math.floor(len / 16) * 16 + 16; // full pad block always added
      expect(out.cipherSize).toBe(expected);
    }
  });
});
