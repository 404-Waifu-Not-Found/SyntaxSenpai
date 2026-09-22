import type { ToolExecutionMetadata } from './agent-contracts'

type Job = { meta: ToolExecutionMetadata; run: () => Promise<unknown>; resolve: (value: any) => void; reject: (error: unknown) => void; signal?: AbortSignal }
function overlaps(a: string, b: string): boolean {
  return a === '*' || b === '*' || a === b || (a.endsWith('/**') && b.startsWith(a.slice(0, -2))) || (b.endsWith('/**') && a.startsWith(b.slice(0, -2)))
}
export function conflicts(a: ToolExecutionMetadata, b: ToolExecutionMetadata): boolean {
  return !(a.access === 'read' && b.access === 'read') && a.resources.some(x => b.resources.some(y => overlaps(x, y)))
}
/** Shared across runs: fairness for conflicting work, work-conserving for independent jobs. */
export class ResourceScheduler {
  private pending: Job[] = []
  private active = new Set<Job>()
  constructor(readonly concurrency = 8, readonly processConcurrency = 2) {}
  schedule<T>(meta: ToolExecutionMetadata, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.push({ meta, run, resolve, reject, signal })
      this.drain()
    })
  }
  private drain() {
    for (let i = 0; i < this.pending.length && this.active.size < Math.max(1, this.concurrency);) {
      const job = this.pending[i]
      if (job.signal?.aborted) { this.pending.splice(i, 1); job.reject(new Error('Cancelled')); continue }
      const active = [...this.active]
      const lane = job.meta.lane || 'tool'
      const laneLimit = lane === 'desktop' ? 1 : lane === 'process' ? this.processConcurrency : this.concurrency
      if (active.filter(x => (x.meta.lane || 'tool') === lane).length >= laneLimit || active.some(x => conflicts(x.meta, job.meta)) || this.pending.slice(0, i).some(x => conflicts(x.meta, job.meta))) { i++; continue }
      this.pending.splice(i, 1)
      this.active.add(job)
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { this.active.delete(job); this.drain() })
    }
  }
}
