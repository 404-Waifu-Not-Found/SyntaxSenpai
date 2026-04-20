/**
 * Structured trace events emitted during a ReAct-style agent turn.
 *
 * Consumers (UI, logging) subscribe via `TraceHandler` to observe the
 * agent's reasoning, tool calls, and observations as the turn unfolds.
 *
 * Inspired by pguso/ai-agents-from-scratch L09 (ReAct agent).
 */

import type { ToolCall } from "./types";

export type AgentTraceEvent =
  | { type: "turn_start"; iteration: 0; userText: string }
  | { type: "thought"; iteration: number; text: string }
  | { type: "action"; iteration: number; toolCall: ToolCall }
  | { type: "observation"; iteration: number; toolCallId: string; content: string; isError: boolean }
  | { type: "retry"; iteration: number; reason: string; attempt: number; delayMs: number }
  | { type: "final_answer"; iteration: number; text: string }
  | { type: "turn_end"; iterations: number }
  | { type: "error"; iteration: number; message: string };

export type TraceHandler = (event: AgentTraceEvent) => void;

export class TraceEmitter {
  private handlers: TraceHandler[] = [];

  on(handler: TraceHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  emit(event: AgentTraceEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        // Never let a trace handler break the agent loop.
      }
    }
  }
}
