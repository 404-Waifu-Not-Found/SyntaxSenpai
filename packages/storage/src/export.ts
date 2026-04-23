/**
 * Schema-versioned wrapping/unwrapping for data exports and backups.
 *
 * The wrapper shape is {@link ExportEnvelope} — a schemaVersion field plus
 * arbitrary `data` and optional extra fields. Older blobs without a version
 * are rejected with a friendly error rather than silently "working" and
 * clobbering current state with a stale shape.
 */

import { SCHEMA_VERSION, type ExportEnvelope } from "./types";

export type Migration = (raw: any) => any;

/**
 * Version-to-version migrations. Keys are the source version; the function
 * returns the envelope at version key+1. Keep migrations additive and
 * idempotent where possible.
 */
export const MIGRATIONS: Record<number, Migration> = {
  // 1 → 2 when we introduce a breaking change; for now no-op.
};

export interface WrapOptions {
  app?: string;
  extras?: Record<string, unknown>;
}

export function wrapExport<T>(data: T, opts: WrapOptions = {}): ExportEnvelope<T> {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: opts.app ?? "SyntaxSenpai",
    exportedAt: new Date().toISOString(),
    ...(opts.extras ?? {}),
    data,
  };
}

export class SchemaError extends Error {
  readonly code: "missing_version" | "unknown_version" | "not_object";

  constructor(code: SchemaError["code"], message: string) {
    super(message);
    this.name = "SchemaError";
    this.code = code;
  }
}

export interface UnwrapOptions {
  /** Accept envelopes newer than the current SCHEMA_VERSION (default: false). */
  allowNewer?: boolean;
}

/**
 * Validates the envelope shape, runs migrations up to SCHEMA_VERSION,
 * and returns the migrated envelope. Throws SchemaError on failure.
 */
export function unwrapExport<T = unknown>(
  raw: unknown,
  opts: UnwrapOptions = {}
): ExportEnvelope<T> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SchemaError("not_object", "Export payload is not a JSON object.");
  }

  const envelope = raw as Partial<ExportEnvelope<T>>;
  const version = envelope.schemaVersion;

  if (typeof version !== "number") {
    throw new SchemaError(
      "missing_version",
      "This file is missing a schemaVersion. It was probably produced by a build older than v1 and cannot be imported safely."
    );
  }

  if (version > SCHEMA_VERSION && !opts.allowNewer) {
    throw new SchemaError(
      "unknown_version",
      `Export is at schemaVersion ${version} but this build only understands ${SCHEMA_VERSION}. Update the app to import it.`
    );
  }

  let current: any = envelope;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      throw new SchemaError(
        "unknown_version",
        `No migration registered from schemaVersion ${v} to ${v + 1}.`
      );
    }
    current = step(current);
  }

  return current as ExportEnvelope<T>;
}
