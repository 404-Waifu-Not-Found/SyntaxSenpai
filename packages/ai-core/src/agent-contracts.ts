import type { ToolCall } from './types'

export interface ExecutionPolicy { version: 2; autoDecideActions: boolean }
export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = { version: 2, autoDecideActions: false }
export function migrateExecutionPolicy(value: unknown): ExecutionPolicy {
  const raw = value as Partial<ExecutionPolicy> | null
  return { version: 2, autoDecideActions: raw?.version === 2 && raw.autoDecideActions === true }
}
export type RunStatus = 'running' | 'paused' | 'verified' | 'incomplete' | 'blocked' | 'interrupted' | 'cancelled'
export interface PlanItem { id: string; text: string; status: 'pending' | 'in_progress' | 'done' }
export interface AgentRun {
  id: string; conversationId?: string; workspace?: string; goal: string; status: RunStatus
  startedAt: number; endedAt?: number; plan: PlanItem[]; acceptanceCriteria: string[]
  checkpoint?: string; iterations: number; maxIterations: number; finalContent?: string
}
export interface ToolExecutionResult {
  callId: string; outcome: 'success' | 'error' | 'blocked' | 'cancelled'
  summary: string; data?: unknown; outputRef?: string; durationMs?: number
}
export interface RunEvent {
  runId: string; sequence: number; timestamp: number; type: string; payload: any
}
export interface FileChange {
  id: string; runId: string; path: string; oldPath?: string
  operation: 'added' | 'modified' | 'deleted' | 'renamed'
  beforeRef: string; afterRef: string; beforeHash: string; afterHash: string
  additions: number | null; deletions: number | null; binary: boolean; large: boolean
  origin: 'agent' | 'external' | 'mixed'; preExisting: boolean; timestamp: number
}
export interface CheckResult {
  id: string; command: string; cwd: string; exitCode: number | null
  outputRef?: string; revision: string; freshness: 'current' | 'stale'; status: 'running' | 'passed' | 'failed' | 'cancelled'
}
export interface ProcessSession {
  id: string; runId?: string; command: string; cwd: string; status: 'queued' | 'running' | 'exited' | 'cancelled' | 'timed_out'
  startedAt: number; endedAt?: number; exitCode: number | null; cursor: number; output: string
}
export interface ComputerObservation {
  id: string; timestamp: number; appId?: string; pid?: number; appName?: string; windowId?: string
  bounds?: { x: number; y: number; width: number; height: number }
  imageWidth?: number; imageHeight?: number; screenshot?: string; screenshotRef?: string
  elements: Array<{ id: string; role: string; label: string; value?: string; bounds?: { x: number; y: number; width: number; height: number } }>
  apps?: Array<{ id: string; name: string; pid: number }>; displays?: unknown[]
}
export interface ComputerActionResult { success: boolean; action: string; observationId?: string; error?: string; observation?: ComputerObservation }
export interface ToolExecutionMetadata {
  access: 'read' | 'write'; resources: string[]; lane?: 'tool' | 'process' | 'desktop'
  retryable?: boolean
}
export type DescribeToolExecution = (call: ToolCall) => ToolExecutionMetadata
