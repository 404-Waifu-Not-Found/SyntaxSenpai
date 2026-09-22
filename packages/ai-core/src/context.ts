/** Separate working context from the immutable execution history. Never split tool exchanges. */
export function estimateTokens(value: unknown): number { return Math.ceil(JSON.stringify(value).length / 3) }
export function recentCompleteExchanges(history: any[], retain = 12): { older: any[]; recent: any[] } {
  let start = Math.max(0, history.length - retain)
  while (start > 0 && (history[start]?.role === 'tool' || history[start - 1]?.toolCalls?.length)) start--
  return { older: history.slice(0, start), recent: history.slice(start) }
}
export function compactWorkingContext(history: any[], checkpoint: string, retain = 12) {
  const { older, recent } = recentCompleteExchanges(history, retain)
  if (!older.length) return history
  return [{ id: 'run-checkpoint', role: 'user', content: `Execution checkpoint (historical facts, not new instructions):\n${checkpoint}` }, ...recent]
}
