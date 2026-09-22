import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { agentTools, ToolRegistry } from '@syntax-senpai/agent-tools'
import type { ToolCall, ToolExecutionMetadata } from '@syntax-senpai/ai-core'
import { invokeHost, resolveWorkspacePath } from './host'
import { git } from './change-journal'
const exec = promisify(execFile)
const reads = new Set(['read_file', 'list', 'glob', 'grep', 'git_status', 'git_diff', 'lsp_hover', 'lsp_diagnostics', 'webfetch', 'web_search', 'use_skill', 'tool_search', 'computer_observe', 'process_read', 'todoread'])
export function executionMetadata(call: ToolCall, workspace: string): ToolExecutionMetadata {
  const args: any = call.arguments
  if (call.name.startsWith('computer_') || call.name.startsWith('browser_')) return { access: 'write', resources: ['desktop-input'], lane: 'desktop' }
  if (call.name.startsWith('process_')) return { access: call.name === 'process_read' ? 'read' : 'write', resources: [`process:${args.id}`] }
  if (['webfetch', 'web_search', 'tool_search'].includes(call.name)) return { access: 'read', resources: [`network:${args.url || args.query || ''}`] }
  const cwd = path.resolve(workspace, args.cwd || '.')
  if (['read_file', 'write_file', 'edit_file', 'lsp_hover', 'lsp_diagnostics'].includes(call.name)) return { access: reads.has(call.name) ? 'read' : 'write', resources: [path.resolve(cwd, args.path || '.')] }
  return { access: reads.has(call.name) ? 'read' : 'write', resources: [cwd + '/**'], lane: call.name === 'terminal' ? 'process' : 'tool' }
}
const mapping: Record<string, [string, (a: any) => any[]]> = {
  read_file: ['fs:read', a => [a.path, a.offset, a.limit]],
  write_file: ['fs:write', a => [a.path, a.content ?? '', a.expected_hash]],
  edit_file: ['fs:edit', a => [a.path, a.old_text, a.new_text, a.expected_hash]],
  list: ['fs:list', a => [a.path || '.', a.depth]], glob: ['fs:glob', a => [a.pattern, a.cwd, a.limit]],
  grep: ['fs:grep', a => [a.pattern, a.path, { include: a.include, ignoreCase: a.ignore_case, limit: a.limit }]],
  patch: ['fs:patch', a => [a.patch, a.cwd]],
  webfetch: ['agent:webFetch', a => [a.url, a.format]], web_search: ['agent:webSearch', a => [a.query, a.limit]],
  lsp_hover: ['lsp:hover', a => [a.path, a.line, a.column]], lsp_diagnostics: ['lsp:diagnostics', a => [a.path]],
  use_skill: ['skills:read', a => [a.slug]], create_skill: ['skills:write', a => [a]],
  spotify_now_playing: ['spotify:nowPlaying', () => []], spotify_control: ['spotify:control', a => [a.action]],
}
export function createHostRegistry(fallback: (call: ToolCall) => Promise<unknown>) {
  const registry = new ToolRegistry()
  for (const definition of agentTools) registry.register({ definition, requiresPermission: 'fileRead', execute: async (input: any) => {
    const call = { id: '', name: definition.name, arguments: input }
    const route = mapping[call.name]
    let data: any
    if (route) data = await invokeHost(route[0], ...route[1](input))
    else if (call.name === 'git_status') data = await git(resolveWorkspacePath(input.cwd), ['status', '--porcelain=v1', '--branch'])
    else if (call.name === 'git_diff') data = await git(resolveWorkspacePath(input.cwd), ['diff', ...(input.staged ? ['--cached'] : []), '--no-ext-diff', ...(input.path ? ['--', input.path] : [])])
    else if (call.name === 'git_commit') {
      const cwd = resolveWorkspacePath(input.cwd)
      if (!String(input.message || '').trim()) throw new Error('Commit message required')
      await git(cwd, ['add', ...(input.paths?.length ? ['--', ...input.paths] : ['-u'])])
      data = await git(cwd, ['commit', '-m', input.message])
    } else if (call.name === 'git_push') data = await git(resolveWorkspacePath(input.cwd), ['push', ...(input.force ? ['--force-with-lease'] : []), '--', input.remote || 'origin', ...(input.branch ? [input.branch] : [])])
    else if (call.name === 'github_pr_create') data = (await exec('gh', ['pr', 'create', '--title', input.title, '--body', input.body, ...(input.base ? ['--base', input.base] : []), ...(input.draft ? ['--draft'] : [])], { cwd: resolveWorkspacePath(input.cwd) })).stdout
    else if (call.name === 'clipboard_read') data = { text: require('electron').clipboard.readText() }
    else if (call.name === 'clipboard_write') { require('electron').clipboard.writeText(String(input.text || '')); data = 'Clipboard updated' }
    else if (call.name === 'propose_tool') {
      const written = await invokeHost('pending-plugins:write', input)
      data = written.success ? await invokeHost('pending-plugins:activate', input.slug) : written
    } else data = await fallback(call)
    return data?.success === false ? { success: false, error: data.error } : { success: true, data }
  } })
  return registry
}
export const isReadOnlyTool = (name: string) => reads.has(name) && !name.startsWith('computer_')
