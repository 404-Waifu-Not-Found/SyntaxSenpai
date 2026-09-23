# SyntaxSenpai Headless Runtime

The headless runner uses the same `runAgentSession` loop as the Electron chat. It accepts one JSON request per line and emits ordered JSON events on stdout. Diagnostics go to stderr.

Run from the repository root with a deterministic fixture and no API key:

```bash
printf '%s\n' '{"type":"turn","text":"hello","responses":[{"id":"a1","content":"hello","toolCalls":[],"usage":{"promptTokens":1,"completionTokens":1,"totalTokens":2},"finishReason":"stop"}]}' | pnpm dev:headless
```

A request has this shape:

```json
{
  "type": "turn",
  "conversationId": "test-1",
  "text": "play tic-tac-toe with me",
  "waifuId": "aria"
}
```

Use a non-empty `responses` array for deterministic tests. An empty array is rejected; omit the field to use a live provider configured with `SYNTAX_SENPAI_PROVIDER`, `SYNTAX_SENPAI_MODEL`, and the provider's API-key environment variable. Conversations remain in memory for the process lifetime, so multiple conversation IDs can be exercised in one JSONL session.

After `game_start` opens a board, send a human move to the same conversation:

```json
{"type":"human_move","conversationId":"test-1","move":"4"}
```

The human move is applied to the real engine, the engine immediately replies if it is its turn, and the session then asks the provider for a short remark. Supply `responses` on this input too when running a provider-free fixture. Moves are `0`–`8` for Tic-Tac-Toe, columns `0`–`6` for Connect Four, and SAN or long algebraic notation (such as `e2e4`) for chess. A `game_event` is emitted for each board move.

If the remark's provider fails after the board moves, the response still includes `gameSnapshot` and a `commentaryError`; do not resend the same move.

Each turn emits session/tool/game/side-effect events followed by a compact `response` containing `conversationId`, `response`, `messages`, `newMessages`, and `newEffects` (plus `gameSnapshot` for a human move). Set `includeHistory: true` to include full `history` and cumulative `effects`. Malformed requests emit `request_error`. Use `pnpm test:headless` for fixture tests.

This runner does not open Electron windows or persist conversations to the desktop chat store. UI-only effects are events. Desktop-only integrations and interactive browser controls are not advertised to the headless agent; the browser adapter supports text navigation/readback, not actual page clicks or typing. Unsupported direct tool calls return an explicit error rather than pretending they worked.
