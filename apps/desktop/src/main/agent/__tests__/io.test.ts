import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ProcessManager } from '../process-manager'
import { ChangeJournal, git, lineCounts } from '../change-journal'
const dirs: string[] = []
const managers: ProcessManager[] = []
function manager(root: string, concurrency = 2) { const pm = new ProcessManager(root, concurrency); managers.push(pm); return pm }
async function temp() { const p=await mkdtemp(path.join(os.tmpdir(),'syntax-test-')); dirs.push(p); return p }
afterEach(async () => { for(const pm of managers.splice(0)) { pm.stopRun(); for(const s of pm.list()) { while(!pm.read(s.id).endedAt) await new Promise(r=>setTimeout(r,20)) } }; await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true}))) })
describe('command sessions', () => {
  it('streams output, accepts stdin and retains an exit result', async () => {
    const root=await temp(), pm=manager(root); const chunks: string[]=[]; pm.on('output',e=>chunks.push(e.chunk))
    const s=pm.start('printf ready; read value; printf "-%s" "$value"',root)
    await expect.poll(() => pm.read(s.id).output, { timeout: 3000 }).toContain('ready')
    pm.write(s.id,'unicode-你好\n'); await pm.wait(s.id,2000)
    expect(pm.read(s.id).output).toContain('unicode-你好'); expect(pm.read(s.id).exitCode).toBe(0); expect(chunks.length).toBeGreaterThan(1)
  })
  it('returns a running handle and stops a process group', async () => {
    const root=await temp(), pm=manager(root)
    const s=pm.start('sleep 60 & wait',root,undefined,0)
    expect((await pm.wait(s.id,30)).status).toBe('running'); pm.stop(s.id)
    await new Promise(r=>setTimeout(r,100)); expect(pm.read(s.id).status).toBe('cancelled')
  })
  it('applies each queued session timeout separately', async () => {
    const root=await temp(), pm=manager(root,1)
    const a=pm.start('sleep .1',root,undefined,1000), b=pm.start('sleep 3',root,undefined,50)
    await pm.wait(a.id,1000); await new Promise(r=>setTimeout(r,200)); expect(pm.read(b.id).status).toBe('timed_out'); pm.stopRun()
  })
  it('does not spawn an action when its start-time policy fails', async () => {
    const root=await temp(), pm=manager(root)
    const s=pm.start('touch forbidden',root,undefined,1000,async()=>{throw Error('BLOCKED reviewer failed')})
    await pm.wait(s.id,500); expect(pm.read(s.id).exitCode).toBe(126); expect(pm.read(s.id).output).toContain('BLOCKED')
    await expect(readFile(path.join(root,'forbidden'))).rejects.toThrow()
  })
})
describe('real change counts', () => {
  it('counts CRLF and repeated edits against task baseline and HEAD', async () => {
    const root=await temp(), artifacts=await temp(); await git(root,['init']); await writeFile(path.join(root,'a.ts'),'one\r\ntwo\r\n'); await git(root,['add','.']); await git(root,['-c','user.name=Test','-c','user.email=test@local','commit','-m','base'])
    await writeFile(path.join(root,'a.ts'),'dirty\r\ntwo\r\n')
    const journal=new ChangeJournal(artifacts,'run',root,()=>{}); await journal.begin()
    const f=path.join(root,'a.ts')
    for(const text of ['dirty\r\nthree\r\n','dirty\r\nfour\r\n']) { await journal.before([f]); await writeFile(f,text); await journal.after([f]) }
    expect(journal.changes.get(f)).toMatchObject({additions:1,deletions:1,preExisting:true,origin:'agent'})
    expect((await journal.workingTree())[0]).toMatchObject({additions:2,deletions:2})
    await git(root,['add','.']); await git(root,['-c','user.name=Test','-c','user.email=test@local','commit','-m','new'])
    expect(await journal.workingTree()).toEqual([]); expect(journal.changes.size).toBe(1)
  })
  it('tracks outside edits, Unicode paths, deletion, rename, and binary changes honestly', async () => {
    const root=await temp(), artifacts=await temp(); await git(root,['init']); const f=path.join(root,'你好.txt'); await writeFile(f,'hello\n'); await git(root,['add','.']); await git(root,['-c','user.name=Test','-c','user.email=test@local','commit','-m','base'])
    const j=new ChangeJournal(artifacts,'run',root,()=>{}); await j.begin(); await rename(f,path.join(root,'renamed.txt')); await git(root,['add','-A']); await writeFile(path.join(root,'image.bin'),Buffer.from([0,1,2])); await j.scan()
    expect(j.changes.get(f)?.operation).toBe('deleted'); const working=await j.workingTree(); expect(working.some(c=>c.operation==='renamed')).toBe(true); expect(working.find(c=>c.binary)?.additions).toBe(null)
  })
  it('does not invent edits for identical content', async () => { expect(await lineCounts('a\n','a\n')).toEqual({additions:0,deletions:0}) })
})
