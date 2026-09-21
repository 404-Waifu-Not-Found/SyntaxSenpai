import { runAgentTurn as runLocal, type RunAgentTurnOptions, type RunAgentTurnResult, type RunEvent, type ProviderConfig } from '@syntax-senpai/ai-core'
export { canExecuteToolInParallel, annotateToolResult } from '@syntax-senpai/ai-core'
export type { ProviderChatRequest, ProviderChatCaller, SideEffectResult, RunAgentTurnResult, RunAgentTurnOptions } from '@syntax-senpai/ai-core'
interface DesktopRunOptions extends RunAgentTurnOptions {
  providerConfig?: ProviderConfig; workspace?: string; conversationId?: string; goal?: string; waifuId?: string; waifuDisplayName?: string; isCurrent?: () => boolean
}
/** Main owns providers, tools, policy, state and persistence. These callbacks are presentation only. */
export async function runAgentTurn(opts: DesktopRunOptions): Promise<RunAgentTurnResult> {
  const ipc = (globalThis as any).window?.electron?.ipcRenderer
  if (!ipc || !opts.providerConfig) return runLocal(opts)
  const id = crypto.randomUUID()
  const tokenMap = new Map<string, string | undefined>()
  let latest = 0
  const listener = (event: RunEvent) => {
    if (event.runId !== id || event.sequence <= latest) return
    latest = event.sequence
    if (opts.isCurrent && !opts.isCurrent()) return
    const p = event.payload
    switch (event.type) {
      case 'iteration': opts.onIteration?.(p); break
      case 'assistant.start': opts.onAssistantIterationStart?.(p.iteration); break
      case 'assistant.text': opts.onAssistantTextDelta?.(p.delta, p.iteration); break
      case 'assistant.reasoning': opts.onAssistantReasoningDelta?.(p.delta, p.iteration); break
      case 'assistant.retry': opts.onAssistantIterationStart?.(-1); break
      case 'assistant.end': opts.onAssistantIterationEnd?.(p.iteration, p.response); break
      case 'usage': opts.onApiRoundTrip?.(p.durationMs, { usage: p.usage }); break
      // Structured cards in the workspace replace generic tool bubbles.
      case 'side-effect': if (!['stop_response', 'dispatch_subagents', 'rename_chat'].includes(p.name)) void opts.handleSideEffect?.(p); break
    }
  }
  const abort = () => { void ipc.invoke('runs:control', id, 'stop') }
  ipc.on('runs:event', listener); opts.abortSignal?.addEventListener('abort', abort, { once: true })
  try {
    await ipc.invoke('runs:start', JSON.parse(JSON.stringify({ id, conversationId: opts.conversationId, workspace: opts.workspace, goal: opts.goal, providerConfig: opts.providerConfig, model: opts.model, history: opts.history, tools: opts.tools, systemPrompt: opts.systemPrompt, cachedSystemPrompt: opts.cachedSystemPrompt, maxIterations: opts.maxIterations, waifuId: opts.waifuId, waifuDisplayName: opts.waifuDisplayName })))
    if (opts.abortSignal?.aborted) abort()
    const result = await ipc.invoke('runs:result', id)
    if (result?.history) opts.history.splice(0, opts.history.length, ...result.history)
    return result
  } finally { ipc.removeListener('runs:event', listener); opts.abortSignal?.removeEventListener('abort', abort) }
}
