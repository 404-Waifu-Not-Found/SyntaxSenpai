/**
 * Helpers for importing Live2D model assets — either a model JSON file picked
 * directly, or a `.zip` archive that contains the model folder somewhere inside.
 *
 * Everything in this module is plain Node (fs/path/os). It is intentionally
 * decoupled from Electron so it can be unit-tested with vitest. The desktop
 * IPC handler in `apps/desktop/src/main/ipc/waifus.ts` is the only production
 * consumer today.
 */

import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

/**
 * Matches both `something.model3.json` (Cubism 4) and `something.model.json`
 * (Cubism 2). Also matches the bare names `model.json` / `model3.json` for
 * exports that drop the prefix.
 */
export const LIVE2D_MODEL_JSON_RE = /(^|\.)model3?\.json$/i;

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Walks `root` breadth-first and returns the path to the first
 * `.model3.json` / `.model.json` it encounters. BFS so that a shallow,
 * top-level model JSON wins over one buried in a subfolder.
 *
 * Returns `null` if no match exists or `root` is unreadable.
 */
export function findLive2DModelJson(root: string): string | null {
  if (!fs.existsSync(root)) return null;
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && LIVE2D_MODEL_JSON_RE.test(entry.name)) {
        return path.join(dir, entry.name);
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(path.join(dir, entry.name));
      }
    }
  }
  return null;
}

/**
 * Build a flat file map from a model directory. This mirrors what the
 * pixi-live2d-display FileLoader expects from a webkitdirectory upload:
 * - every file in the tree becomes a relative path keyed record
 * - the model settings file is returned separately so the caller can seed the runtime
 * - expression / motion resource names that ship in a folder are retained in the map
 */
export function buildLive2DResourceMap(root: string): {
  modelJsonPath: string | null;
  resources: Record<string, string>;
} | null {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;

  const queue: string[] = [root];
  const resources: Record<string, string> = {};
  let modelJsonPath: string | null = null;

  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }

      if (!entry.isFile()) continue;
      const rel = path.relative(root, full).replace(/\\/g, '/');
      resources[rel] = full;
      if (LIVE2D_MODEL_JSON_RE.test(entry.name)) {
        modelJsonPath = full;
      }
    }
  }

  return {
    modelJsonPath,
    resources,
  };
}

/**
 * Reduce a model/folder name to a filesystem-safe slug:
 * - lowercase
 * - keep [a-z0-9_-]
 * - collapse other runs into `-`
 * - trim leading/trailing dashes
 *
 * Returns an empty string when the input contains no safe characters.
 */
export function slugifyModelName(name: string): string {
  const slug = name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  let start = 0;
  let end = slug.length;

  while (start < end && slug[start] === "-") start += 1;
  while (end > start && slug[end - 1] === "-") end -= 1;

  return slug.slice(start, end);
}

/**
 * Recursively copy a directory tree.
 *
 * - Creates `dest` if missing.
 * - Files are written with `copyFileSync` (preserves bytes; no symlinks).
 * - Does NOT follow symlinks across directory boundaries — symlinked files
 *   are copied as their target contents, symlinked dirs are skipped.
 */
export function copyDirRecursive(src: string, dest: string): void {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
    // symlinks and other types intentionally ignored
  }
}

/**
 * Extract a zip archive into `destDir`, refusing any entry whose target
 * would land outside `destDir` ("zip-slip" defence).
 *
 * Rejected:
 *   - absolute paths inside the zip
 *   - any path segment equal to `..`
 *   - paths whose resolved location is outside `destDir`
 *
 * Returns the number of *file* entries written (directory entries are
 * created on demand but not counted).
 */
export function extractZipSafely(zipPath: string, destDir: string): number {
  const zip = new AdmZip(zipPath);
  ensureDir(destDir);
  const resolvedDest = path.resolve(destDir);
  let written = 0;
  for (const entry of zip.getEntries()) {
    const entryName: string = entry.entryName;

    // Normalize: zip entries are always forward-slash, but be paranoid.
    const normalized = entryName.replace(/\\/g, "/");

    // Reject absolute paths and any `..` segment outright.
    if (path.posix.isAbsolute(normalized) || path.isAbsolute(normalized)) {
      throw new Error(`Unsafe zip entry path (absolute): ${entryName}`);
    }
    if (normalized.split("/").some((seg) => seg === "..")) {
      throw new Error(`Unsafe zip entry path (traversal): ${entryName}`);
    }

    const target = path.resolve(destDir, normalized);
    // Belt-and-braces: resolved target must remain under destDir.
    const rel = path.relative(resolvedDest, target);
    if (rel === "" && entry.isDirectory) {
      // Zip contained an entry for the root itself — fine, just ensure it.
      ensureDir(target);
      continue;
    }
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Unsafe zip entry path (outside dest): ${entryName}`);
    }

    if (entry.isDirectory) {
      ensureDir(target);
    } else {
      ensureDir(path.dirname(target));
      fs.writeFileSync(target, entry.getData());
      written++;
    }
  }
  return written;
}

/**
 * Deep-merge two plain JSON-shaped objects. The `patch` wins on conflicts.
 * Arrays and non-plain values are replaced wholesale (not concatenated)
 * because waifu config arrays (e.g. avatar.expressions) are full state.
 */
export function deepMergePlainObjects<T extends Record<string, unknown>>(
  base: T,
  patch: Partial<T> | Record<string, unknown>,
): T {
  if (!isPlainObject(base)) return patch as T;
  if (!isPlainObject(patch)) return patch as T;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const patchVal = (patch as Record<string, unknown>)[key];
    if (isPlainObject(baseVal) && isPlainObject(patchVal)) {
      out[key] = deepMergePlainObjects(
        baseVal as Record<string, unknown>,
        patchVal as Record<string, unknown>,
      );
    } else {
      out[key] = patchVal;
    }
  }
  return out as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
