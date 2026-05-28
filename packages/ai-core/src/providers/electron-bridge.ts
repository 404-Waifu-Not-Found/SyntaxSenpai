/**
 * Electron IPC bridge for OpenAI-compatible chat completions.
 *
 * When running inside the SyntaxSenpai desktop app, providers like MiniMax,
 * DeepSeek, Groq, etc. are unreachable from the renderer because their CORS
 * policy rejects browser-origin requests. This module detects the Electron
 * preload bridge (`window.electron.ipcRenderer`) and, when present, forwards
 * the HTTPS call to the main process where CORS does not apply.
 *
 * In any non-Electron context (tests, mobile, bare Node) `isElectronBridgeAvailable`
 * returns false and callers fall back to their direct HTTP implementations.
 */

import type { StreamChunk } from "../types";

type IpcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (channel: string, handler: (...args: unknown[]) => void) => void;
};

function getIpc(): IpcRenderer | null {
  const w = typeof globalThis !== "undefined" ? (globalThis as { electron?: { ipcRenderer?: IpcRenderer } }) : undefined;
  const ipc = w?.electron?.ipcRenderer;
  if (!ipc || typeof ipc.invoke !== "function") return null;
  return ipc;
}

export function isElectronBridgeAvailable(): boolean {
  return getIpc() !== null;
}

export interface BridgeChatArgs {
  baseUrl: string;
  apiKey: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export async function bridgeChat(args: BridgeChatArgs): Promise<unknown> {
  const ipc = getIpc();
  if (!ipc) throw new Error("Electron bridge not available");
  const result = (await ipc.invoke("provider:chatComplete", args)) as {
    success: boolean;
    data?: unknown;
    error?: string;
    status?: number;
  };
  if (!result?.success) {
    // Preserve the upstream HTTP status on the thrown error so classifyError
    // can map it to auth / rate_limit / bad_request / server instead of
    // bucketing everything into "unknown".
    const message = result?.error ?? "unknown error";
    const err = new Error(message) as Error & { status?: number };
    if (typeof result?.status === "number") err.status = result.status;
    throw err;
  }
  return result.data;
}

export async function* bridgeChatStream(
  args: BridgeChatArgs
): AsyncIterable<StreamChunk> {
  const ipc = getIpc();
  if (!ipc) throw new Error("Electron bridge not available");
  const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const chunkChannel = `provider:chatStream:chunk:${streamId}`;
  const endChannel = `provider:chatStream:end:${streamId}`;

  const queue: StreamChunk[] = [];
  let ended = false;
  let endError: Error | null = null;
  let resolveWaiter: (() => void) | null = null;
  let pendingDone = false;
  let finalUsage: StreamChunk["usage"] | undefined;

  // OpenAI-compatible streams emit tool_calls in fragments keyed by `index`:
  // only the first fragment has `id`/`function.name`, and `function.arguments`
  // arrives as a sequence of partial JSON strings that must be concatenated
  // before parsing. Buffer per-index until finish_reason, then emit a single
  // assembled tool_call_delta per call.
  const toolCallBuffers = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  let nextSyntheticIndex = 0;

  const flushToolCallBuffers = () => {
    if (toolCallBuffers.size === 0) return;
    const sorted = Array.from(toolCallBuffers.entries()).sort(
      ([a], [b]) => a - b
    );
    for (const [, buf] of sorted) {
      let parsedArgs: Record<string, unknown> = {};
      if (buf.args) {
        try {
          parsedArgs = JSON.parse(buf.args) as Record<string, unknown>;
        } catch {
          parsedArgs = { _raw: buf.args };
        }
      }
      queue.push({
        type: "tool_call_delta",
        toolCall: {
          id: buf.id || "unknown",
          name: buf.name,
          arguments: parsedArgs,
        },
      });
    }
    toolCallBuffers.clear();
  };

  const wake = () => {
    const r = resolveWaiter;
    resolveWaiter = null;
    if (r) r();
  };

  const onChunk = (...a: unknown[]) => {
    const payload = a[0] as { raw?: string } | undefined;
    if (!payload?.raw) return;
    try {
      const parsed = JSON.parse(payload.raw) as {
        choices?: Array<{
          delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      if (parsed.usage && typeof parsed.usage.total_tokens === "number") {
        finalUsage = {
          promptTokens: parsed.usage.prompt_tokens || 0,
          completionTokens: parsed.usage.completion_tokens || 0,
          totalTokens: parsed.usage.total_tokens || 0,
        };
      }
      const delta = parsed.choices?.[0]?.delta;
      // DeepSeek reasoner streams chain-of-thought as reasoning_content,
      // separate from content — surface it so callers can show it live.
      if (delta?.reasoning_content) {
        queue.push({ type: "reasoning_delta", delta: delta.reasoning_content });
      }
      if (delta?.content) {
        queue.push({ type: "text_delta", delta: delta.content });
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!tc?.function && typeof tc?.index !== "number" && !tc?.id) continue;
          const idx =
            typeof tc.index === "number" ? tc.index : nextSyntheticIndex++;
          const buf = toolCallBuffers.get(idx) || {
            id: "",
            name: "",
            args: "",
          };
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
          if (typeof tc.function?.arguments === "string") {
            buf.args += tc.function.arguments;
          }
          toolCallBuffers.set(idx, buf);
        }
      }
      if (parsed.choices?.[0]?.finish_reason) {
        flushToolCallBuffers();
        // Defer the terminal "done" until the stream ends so we can attach
        // the usage chunk OpenAI emits AFTER finish_reason.
        pendingDone = true;
      }
    } catch {
      /* skip malformed chunk */
    }
    wake();
  };

  const onEnd = (...a: unknown[]) => {
    const payload = a[0] as { ok?: boolean; error?: string; cancelled?: boolean; status?: number } | undefined;
    if (payload?.error) {
      const err = new Error(payload.error) as Error & { status?: number };
      if (typeof payload.status === "number") err.status = payload.status;
      endError = err;
    }
    // Some providers close the stream without emitting a finish_reason chunk —
    // flush any buffered tool calls so they aren't silently dropped.
    if (!payload?.error) {
      flushToolCallBuffers();
      if (pendingDone || finalUsage) {
        queue.push({ type: "done", usage: finalUsage });
        pendingDone = false;
      }
    }
    ended = true;
    wake();
  };

  ipc.on(chunkChannel, onChunk);
  ipc.on(endChannel, onEnd);

  try {
    const start = (await ipc.invoke("provider:chatStream", { streamId, ...args })) as {
      success: boolean;
      error?: string;
    };
    if (!start?.success) {
      throw new Error(start?.error ?? "Failed to start stream");
    }

    while (true) {
      if (queue.length > 0) {
        const chunk = queue.shift()!;
        yield chunk;
        continue;
      }
      if (ended) {
        if (endError) throw endError;
        return;
      }
      await new Promise<void>((resolve) => {
        resolveWaiter = resolve;
      });
    }
  } finally {
    ipc.removeListener(chunkChannel, onChunk);
    ipc.removeListener(endChannel, onEnd);
    // Best-effort cancel in case the consumer broke out early.
    if (!ended) {
      try {
        await ipc.invoke("provider:chatStream:cancel", streamId);
      } catch {
        /* ignore */
      }
    }
  }
}
