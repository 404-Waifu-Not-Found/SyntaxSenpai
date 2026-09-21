import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
export interface HostContext {
  runId: string; workspace: string; readHashes: Map<string, string>; signal?: AbortSignal
  beforeWrite?: (paths: string[]) => Promise<void>; afterWrite?: (paths: string[]) => Promise<void>
}
export const hostContext = new AsyncLocalStorage<HostContext>()
const handlers = new Map<string, (...args: any[]) => any>()
export function registerHostHandler(channel: string, handler: (...args: any[]) => any) {
  handlers.set(channel, handler)
  require('electron').ipcMain.handle(channel, handler)
}
export async function invokeHost(channel: string, ...args: any[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Host handler unavailable: ${channel}`)
  return handler({ sender: undefined }, ...args)
}
export function resolveWorkspacePath(raw = '.') {
  const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw
  const resolved = path.resolve(hostContext.getStore()?.workspace || process.cwd(), expanded)
  try { return fs.realpathSync(resolved) } catch { try { return path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved)) } catch { return resolved } }
}
