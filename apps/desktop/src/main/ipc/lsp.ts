/**
 * LSP IPC — exposes language-server diagnostics & hover to the renderer agent.
 *
 * Handlers:
 *  - lsp:diagnostics  errors/warnings for a file, from a real language server
 *  - lsp:hover        type / signature / docs at a position
 *
 * The heavy lifting (server spawn, JSON-RPC, session pool) lives in
 * ../lsp/lsp-client. This module only adapts results into IPC-friendly shapes
 * and wires server shutdown to app quit.
 */

const { ipcMain, app } = require('electron')
import { lspDiagnostics, lspHover, shutdownAllLsp } from '../lsp/lsp-client'

let registered = false

const SEVERITY: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }

/** Flatten an LSP Hover result's `contents` (string | MarkupContent | array). */
function normalizeHoverContents(contents: any): string {
  if (contents == null) return ''
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(normalizeHoverContents).filter(Boolean).join('\n\n')
  if (typeof contents === 'object') {
    if (typeof contents.value === 'string') return contents.value
    if (typeof contents.language === 'string') return contents.value || ''
  }
  return ''
}

export function registerLspIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('lsp:diagnostics', async (_e: any, filePath: string) => {
    try {
      const { diagnostics, root } = await lspDiagnostics(String(filePath || ''))
      const items = diagnostics
        .map((d: any) => ({
          severity: SEVERITY[d?.severity] || 'info',
          line: (d?.range?.start?.line ?? 0) + 1,
          character: (d?.range?.start?.character ?? 0) + 1,
          endLine: (d?.range?.end?.line ?? 0) + 1,
          message: String(d?.message ?? '').trim(),
          source: d?.source ? String(d.source) : undefined,
          code: d?.code !== undefined && d?.code !== null ? String(d.code) : undefined,
        }))
        .sort((a: any, b: any) => a.line - b.line || a.character - b.character)
      return { success: true, root, count: items.length, diagnostics: items }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('lsp:hover', async (_e: any, filePath: string, line: number, character: number) => {
    try {
      // The renderer passes 1-based line/column (matching read_file); LSP is 0-based.
      const lspLine = Math.max(0, (Number(line) || 1) - 1)
      const lspChar = Math.max(0, (Number(character) || 1) - 1)
      const result = await lspHover(String(filePath || ''), lspLine, lspChar)
      if (!result) {
        return { success: true, found: false, contents: '' }
      }
      const contents = normalizeHoverContents(result.contents).trim()
      const range = result.range
        ? {
            startLine: (result.range.start?.line ?? 0) + 1,
            endLine: (result.range.end?.line ?? 0) + 1,
          }
        : undefined
      return { success: true, found: !!contents, contents, range }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  // Language servers are child processes — make sure they don't outlive the app.
  app.on('will-quit', () => {
    try {
      shutdownAllLsp()
    } catch {
      /* ignore */
    }
  })
}

module.exports = { registerLspIpc }

export {}
