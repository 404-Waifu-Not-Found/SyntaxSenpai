import { migrateExecutionPolicy, type ExecutionPolicy, type ToolCall } from '@syntax-senpai/ai-core'
import fs from 'node:fs'
import path from 'node:path'
let policy: ExecutionPolicy | undefined
let policyRevision = 0
let reviewer: ((call: ToolCall, goal: string) => Promise<{ approved: boolean; reason: string }>) | undefined
function file() { return path.join(require('electron').app.getPath('userData'), 'execution-policy.json') }
export function getExecutionPolicy(): ExecutionPolicy {
  if (!policy) {
    try { policy = migrateExecutionPolicy(JSON.parse(fs.readFileSync(file(), 'utf8'))) } catch { policy = migrateExecutionPolicy(null) }
  }
  return { ...policy }
}
export function setExecutionPolicy(value: unknown) {
  policyRevision++
  policy = migrateExecutionPolicy(value)
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file() + '.tmp', JSON.stringify(policy))
  fs.renameSync(file() + '.tmp', file())
  return getExecutionPolicy()
}
export function setBackgroundReviewer(fn: typeof reviewer) { reviewer = fn }
export async function decideAction(call: ToolCall, goal: string, review = reviewer) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const revision = policyRevision
    if (!getExecutionPolicy().autoDecideActions) return { approved: true, reason: 'Direct execution' }
    if (!review) return { approved: false, reason: 'Auto decide has no active reviewer for this action.' }
    let decision: { approved: boolean; reason: string }
    try {
      decision = await review(call, goal)
      if (typeof decision?.approved !== 'boolean' || typeof decision.reason !== 'string') throw new Error('Invalid reviewer response')
    } catch (e) { decision = { approved: false, reason: `Auto decide failed: ${e instanceof Error ? e.message : String(e)}` } }
    if (revision === policyRevision) return decision
  }
  return { approved: false, reason: 'Execution policy kept changing before this action could start.' }
}

export function registerPolicyIpc() {
  const { ipcMain } = require('electron')
  if (!fs.existsSync(file())) setExecutionPolicy(null)
  ipcMain.handle('policy:get', () => getExecutionPolicy())
  ipcMain.handle('policy:set', (_e: unknown, value: unknown) => setExecutionPolicy(value))
}
