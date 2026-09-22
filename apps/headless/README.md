# SyntaxSenpai Headless Runtime

The headless runner uses the same `runAgentSession` loop as the Electron chat. It accepts one JSON request per line and emits ordered JSON events on stdout. Diagnostics go to stderr.

Run a deterministic fixture without an API key:

```bash
printf '%s\n' '{"type":"turn","text":"hello","responses":[{"id":"a1","content":"hello","toolCalls":[],"usage":{"promptTokens":1,"completionTokens":1,"totalTokens":2},"finishReason":"stop"}]}' | pnpm start
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
