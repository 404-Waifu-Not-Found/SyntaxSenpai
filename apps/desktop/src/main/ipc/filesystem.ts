import { replaceFile } from '../agent/file-write'
import { createHash } from 'node:crypto'
import { registerHostHandler, resolveWorkspacePath, hostContext } from '../agent/host'
/**
 * Filesystem IPC – exposes precise file read/write/edit to the renderer agent
 * so the model doesn't have to use heredocs or sed through the terminal tool.
 *
 * All paths are resolved and `~` is expanded. No sandboxing beyond that — the
 * agent already runs arbitrary shell commands, so file I/O is in the same
 * trust domain.
 */

const { ipcMain } = require('electron')
const os = require('os')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises

let registered = false

const hash = (content: string) => createHash('sha256').update(content).digest('hex')
const resolvePath = resolveWorkspacePath
async function checkRevision(full: string, expected?: string) {
  const actual = await fsp.readFile(full, 'utf8').catch((e: any) => { if (e.code === 'ENOENT') return ''; throw e })
  const known = expected || hostContext.getStore()?.readHashes.get(full)
  if (!known && hostContext.getStore() && fs.existsSync(full)) throw new Error('Read the existing file before writing, or provide expected_hash.')
  if (known && known !== hash(actual)) throw new Error('Stale file revision. Read the file again before editing.')
  return actual
}

export function registerFilesystemIpc() {
  if (registered) return
  registered = true

  registerHostHandler(
    'fs:read',
    async (_event: any, rawPath: string, offset?: number, limit?: number) => {
      try {
        const full = resolvePath(rawPath)
        const stat = await fsp.stat(full)
        if (stat.isDirectory()) {
          return { success: false, error: `${full} is a directory, not a file` }
        }
        const content = await fsp.readFile(full, 'utf8')
        const revision = hash(content)
        hostContext.getStore()?.readHashes.set(full, revision)
        const lines = content.split('\n')
        const totalLines = lines.length
        const startIdx = Math.max(0, (offset ?? 0) - 1)
        const endIdx = typeof limit === 'number' && limit > 0
          ? Math.min(totalLines, startIdx + limit)
          : Math.min(totalLines, startIdx + 250)
        const slice = lines.slice(startIdx, endIdx)
        return {
          success: true,
          path: full,
          totalLines,
          hash: revision,
          startLine: startIdx + 1,
          endLine: endIdx,
          content: slice.map((line: string, i: number) => `${String(startIdx + i + 1).padStart(5, ' ')}→${line}`).join('\n'),
        }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    },
  )

  registerHostHandler(
    'fs:write',
    async (_event: any, rawPath: string, content: string, expected?: string) => {
      try {
        const full = resolvePath(rawPath)
        const original = await checkRevision(full, expected)
        await hostContext.getStore()?.beforeWrite?.([full])
        await fsp.mkdir(path.dirname(full), { recursive: true })
        await replaceFile(full, fs.existsSync(full) ? original : null, content)
        hostContext.getStore()?.readHashes.set(full, hash(content))
        await hostContext.getStore()?.afterWrite?.([full])
        const stat = await fsp.stat(full)
        return {
          success: true,
          path: full,
          bytes: stat.size,
          lines: content.split('\n').length,
        }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    },
  )

  registerHostHandler(
    'fs:edit',
    async (_event: any, rawPath: string, oldText: string, newText: string, expected?: string) => {
      try {
        if (typeof oldText !== 'string' || oldText.length === 0) {
          return { success: false, error: 'old_text must be a non-empty string' }
        }
        const full = resolvePath(rawPath)
        const original = await checkRevision(full, expected)
        const firstIdx = original.indexOf(oldText)
        if (firstIdx === -1) {
          return {
            success: false,
            error: `old_text not found in ${full}. Read the file first and copy the exact substring (including whitespace).`,
          }
        }
        const nextIdx = original.indexOf(oldText, firstIdx + oldText.length)
        if (nextIdx !== -1) {
          return {
            success: false,
            error: `old_text matches multiple locations in ${full}. Expand old_text with surrounding context until it is unique.`,
          }
        }
        const updated = original.slice(0, firstIdx) + newText + original.slice(firstIdx + oldText.length)
        await hostContext.getStore()?.beforeWrite?.([full])
        await replaceFile(full, original, updated)
        hostContext.getStore()?.readHashes.set(full, hash(updated))
        await hostContext.getStore()?.afterWrite?.([full])
        return {
          success: true,
          path: full,
          replacedAt: firstIdx,
          delta: newText.length - oldText.length,
        }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    },
  )
}

module.exports = { registerFilesystemIpc }

export {}
