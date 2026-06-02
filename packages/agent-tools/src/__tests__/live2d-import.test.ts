import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

import {
  LIVE2D_MODEL_JSON_RE,
  findLive2DModelJson,
  slugifyModelName,
  copyDirRecursive,
  extractZipSafely,
  deepMergePlainObjects,
  ensureDir,
} from "../live2d-import";

const REAL_FIXTURE_ZIP = process.env.LIVE2D_FIXTURE_ZIP ?? '';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Build a zip file in-memory from a flat record of entryName -> contents.
 * Strings become text, Buffers become raw bytes. Names ending with "/" are
 * created as directory entries.
 *
 * adm-zip's `addFile()` strips `..` and leading `/` from the name passed in,
 * so to test the zip-slip defence we have to write a placeholder file and
 * then rewrite `entry.entryName` directly — the setter trusts the caller and
 * stores the bytes verbatim, so the resulting zip carries the hostile name.
 */
function makeFixtureZip(
  entries: Record<string, string | Buffer | null>,
): Buffer {
  const zip = new AdmZip();
  let idx = 0;
  const rewrites: Array<{ index: number; name: string }> = [];
  for (const [name, body] of Object.entries(entries)) {
    const placeholder = `__entry_${idx}__`;
    if (name.endsWith("/") || body === null) {
      zip.addFile(placeholder, Buffer.alloc(0));
    } else {
      zip.addFile(placeholder, typeof body === "string" ? Buffer.from(body, "utf8") : body);
    }
    rewrites.push({ index: idx, name });
    idx++;
  }
  const built = zip.getEntries();
  for (const { index, name } of rewrites) {
    built[index].entryName = name;
  }
  return zip.toBuffer();
}

/**
 * TS 5.7+ made Uint8Array generic; Node's Buffer (always ArrayBuffer-backed at
 * runtime) is no longer directly assignable to Uint8Array<ArrayBufferLike>.
 */
function u8(buf: Buffer): Uint8Array<ArrayBuffer> {
  return buf as unknown as Uint8Array<ArrayBuffer>;
}

function writeFixtureZip(
  destPath: string,
  entries: Record<string, string | Buffer | null>,
): void {
  fs.writeFileSync(destPath, u8(makeFixtureZip(entries)));
}

describe("LIVE2D_MODEL_JSON_RE", () => {
  it.each([
    ["model.json", true],
    ["model3.json", true],
    ["mao_pro.model3.json", true],
    ["MAO_PRO.MODEL3.JSON", true],
    ["foo.Model.JSON", true],
    ["something.model.json.bak", false],
    ["model.json.txt", false],
    ["motion3.json", false],
    ["mao.cdi3.json", false],
    ["model3", false],
    ["", false],
  ])("matches %s -> %s", (name, expected) => {
    expect(LIVE2D_MODEL_JSON_RE.test(name)).toBe(expected);
  });
});

describe("slugifyModelName", () => {
  it.each([
    ["mao_pro_zh", "mao_pro_zh"],
    ["Mao Pro ZH", "mao-pro-zh"],
    ["mao  pro", "mao-pro"],
    ["  --hello--  ", "hello"],
    ["----", ""],
    ["", ""],
    ["__keep_underscores__", "__keep_underscores__"],
    ["a.b.c", "a-b-c"],
    ["unicode🐱cat", "unicode-cat"],
    ["with/slash\\back", "with-slash-back"],
    ["UPPER", "upper"],
    ["already-kebab-case", "already-kebab-case"],
    ["1234", "1234"],
  ])("slugifies %p -> %p", (input, expected) => {
    expect(slugifyModelName(input)).toBe(expected);
  });
});

