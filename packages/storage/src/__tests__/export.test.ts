import { describe, it, expect } from "vitest";
import { wrapExport, unwrapExport, SchemaError } from "../export";
import { SCHEMA_VERSION } from "../types";

describe("wrapExport", () => {
  it("adds schemaVersion, exportedAt, app, and data", () => {
    const env = wrapExport({ foo: 1 });
    expect(env.schemaVersion).toBe(SCHEMA_VERSION);
    expect(env.app).toBe("SyntaxSenpai");
    expect(typeof env.exportedAt).toBe("string");
    expect(env.data).toEqual({ foo: 1 });
  });

  it("accepts extras and a custom app name", () => {
    const env = wrapExport("payload", {
      app: "SyntaxSenpai-Runtime",
      extras: { reason: "nightly" },
    });
    expect(env.app).toBe("SyntaxSenpai-Runtime");
    expect(env.reason).toBe("nightly");
    expect(env.data).toBe("payload");
  });
});

describe("unwrapExport", () => {
  it("returns the envelope when schemaVersion matches", () => {
    const env = wrapExport({ items: [1, 2, 3] });
    expect(unwrapExport(env).data).toEqual({ items: [1, 2, 3] });
  });

  it("throws SchemaError for non-objects", () => {
    expect(() => unwrapExport(null)).toThrow(SchemaError);
    expect(() => unwrapExport([1, 2])).toThrow(SchemaError);
    expect(() => unwrapExport("str" as any)).toThrow(SchemaError);
  });

  it("throws missing_version when schemaVersion is absent", () => {
    try {
      unwrapExport({ data: {} });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaError);
      expect((err as SchemaError).code).toBe("missing_version");
    }
  });

  it("throws unknown_version for newer versions by default", () => {
    try {
      unwrapExport({ schemaVersion: SCHEMA_VERSION + 1, data: {} });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as SchemaError).code).toBe("unknown_version");
    }
  });

  it("accepts newer versions when allowNewer is true", () => {
    const env = unwrapExport(
      { schemaVersion: SCHEMA_VERSION + 1, data: { future: true } },
      { allowNewer: true }
    );
    expect((env.data as any).future).toBe(true);
  });
});
