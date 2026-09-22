import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
/** Preflight, write a sibling temporary file, then recheck immediately before atomic replacement. */
export async function replaceFile(file: string, expected: string | null, content: string) {
  const current = () => fs.readFile(file, 'utf8').catch((e: any) => { if (e.code === 'ENOENT') return null; throw e })
  if (await current() !== expected) throw new Error('Stale file revision. Read the file again before editing.')
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = path.join(path.dirname(file), '.syntax-edit-' + randomUUID())
  try {
    const mode = await fs.stat(file).then(s => s.mode).catch(() => undefined)
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode })
    if (await current() !== expected) throw new Error('Stale file revision. File changed while preparing the edit.')
    await fs.rename(temporary, file)
  } finally { await fs.unlink(temporary).catch((e: any) => { if (e.code !== 'ENOENT') throw e }) }
}