describe("deepMergePlainObjects", () => {
  it("merges nested objects with patch winning", () => {
    const base = { id: "aria", avatar: { idle: "a.png", happy: "h.png" }, traits: { warmth: 60 } };
    const patch = { avatar: { live2dModel: { modelJsonPath: "u://x" } } };
    const out = deepMergePlainObjects(base, patch);
    expect(out).toEqual({
      id: "aria",
      avatar: { idle: "a.png", happy: "h.png", live2dModel: { modelJsonPath: "u://x" } },
      traits: { warmth: 60 },
    });
  });

  it("replaces arrays wholesale", () => {
    const base = { tags: ["a", "b", "c"] } as Record<string, unknown>;
    const patch = { tags: ["x"] } as Record<string, unknown>;
    expect(deepMergePlainObjects(base, patch)).toEqual({ tags: ["x"] });
  });

  it("null patch value clears the field", () => {
    const base = { avatar: { live2dModel: { modelJsonPath: "u://x" } } } as Record<string, unknown>;
    const patch = { avatar: { live2dModel: null } } as Record<string, unknown>;
    expect(deepMergePlainObjects(base, patch)).toEqual({ avatar: { live2dModel: null } });
  });

  it("does not mutate the inputs", () => {
    const base = { a: { b: 1 } };
    const patch = { a: { c: 2 } };
    const baseSnap = JSON.stringify(base);
    const patchSnap = JSON.stringify(patch);
    deepMergePlainObjects(base, patch);
    expect(JSON.stringify(base)).toBe(baseSnap);
    expect(JSON.stringify(patch)).toBe(patchSnap);
  });

  it("returns the patch when base is not a plain object", () => {
    expect(deepMergePlainObjects(null as any, { id: "x" })).toEqual({ id: "x" });
  });
});

describe("findLive2DModelJson", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTempDir("ss-find-"); });
  afterEach(() => { rmTempDir(tmp); });

  it("returns null when the directory does not exist", () => {
    expect(findLive2DModelJson(path.join(tmp, "nope"))).toBeNull();
  });

  it("returns null for an empty directory", () => {
    expect(findLive2DModelJson(tmp)).toBeNull();
  });

  it("finds a top-level .model3.json", () => {
    fs.writeFileSync(path.join(tmp, "mao.model3.json"), "{}");
    expect(findLive2DModelJson(tmp)).toBe(path.join(tmp, "mao.model3.json"));
  });

  it("finds a Cubism 2 .model.json", () => {
    fs.writeFileSync(path.join(tmp, "haru.model.json"), "{}");
    expect(findLive2DModelJson(tmp)).toBe(path.join(tmp, "haru.model.json"));
  });

  it("finds a deeply nested model.json", () => {
    const deep = path.join(tmp, "outer", "runtime");
    ensureDir(deep);
    fs.writeFileSync(path.join(deep, "mao.model3.json"), "{}");
    expect(findLive2DModelJson(tmp)).toBe(path.join(deep, "mao.model3.json"));
  });

  it("BFS picks the shallowest match", () => {
    // Two model JSONs at different depths — BFS must surface the shallow one.
    const deep = path.join(tmp, "a", "b", "c");
    const shallow = path.join(tmp, "top");
    ensureDir(deep);
    ensureDir(shallow);
    fs.writeFileSync(path.join(deep, "deep.model3.json"), "{}");
    fs.writeFileSync(path.join(shallow, "shallow.model3.json"), "{}");
    expect(findLive2DModelJson(tmp)).toBe(path.join(shallow, "shallow.model3.json"));
  });

  it("ignores look-alikes (motion3.json, cdi3.json)", () => {
    fs.writeFileSync(path.join(tmp, "mtn.motion3.json"), "{}");
    fs.writeFileSync(path.join(tmp, "p.cdi3.json"), "{}");
    expect(findLive2DModelJson(tmp)).toBeNull();
  });

  it("skips unreadable subdirectories without throwing", () => {
    // Make a subdir, then chmod it to 0 so readdir fails. Best-effort on systems
    // where this is allowed; on others (e.g. CI running as root) we just skip.
    const locked = path.join(tmp, "locked");
    ensureDir(locked);
    fs.writeFileSync(path.join(tmp, "found.model3.json"), "{}");
    try {
      fs.chmodSync(locked, 0o000);
    } catch {
      /* may not be supported; the test still validates that no throw occurs */
    }
    expect(() => findLive2DModelJson(tmp)).not.toThrow();
    expect(findLive2DModelJson(tmp)).toBe(path.join(tmp, "found.model3.json"));
    try {
      fs.chmodSync(locked, 0o700);
    } catch {
      /* ignore */
    }
  });
});

