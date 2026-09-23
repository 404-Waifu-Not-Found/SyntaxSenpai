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
  "waifuId": "aria",
  "responses": []
}
```

Use `responses` for deterministic tests. Without it, configure the provider with `SYNTAX_SENPAI_PROVIDER`, `SYNTAX_SENPAI_MODEL`, and the provider's existing API-key environment variable. Conversations remain in memory for the process lifetime, so multiple conversation IDs can be exercised in one JSONL session.

Each turn emits session/tool/game/side-effect events followed by one `response` record containing `conversationId`, `response`, `messages`, `history`, and `effects`. Malformed requests emit `request_error`. Use `pnpm test:headless` for the fixture tests. This runner does not open Electron windows or persist conversations to the desktop chat store; UI-only effects are represented by events.
