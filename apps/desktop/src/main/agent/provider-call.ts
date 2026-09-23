import { withRetry, type AIProvider, type ProviderChatRequest } from '@syntax-senpai/ai-core'
/** Provider adapters emit complete tool calls. Never execute calls from an incomplete stream. */
export async function callProvider(provider: AIProvider, req: ProviderChatRequest, retry?: (attempt: number) => void): Promise<any> {
  const request = provider.id === 'anthropic' ? req : { ...req, systemPrompt: [req.cachedSystemPrompt, req.systemPrompt].filter(Boolean).join('\n'), cachedSystemPrompt: undefined }
  return withRetry(async () => {
    if (!provider.supportsStreaming) {
      const response = await provider.chat(request as any)
      if (response.content) req.onTextDelta?.(response.content)
      return response
    }
    let content = '', reasoningContent = '', usage: any
    const calls = new Map<string, any>()
    for await (const chunk of provider.stream(request as any)) {
      if (req.signal?.aborted) throw new Error('Cancelled')
      if (chunk.type === 'text_delta') { content += chunk.delta || ''; req.onTextDelta?.(chunk.delta || '') }
      if (chunk.type === 'reasoning_delta') { reasoningContent += chunk.delta || ''; req.onReasoningDelta?.(chunk.delta || '') }
      if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
        const tc = chunk.toolCall
        const id = tc.id && tc.id !== 'unknown' ? tc.id : `call-${calls.size}`
        calls.set(id, { id, name: tc.name, arguments: tc.arguments || {} })
      }
      if (chunk.type === 'done') usage = chunk.usage
      if (chunk.type === 'error') throw new Error(chunk.error || 'Provider stream failed')
    }
    return { id: `response-${Date.now()}`, content, reasoningContent, toolCalls: [...calls.values()], usage, finishReason: calls.size ? 'tool_calls' : 'stop' }
  }, { maxAttempts: 3, signal: req.signal, onRetry: (_error, attempt) => retry?.(attempt) })
}
