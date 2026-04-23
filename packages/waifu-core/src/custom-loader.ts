/**
 * Loads user-authored waifu definitions from JSON files on disk.
 *
 * Each file is validated against the required shape (minimum viable
 * Waifu) and any file that doesn't pass is skipped with a logged
 * warning rather than blocking startup. Custom waifus always get
 * isBuiltIn: false and a generated createdAt if the file omits it.
 */

import type { Waifu } from "./types.js";

export interface LoadCustomWaifusOptions {
  directory: string;
  /**
   * Optional filesystem bindings. Abstracted so the same module works
   * in Node (supplied by the desktop main process) and, theoretically,
   * other runtimes.
   */
  fs: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string, opts: { withFileTypes?: boolean }) => any[];
    readFileSync: (path: string, enc: string) => string;
  };
  path: { join: (...parts: string[]) => string; basename: (p: string, ext?: string) => string };
  logger?: { warn: (obj: unknown, msg?: string) => void; info?: (obj: unknown, msg?: string) => void };
}

export interface LoadResult {
  waifus: Waifu[];
  errors: Array<{ file: string; reason: string }>;
}

/**
 * Returns true iff `raw` meets the minimum Waifu shape we require
 * from a custom file. Returns a list of validation errors as the
 * second element of the tuple; empty list means valid.
 */
export function validateWaifu(raw: any): { ok: true; waifu: Waifu } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "Not a JSON object" };
  }

  const required = ["id", "name", "displayName", "backstory", "personalityTraits", "communicationStyle", "systemPromptTemplate"];
  for (const key of required) {
    if (!(key in raw)) return { ok: false, reason: `Missing required field: ${key}` };
  }
  if (typeof raw.id !== "string" || !/^[a-z0-9_-]+$/i.test(raw.id)) {
    return { ok: false, reason: "id must be a slug-safe string" };
  }
  const traits = raw.personalityTraits;
  const traitKeys = ["warmth", "formality", "enthusiasm", "teasing", "verbosity", "humor"] as const;
  if (!traits || typeof traits !== "object") {
    return { ok: false, reason: "personalityTraits must be an object" };
  }
  for (const k of traitKeys) {
    const value = traits[k];
    if (typeof value !== "number" || value < 0 || value > 100) {
      return { ok: false, reason: `personalityTraits.${k} must be a number 0-100` };
    }
  }

  const waifu: Waifu = {
    ...raw,
    isBuiltIn: false,
    createdAt: raw.createdAt || new Date().toISOString(),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown) => typeof t === "string") : [],
    capabilities: raw.capabilities ?? {
      fileSystem: false,
      shellExec: false,
      networkAccess: true,
      specializedDomain: [],
    },
    avatar: raw.avatar ?? {
      expressions: {},
      idleAnimation: "",
    },
  };
  return { ok: true, waifu };
}

export function loadCustomWaifus(opts: LoadCustomWaifusOptions): LoadResult {
  const { directory, fs, path, logger } = opts;
  const result: LoadResult = { waifus: [], errors: [] };

  if (!fs.existsSync(directory)) {
    logger?.info?.({ directory }, "custom waifu directory missing, skipping");
    return result;
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true }) as Array<{ name: string; isFile: () => boolean } | string>;
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    const isFile = typeof entry === "string" ? true : entry.isFile();
    if (!isFile || !name.endsWith(".json")) continue;

    const filePath = path.join(directory, name);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push({ file: name, reason });
      logger?.warn?.({ file: name, reason }, "custom waifu has invalid JSON");
      continue;
    }

    const validated = validateWaifu(raw);
    if (!validated.ok) {
      result.errors.push({ file: name, reason: validated.reason });
      logger?.warn?.({ file: name, reason: validated.reason }, "custom waifu failed validation");
      continue;
    }

    result.waifus.push(validated.waifu);
  }

  return result;
}
