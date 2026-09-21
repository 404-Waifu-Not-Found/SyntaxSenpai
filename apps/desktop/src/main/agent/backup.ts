import fs from 'node:fs/promises'
import path from 'node:path'
export interface RunArchive { version: 1; files: Array<{ path: string; data: string }> }
/** Run journals, snapshots, screenshots and process output travel together. */
export async function exportRunArchive(root: string): Promise<RunArchive> {
  const files: RunArchive['files'] = []
  async function walk(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile() && !entry.name.endsWith('.tmp')) files.push({ path: path.relative(root, file).split(path.sep).join('/'), data: (await fs.readFile(file)).toString('base64') })
    }
  }
  await walk(root); return { version: 1, files }
}
export async function importRunArchive(root: string, archive: RunArchive) {
  if (archive?.version !== 1 || !Array.isArray(archive.files)) throw new Error('Unsupported run archive')
  // Validate the entire manifest before any write; never replace live task records.
  const prepared = archive.files.map(entry => {
    if (!entry.path || entry.path.includes('\\') || path.isAbsolute(entry.path) || entry.path.split('/').some(p => p === '..' || p === '.')) throw new Error('Invalid archive path')
    if (typeof entry.data !== 'string') throw new Error('Invalid artifact encoding')
    let bytes = Buffer.from(entry.data, 'base64')
    if (entry.path.endsWith('/run.json')) {
      const state = JSON.parse(bytes.toString('utf8'))
      if (['running', 'paused'].includes(state.status)) { state.status = 'interrupted'; state.finalContent = 'Imported interrupted task. No actions were replayed.'; state.endedAt = Date.now() }
      bytes = Buffer.from(JSON.stringify(state))
    }
    return { file: path.join(root, entry.path), bytes }
  })
  for (const item of prepared) {
    await fs.mkdir(path.dirname(item.file), { recursive: true })
    await fs.writeFile(item.file, item.bytes, { flag: 'wx' }).catch((e: any) => { if (e.code !== 'EEXIST') throw e })
  }
  return { imported: prepared.length }
}
