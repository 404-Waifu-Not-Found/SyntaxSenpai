import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Worker } from 'node:worker_threads'
import type { FileChange } from '@syntax-senpai/ai-core'
const exec = promisify(execFile)
const MAX_TEXT = 2 * 1024 * 1024
export const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
type Snapshot = { ref: string; hash: string; exists: boolean; binary: boolean; large: boolean }
export async function git(cwd: string, args: string[]) {
  return (await exec('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).stdout
}
export async function lineCounts(before: string, after: string): Promise<{ additions: number; deletions: number }> {
  if (before === after) return { additions: 0, deletions: 0 }
  // Diff CPU work is isolated from Electron's main event loop.
  return new Promise((resolve, reject) => {
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads'); const {diffLines}=require(workerData.module); try { const changes=diffLines(workerData.before,workerData.after,{timeout:2000}); if(!changes) throw Error('Diff exceeds preview budget'); parentPort.postMessage({additions:changes.filter(x=>x.added).reduce((n,x)=>n+x.count,0),deletions:changes.filter(x=>x.removed).reduce((n,x)=>n+x.count,0)}); } catch(e) { parentPort.postMessage({error:e.message}); }`, { eval: true, workerData: { before, after, module: require.resolve('diff') } })
    worker.once('message', value => { void worker.terminate(); value.error ? reject(new Error(value.error)) : resolve(value) })
    worker.once('error', reject)
  })
}
export class ChangeJournal {
  readonly changes = new Map<string, FileChange>()
  private baseline = new Map<string, Snapshot>()
  private last = new Map<string, Snapshot>()
  private pending = new Map<string, Snapshot>()
  private cache = new Map<string, { stamp: string; snapshot: Snapshot }>()
  private dirty = new Set<string>()
  private busy = false
  constructor(readonly root: string, readonly runId: string, readonly workspace: string, private emit: (type: string, value: unknown) => void) {}
  private blobDir() { return path.join(this.root, 'blobs') }
  async put(data: Buffer | string) {
    const hash = digest(data); await fs.mkdir(this.blobDir(), { recursive: true })
    await fs.writeFile(path.join(this.blobDir(), hash), data, { flag: 'wx' }).catch((e: any) => { if (e.code !== 'EEXIST') throw e })
    return hash
  }
  async read(ref: string) {
    if (!/^[a-f0-9]{64}$/.test(ref)) return ''
    return fs.readFile(path.join(this.blobDir(), ref), 'utf8').catch(() => '')
  }
  private async snapshot(file: string): Promise<Snapshot> {
    const stat = await fs.stat(file).catch(() => null)
    if (!stat || !stat.isFile()) return { ref: await this.put(''), hash: digest(''), exists: false, binary: false, large: false }
    const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
    const cached = this.cache.get(file); if (cached?.stamp === stamp) return cached.snapshot
    if (stat.size > MAX_TEXT) {
      // Do not fabricate line counts or store giant artifacts.
      const hasher = createHash('sha256'); for await (const chunk of createReadStream(file)) hasher.update(chunk)
      const snapshot = { ref: '', hash: hasher.digest('hex'), exists: true, binary: false, large: true }
      this.cache.set(file, { stamp, snapshot }); return snapshot
    }
    const bytes = await fs.readFile(file)
    const hash = await this.put(bytes)
    const snapshot = { ref: hash, hash, exists: true, binary: bytes.includes(0), large: false }
    this.cache.set(file, { stamp, snapshot }); return snapshot
  }
  private async paths() {
    try { return [...new Set((await git(this.workspace, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean))].map(p => path.resolve(this.workspace, p)) }
    catch { return [...new Set([...this.baseline.keys(), ...this.last.keys()])] }
  }
  async begin() {
    try {
      const entries = (await git(this.workspace, ['status', '--porcelain=v1', '-z'])).split('\0')
      for (let i = 0; i < entries.length; i++) if (entries[i]) {
        this.dirty.add(path.resolve(this.workspace, entries[i].slice(3)))
        if (/^[RC]|^.[RC]/.test(entries[i])) i++
      }
    } catch {}
    for (const file of await this.paths()) {
      const snap = await this.snapshot(file); this.baseline.set(file, snap); this.last.set(file, snap)
    }
    await this.persist()
  }
  async before(paths: string[]) {
    for (const file of paths) {
      const before = await this.snapshot(file)
      if (!this.baseline.has(file)) this.baseline.set(file, before)
      if (this.last.get(file)?.hash !== before.hash && this.last.has(file)) await this.record(file, before, 'external')
      this.pending.set(file, before)
    }
  }
  async after(paths: string[]) {
    for (const file of paths) {
      const after = await this.snapshot(file)
      const before = this.pending.get(file)
      if (before && (before.hash !== after.hash || before.exists !== after.exists)) {
        const counts = await this.count(before, after)
        this.emit('file.edit', { path: file, ...counts, beforeRef: before.ref, afterRef: after.ref })
      }
      await this.record(file, after, 'agent'); this.pending.delete(file)
    }
  }
  private async count(a: Snapshot, b: Snapshot) {
    if (a.binary || b.binary || a.large || b.large) return { additions: null, deletions: null }
    try { return await lineCounts(await this.read(a.ref), await this.read(b.ref)) } catch { return { additions: null, deletions: null } }
  }
  private async record(file: string, after: Snapshot, origin: FileChange['origin']) {
    const before = this.baseline.get(file) || { ref: await this.put(''), hash: digest(''), exists: false, binary: false, large: false }
    this.baseline.set(file, before)
    this.last.set(file, after)
    if (before.hash === after.hash && before.exists === after.exists) { this.changes.delete(file); await this.persist(); this.emit('changes', [...this.changes.values()]); return }
    const previous = this.changes.get(file)
    const change: FileChange = { id: previous?.id || randomUUID(), runId: this.runId, path: file,
      operation: !before.exists ? 'added' : !after.exists ? 'deleted' : 'modified', beforeRef: before.ref, afterRef: after.ref,
      beforeHash: before.hash, afterHash: after.hash, ...await this.count(before, after), binary: before.binary || after.binary, large: before.large || after.large,
      origin: previous && previous.origin !== origin ? 'mixed' : origin, preExisting: this.dirty.has(file), timestamp: Date.now() }
    this.changes.set(file, change); await this.persist(); this.emit('changes', [...this.changes.values()])
  }
  async scan(origin: FileChange['origin'] = 'external') {
    if (this.busy) return
    this.busy = true
    try {
      const paths = new Set([...await this.paths(), ...this.last.keys()])
      for (const file of paths) {
        if (this.pending.has(file)) continue
        const snap = await this.snapshot(file), last = this.last.get(file)
        if (!last || last.hash !== snap.hash || last.exists !== snap.exists) await this.record(file, snap, origin)
      }
    } finally { this.busy = false }
  }
  revision() { return digest(JSON.stringify([...this.last].map(([p, s]) => [p, s.hash]).sort())) }
  async persist() {
    const dir = path.join(this.root, this.runId); await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'changes.json'), JSON.stringify([...this.changes.values()]))
    await fs.writeFile(path.join(dir, 'baseline.json'), JSON.stringify([...this.baseline]))
  }
  async workingTree(): Promise<FileChange[]> {
    const result: FileChange[] = []
    let entries: string[]
    try { entries = (await git(this.workspace, ['status', '--porcelain=v1', '-z'])).split('\0') } catch { return [...this.changes.values()] }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]; if (!entry) continue
      const relative = entry.slice(3), file = path.resolve(this.workspace, relative)
      const oldPath = /^[RC]|^.[RC]/.test(entry) ? entries[++i] : undefined
      let original = ''
      try { original = await git(this.workspace, ['show', `HEAD:${oldPath || relative}`]) } catch {}
      const before = { ref: await this.put(original), hash: digest(original), exists: !entry.startsWith('??') && !/^A|^.A/.test(entry), binary: original.includes('\0'), large: original.length > MAX_TEXT }
      const after = await this.snapshot(file)
      result.push({ id: file, runId: this.runId, path: file, oldPath, operation: oldPath ? 'renamed' : !before.exists ? 'added' : !after.exists ? 'deleted' : 'modified', beforeRef: before.ref, afterRef: after.ref, beforeHash: before.hash, afterHash: after.hash, ...await this.count(before, after), binary: before.binary || after.binary, large: before.large || after.large, origin: this.changes.get(file)?.origin || 'external', preExisting: this.dirty.has(file), timestamp: Date.now() })
    }
    return result
  }
}
