import { describe, it, expect, vi } from "vitest";
import { classifyError, withRetry, ProviderError } from "../retry";

describe("classifyError", () => {
  it("returns the same ProviderError instance", () => {
    const err = new ProviderError("auth", "nope");
    expect(classifyError(err)).toBe(err);
  });

  it("classifies 401/403 as non-retryable auth", () => {
    const p = classifyError({ status: 401, message: "bad key" });
    expect(p.kind).toBe("auth");
    expect(p.retryable).toBe(false);
    expect(p.status).toBe(401);
  });

  it("classifies 429 as retryable rate_limit", () => {
    const p = classifyError({ status: 429, message: "slow down" });
    expect(p.kind).toBe("rate_limit");
    expect(p.retryable).toBe(true);
  });

  it("classifies 400/404/422 as non-retryable bad_request", () => {
    for (const status of [400, 404, 422]) {
      const p = classifyError({ status, message: "nope" });
      expect(p.kind).toBe("bad_request");
      expect(p.retryable).toBe(false);
    }
  });

  it("classifies 5xx as retryable server", () => {
    const p = classifyError({ status: 503, message: "down" });
    expect(p.kind).toBe("server");
    expect(p.retryable).toBe(true);
  });

  it("classifies timeouts", () => {
    expect(classifyError({ code: "ETIMEDOUT", message: "" }).kind).toBe("timeout");
    expect(classifyError({ message: "Request timeout" }).kind).toBe("timeout");
  });

  it("classifies common network errors", () => {
    expect(classifyError({ code: "ECONNRESET", message: "" }).kind).toBe("network");
    expect(classifyError({ code: "ENOTFOUND", message: "" }).kind).toBe("network");
    expect(classifyError({ message: "fetch failed" }).kind).toBe("network");
  });

  it("falls back to unknown", () => {
    expect(classifyError({ message: "weird" }).kind).toBe("unknown");
  });
});

describe("withRetry", () => {
  it("returns on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable errors and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw { status: 503, message: "flake" };
      return "ok";
    });
    await expect(
      withRetry(fn, { initialDelayMs: 1, maxDelayMs: 2, jitter: false })
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401, message: "nope" });
    await expect(
      withRetry(fn, { initialDelayMs: 1, jitter: false })
    ).rejects.toMatchObject({ kind: "auth" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the classified error after maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503, message: "dead" });
    await expect(
      withRetry(fn, { maxAttempts: 2, initialDelayMs: 1, jitter: false })
    ).rejects.toMatchObject({ kind: "server" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("invokes onRetry for each retry", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: "x" })
      .mockResolvedValueOnce("ok");
    await withRetry(fn, { initialDelayMs: 1, jitter: false, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
