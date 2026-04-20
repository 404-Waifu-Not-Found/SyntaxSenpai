/**
 * Typed error taxonomy + exponential-backoff retry for provider calls.
 *
 * Inspired by pguso/ai-agents-from-scratch L11 (error handling).
 */

export type ProviderErrorKind =
  | "rate_limit"
  | "auth"
  | "network"
  | "timeout"
  | "server"
  | "bad_request"
  | "unknown";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    opts: { retryable?: boolean; status?: number; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryable = opts.retryable ?? isRetryableKind(kind);
    this.status = opts.status;
    this.cause = opts.cause;
  }
}

function isRetryableKind(kind: ProviderErrorKind): boolean {
  return kind === "rate_limit" || kind === "network" || kind === "timeout" || kind === "server";
}

export function classifyError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;

  const anyErr = err as { status?: number; code?: string; message?: string } | undefined;
  const status = anyErr?.status;
  const code = anyErr?.code;
  const message = anyErr?.message || String(err);

  if (status === 401 || status === 403) {
    return new ProviderError("auth", `Auth failed: ${message}`, { status, retryable: false, cause: err });
  }
  if (status === 429) {
    return new ProviderError("rate_limit", `Rate limited: ${message}`, { status, cause: err });
  }
  if (status === 400 || status === 404 || status === 422) {
    return new ProviderError("bad_request", `Bad request: ${message}`, { status, retryable: false, cause: err });
  }
  if (status !== undefined && status >= 500) {
    return new ProviderError("server", `Server error ${status}: ${message}`, { status, cause: err });
  }
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || /timeout/i.test(message)) {
    return new ProviderError("timeout", `Timeout: ${message}`, { cause: err });
  }
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    /network|fetch failed/i.test(message)
  ) {
    return new ProviderError("network", `Network error: ${message}`, { cause: err });
  }
  return new ProviderError("unknown", message, { cause: err });
}

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  onRetry?: (err: ProviderError, attempt: number, delayMs: number) => void;
  signal?: AbortSignal;
}

const DEFAULTS: Required<Omit<RetryOptions, "onRetry" | "signal">> = {
  maxAttempts: 4,
  initialDelayMs: 500,
  maxDelayMs: 15_000,
  factor: 2,
  jitter: true,
};

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULTS, ...options };

  let attempt = 0;
  let lastError: ProviderError | undefined;

  while (attempt < opts.maxAttempts) {
    if (options.signal?.aborted) {
      throw new ProviderError("unknown", "Aborted", { retryable: false });
    }

    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const classified = classifyError(err);
      lastError = classified;

      if (!classified.retryable || attempt >= opts.maxAttempts) {
        throw classified;
      }

      const base = Math.min(opts.maxDelayMs, opts.initialDelayMs * Math.pow(opts.factor, attempt - 1));
      const delay = opts.jitter ? Math.round(base * (0.5 + Math.random() * 0.5)) : base;

      options.onRetry?.(classified, attempt, delay);
      await sleep(delay, options.signal);
    }
  }

  throw lastError ?? new ProviderError("unknown", "Retry exhausted");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError("unknown", "Aborted", { retryable: false }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError("unknown", "Aborted", { retryable: false }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
