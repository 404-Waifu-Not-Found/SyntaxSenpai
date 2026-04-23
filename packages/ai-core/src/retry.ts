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

export interface ProviderErrorOptions {
  retryable?: boolean;
  status?: number;
  cause?: unknown;
  hint?: string;
  provider?: string;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly cause?: unknown;
  readonly hint?: string;
  readonly provider?: string;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    opts: ProviderErrorOptions = {}
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryable = opts.retryable ?? isRetryableKind(kind);
    this.status = opts.status;
    this.cause = opts.cause;
    this.provider = opts.provider;
    this.hint = opts.hint ?? hintFor(kind, opts.provider);
  }
}

function isRetryableKind(kind: ProviderErrorKind): boolean {
  return kind === "rate_limit" || kind === "network" || kind === "timeout" || kind === "server";
}

/**
 * Human-readable hint explaining what to do about this error.
 * Generic by kind; mentions the provider when known.
 */
export function hintFor(kind: ProviderErrorKind, provider?: string): string {
  const who = provider ? provider : "the provider";
  switch (kind) {
    case "auth":
      return `Your API key for ${who} may be invalid, expired, or missing. Check the key in Settings → AI.`;
    case "rate_limit":
      return `${who} is rate-limiting this key. Wait a moment or switch models; retrying automatically.`;
    case "bad_request":
      return `${who} rejected the request payload — check the model name, message shape, or tool schema.`;
    case "server":
      return `${who} returned a server error. This is usually transient; retrying automatically.`;
    case "timeout":
      return `The request to ${who} timed out. If this keeps happening, try a smaller message or a faster model.`;
    case "network":
      return `Could not reach ${who}. Check your internet connection, VPN, or corporate proxy.`;
    default:
      return `${who} returned an unexpected error. See the console for details.`;
  }
}

export interface ClassifyOptions {
  provider?: string;
}

export function classifyError(err: unknown, options: ClassifyOptions = {}): ProviderError {
  if (err instanceof ProviderError) return err;

  const anyErr = err as { status?: number; code?: string; message?: string } | undefined;
  const status = anyErr?.status;
  const code = anyErr?.code;
  const message = anyErr?.message || String(err);
  const provider = options.provider;

  if (status === 401 || status === 403) {
    return new ProviderError("auth", `Auth failed: ${message}`, { status, retryable: false, cause: err, provider });
  }
  if (status === 429) {
    return new ProviderError("rate_limit", `Rate limited: ${message}`, { status, cause: err, provider });
  }
  if (status === 400 || status === 404 || status === 422) {
    return new ProviderError("bad_request", `Bad request: ${message}`, { status, retryable: false, cause: err, provider });
  }
  if (status !== undefined && status >= 500) {
    return new ProviderError("server", `Server error ${status}: ${message}`, { status, cause: err, provider });
  }
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || /timeout/i.test(message)) {
    return new ProviderError("timeout", `Timeout: ${message}`, { cause: err, provider });
  }
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    /network|fetch failed/i.test(message)
  ) {
    return new ProviderError("network", `Network error: ${message}`, { cause: err, provider });
  }
  return new ProviderError("unknown", message, { cause: err, provider });
}

/**
 * Human-readable one-line summary suitable for UI toasts.
 * Prefers the hint when available; falls back to message.
 */
export function describeError(err: unknown): string {
  const pe = err instanceof ProviderError ? err : classifyError(err);
  return pe.hint || pe.message;
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
