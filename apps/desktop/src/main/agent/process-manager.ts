import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { setTimeout as schedule } from 'node:timers'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ProcessSession } from '@syntax-senpai/ai-core'

export class ProcessManager extends EventEmitter {
  private sessions = new Map<string, ProcessSession & { child?: ChildProcess; timer?: ReturnType<typeof setTimeout>; parts: string[]; timeoutMs: number; authorize?: () => Promise<void> }>()
  constructor(private directory: string, private concurrency = 2) { super(); fs.mkdirSync(directory, { recursive: true }) }
  start(command: string, cwd: string, runId?: string, timeoutMs = 600_000, authorize?: () => Promise<void>): ProcessSession {
    const id = randomUUID()
    const session = { id, runId, command, cwd, status: 'queued' as ProcessSession['status'], startedAt: Date.now(), exitCode: null, cursor: 0, output: '', parts: [], timeoutMs, authorize }
    this.sessions.set(id, session)
    this.emit('update', this.read(id))
    void this.pump()
    return this.read(id)
  }
  private async pump() {
    const active = [...this.sessions.values()].filter(s => s.status === 'running').length
    let free = this.concurrency - active
    for (const s of this.sessions.values()) {
      if ([...this.sessions.values()].filter(x => !x.endedAt && (x.status === 'running' || !!x.child)).length >= this.concurrency) break
      if (s.status !== 'queued') continue
      free--; s.status = 'running'
      try {
        await s.authorize?.()
        if (s.status !== 'running') continue
        const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/sh'
        const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-Command', s.command] : ['-lc', s.command]
        const child = spawn(shell, args, { cwd: s.cwd, stdio: 'pipe', detached: process.platform !== 'win32', windowsHide: true })
        s.child = child
        const append = (chunk: Buffer | string) => {
          const value = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
          s.parts.push(value); s.cursor += value.length
          // Durable full output, bounded live tail.
          try { fs.appendFileSync(path.join(this.directory, s.id + '.log'), value) } catch (error) { this.emit('warning', { id: s.id, error: String(error) }); this.stop(s.id) }
          s.output = (s.output + value).slice(-64_000)
          if (s.parts.length > 2000) s.parts = [s.output]
          this.emit('output', { id: s.id, runId: s.runId, chunk: value, cursor: s.cursor })
        }
        child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8')
        child.stdout?.on('data', append); child.stderr?.on('data', append)
        child.on('error', error => { append(Buffer.from(error.message)); this.finish(s.id, 1) })
        child.on('close', code => this.finish(s.id, code))
        if (s.timeoutMs > 0) s.timer = setTimeout(() => this.stop(s.id, 'timed_out'), s.timeoutMs)
        this.emit('update', this.read(s.id))
      } catch (error) { s.output = String(error); this.finish(s.id, 126) }
    }
  }
  private finish(id: string, code: number | null) {
    const s = this.sessions.get(id); if (!s || s.endedAt) return
    if (s.timer) clearTimeout(s.timer)
    if (s.status === 'running' || s.status === 'queued') s.status = 'exited'
    s.exitCode = code; s.endedAt = Date.now()
    this.emit('update', this.read(id)); void this.pump()
  }
  read(id: string, cursor?: number, maxChars = 12_000): ProcessSession {
    const s = this.sessions.get(id); if (!s) throw new Error('Unknown process session')
    let output = s.output
    if (cursor !== undefined) {
      const tailStart = s.cursor - s.output.length
      output = s.output.slice(Math.max(0, cursor - tailStart))
      if (cursor < tailStart) output = '[Earlier output is in the full log.]\n' + output
    }
    return { id: s.id, runId: s.runId, command: s.command, cwd: s.cwd, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, exitCode: s.exitCode, cursor: s.cursor, output: output.slice(-maxChars) }
  }
  list(runId?: string) { return [...this.sessions.keys()].map(id => this.read(id)).filter(s => !runId || s.runId === runId) }
  write(id: string, text: string) { const s = this.sessions.get(id); if (!s?.child?.stdin || s.status !== 'running') throw new Error('Process is not running'); s.child.stdin.write(text); return this.read(id) }
  stop(id: string, status: 'cancelled' | 'timed_out' = 'cancelled') {
    const s = this.sessions.get(id); if (!s || s.endedAt) return
    s.status = status
    if (s.child?.pid) {
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(s.child.pid), '/T', '/F'], { windowsHide: true })
        else process.kill(-s.child.pid, 'SIGTERM')
      } catch { /* already exited */ }
      const pid = s.child.pid
      const killTimer = schedule(() => { try { if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL') } catch {} }, 1500)
      const unref = (killTimer as unknown as { unref?: () => void }).unref
      if (unref) unref.call(killTimer)
    }
    if (!s.child) this.finish(id, null)
  }
  stopRun(runId?: string) { for (const s of this.sessions.values()) if (!runId || s.runId === runId) this.stop(s.id) }
  async wait(id: string, ms = 1000) {
    if (['queued', 'running'].includes(this.read(id).status)) await new Promise<void>(resolve => {
      const timer = setTimeout(done, Math.max(0, Math.min(ms, 10_000)))
      const listener = (s: ProcessSession) => { if (s.id === id && !['queued', 'running'].includes(s.status)) done() }
      const self = this
      function done() { clearTimeout(timer); self.off('update', listener); resolve() }
      this.on('update', listener)
    })
    return this.read(id)
  }
}