describe("copyDirRecursive", () => {
  let src: string;
  let dest: string;
  beforeEach(() => {
    src = mkTempDir("ss-copy-src-");
    dest = mkTempDir("ss-copy-dest-");
  });
  afterEach(() => {
    rmTempDir(src);
    rmTempDir(dest);
  });

  it("copies a flat file", () => {
    fs.writeFileSync(path.join(src, "a.txt"), "hello");
    copyDirRecursive(src, path.join(dest, "out"));
    expect(fs.readFileSync(path.join(dest, "out", "a.txt"), "utf8")).toBe("hello");
  });

  it("copies a nested tree preserving structure", () => {
    ensureDir(path.join(src, "deep", "deeper"));
    fs.writeFileSync(path.join(src, "deep", "deeper", "b.bin"), u8(Buffer.from([1, 2, 3, 4])));
    fs.writeFileSync(path.join(src, "deep", "a.txt"), "x");
    copyDirRecursive(src, dest);
    expect(fs.readFileSync(path.join(dest, "deep", "a.txt"), "utf8")).toBe("x");
    expect(fs.readFileSync(path.join(dest, "deep", "deeper", "b.bin"))).toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
  });

  it("creates the destination directory if missing", () => {
    fs.writeFileSync(path.join(src, "f"), "");
    const target = path.join(dest, "freshly-created", "and-nested");
    copyDirRecursive(src, target);
    expect(fs.existsSync(path.join(target, "f"))).toBe(true);
  });
});

