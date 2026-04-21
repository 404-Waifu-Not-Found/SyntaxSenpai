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

function resolvePath(p: string): string {
  if (!p) throw new Error('Path is required')
  let resolved = p
  if (resolved.startsWith('~')) {
    resolved = path.join(os.homedir(), resolved.slice(1))
  }
  return path.resolve(resolved)
}

export function registerFilesystemIpc() {
  if (registered) return
  registered = true

  ipcMain.handle(
    'fs:read',
    async (_event: any, rawPath: string, offset?: number, limit?: number) => {
      try {
        const full = resolvePath(rawPath)
        const stat = await fsp.stat(full)
        if (stat.isDirectory()) {
          return { success: false, error: `${full} is a directory, not a file` }
        }
        const content = await fsp.readFile(full, 'utf8')
        const lines = content.split('\n')
        const totalLines = lines.length
        const startIdx = Math.max(0, (offset ?? 0) - 1)
        const endIdx = typeof limit === 'number' && limit > 0
          ? Math.min(totalLines, startIdx + limit)
          : totalLines
        const slice = lines.slice(startIdx, endIdx)
        return {
          success: true,
          path: full,
          totalLines,
          startLine: startIdx + 1,
          endLine: endIdx,
          content: slice.map((line: string, i: number) => `${String(startIdx + i + 1).padStart(5, ' ')}→${line}`).join('\n'),
        }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
      }
    },
  )

  ipcMain.handle(
    'fs:write',
    async (_event: any, rawPath: string, content: string) => {
      try {
        const full = resolvePath(rawPath)
        await fsp.mkdir(path.dirname(full), { recursive: true })
        await fsp.writeFile(full, content, 'utf8')
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

  ipcMain.handle(
    'fs:edit',
    async (_event: any, rawPath: string, oldText: string, newText: string) => {
      try {
        if (typeof oldText !== 'string' || oldText.length === 0) {
          return { success: false, error: 'old_text must be a non-empty string' }
        }
        const full = resolvePath(rawPath)
        const original = await fsp.readFile(full, 'utf8')
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
        await fsp.writeFile(full, updated, 'utf8')
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
