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
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string;
        }>;
      };
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) {
        queue.push({ type: "text_delta", delta: delta.content });
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!tc?.function) continue;
          let parsedArgs: Record<string, unknown> = {};
          if (tc.function.arguments) {
            try {
              parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            } catch {
              parsedArgs = { _raw: tc.function.arguments };
            }
          }
          queue.push({
            type: "tool_call_delta",
            toolCall: {
              id: tc.id || "unknown",
              name: tc.function.name || "",
              arguments: parsedArgs,
            },
          });
        }
      }
      if (parsed.choices?.[0]?.finish_reason) {
        queue.push({ type: "done" });
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