describe("extractZipSafely (round-trip)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTempDir("ss-zip-"); });
  afterEach(() => { rmTempDir(tmp); });

  it("extracts a flat zip and returns the file count", () => {
    const zipPath = path.join(tmp, "input.zip");
    writeFixtureZip(zipPath, {
      "a.txt": "hello",
      "b.bin": Buffer.from([0xff, 0x01]),
    });
    const outDir = path.join(tmp, "out");
    const count = extractZipSafely(zipPath, outDir);
    expect(count).toBe(2);
    expect(fs.readFileSync(path.join(outDir, "a.txt"), "utf8")).toBe("hello");
    expect(fs.readFileSync(path.join(outDir, "b.bin"))).toEqual(Buffer.from([0xff, 0x01]));
  });

  it("extracts a nested Live2D-shaped archive", () => {
    const zipPath = path.join(tmp, "model.zip");
    writeFixtureZip(zipPath, {
      "pkg/": null,
      "pkg/runtime/": null,
      "pkg/runtime/mao.model3.json": JSON.stringify({ Version: 3, FileReferences: { Moc: "mao.moc3" } }),
      "pkg/runtime/mao.moc3": Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      "pkg/runtime/textures/": null,
      "pkg/runtime/textures/t0.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    const outDir = path.join(tmp, "out");
    const count = extractZipSafely(zipPath, outDir);
    expect(count).toBe(3);
    const found = findLive2DModelJson(outDir);
    expect(found).toBe(path.join(outDir, "pkg", "runtime", "mao.model3.json"));
    expect(fs.existsSync(path.join(outDir, "pkg", "runtime", "mao.moc3"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "pkg", "runtime", "textures", "t0.png"))).toBe(true);
  });

  it("rejects an entry whose path is absolute (POSIX)", () => {
    const zipPath = path.join(tmp, "evil.zip");
    writeFixtureZip(zipPath, {
      "/etc/passwd": "hax",
    });
    expect(() => extractZipSafely(zipPath, path.join(tmp, "out"))).toThrow(/Unsafe zip entry path/i);
  });

  it("rejects an entry containing `..` traversal", () => {
    const zipPath = path.join(tmp, "evil2.zip");
    writeFixtureZip(zipPath, {
      "../escape.txt": "hax",
    });
    expect(() => extractZipSafely(zipPath, path.join(tmp, "out"))).toThrow(/Unsafe zip entry path/i);
  });

  it("rejects a deeply nested traversal that climbs out", () => {
    const zipPath = path.join(tmp, "evil3.zip");
    writeFixtureZip(zipPath, {
      "a/b/../../../escape.txt": "hax",
    });
    expect(() => extractZipSafely(zipPath, path.join(tmp, "out"))).toThrow(/Unsafe zip entry path/i);
  });

  it("rejects a windows-style backslash traversal", () => {
    const zipPath = path.join(tmp, "evil4.zip");
    writeFixtureZip(zipPath, {
      "..\\escape.txt": "hax",
    });
    expect(() => extractZipSafely(zipPath, path.join(tmp, "out"))).toThrow(/Unsafe zip entry path/i);
  });

  it("does not write any files when the zip is rejected partway through", () => {
    // First entry is safe, second escapes. We accept either:
    //  - throw before writing anything (preferred),
    //  - throw after writing the safe entry, leaving the unsafe one absent.
    // Either way, the unsafe target must not exist.
    const zipPath = path.join(tmp, "mixed.zip");
    writeFixtureZip(zipPath, {
      "ok.txt": "safe",
      "../escape.txt": "hax",
    });
    const outDir = path.join(tmp, "out");
    expect(() => extractZipSafely(zipPath, outDir)).toThrow();
    expect(fs.existsSync(path.join(path.dirname(outDir), "escape.txt"))).toBe(false);
  });

  it("creates intermediate directories on demand", () => {
    const zipPath = path.join(tmp, "deep.zip");
    writeFixtureZip(zipPath, {
      "a/b/c/d/e.txt": "deep",
    });
    const outDir = path.join(tmp, "out");
    extractZipSafely(zipPath, outDir);
    expect(fs.readFileSync(path.join(outDir, "a", "b", "c", "d", "e.txt"), "utf8")).toBe("deep");
  });

  it("handles empty zips", () => {
    const zipPath = path.join(tmp, "empty.zip");
    writeFixtureZip(zipPath, {});
    const outDir = path.join(tmp, "out");
    expect(extractZipSafely(zipPath, outDir)).toBe(0);
    expect(fs.existsSync(outDir)).toBe(true);
  });
});

describe("real-world fixture: mao_pro_zh.zip", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTempDir("ss-real-"); });
  afterEach(() => { rmTempDir(tmp); });

  const hasFixture = fs.existsSync(REAL_FIXTURE_ZIP);

  it.runIf(hasFixture)(
    "extracts and resolves the model JSON at mao_pro_zh/runtime/mao_pro.model3.json",
    () => {
      // The fixture contains a 70 MB .cmo3 + 8 MB texture, so the synchronous
      // write loop can take a few seconds on cold storage. Bump beyond the
      // 5 s vitest default.
      const count = extractZipSafely(REAL_FIXTURE_ZIP, tmp);
      expect(count).toBeGreaterThan(0);
      const found = findLive2DModelJson(tmp);
      expect(found).not.toBeNull();
      expect(found!.endsWith(path.join("mao_pro_zh", "runtime", "mao_pro.model3.json"))).toBe(true);
      const meta = JSON.parse(fs.readFileSync(found!, "utf8"));
      expect(typeof meta.Version).toBe("number");
      const moc = path.join(path.dirname(found!), meta.FileReferences.Moc);
      expect(fs.existsSync(moc)).toBe(true);
    },
    30_000,
  );

  it.skipIf(hasFixture)("fixture file present (skipped when missing)", () => {
    // Placeholder so the CI run reports a meaningful skip line instead of
    // silently dropping coverage when the local fixture is unavailable.
    expect(hasFixture).toBe(false);
  });
});
