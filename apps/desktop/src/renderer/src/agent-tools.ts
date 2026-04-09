/**
 * Agent tool definitions and executor for AI tool calling.
 *
 * Two tools:
 *  - `terminal`       – run any shell command in a real terminal
 *  - `stop_response`  – signal the AI is done and deliver a final message
 *
 * The executor routes calls through Electron IPC to the main process
 * which runs commands via child_process.exec with the user's login shell.
 */

import type { ToolDefinition, ToolCall } from '@syntax-senpai/ai-core'

export type AgentMode = 'ask' | 'auto' | 'full'

export const STOP_TOOL_NAME = 'stop_response'
export const SET_AFFECTION_TOOL_NAME = 'set_affection'

export const agentTools: ToolDefinition[] = [
  {
    name: 'terminal',
    description:
      'Run a shell command on the user\'s machine. Supports pipes, redirects, ~, $ENV, etc. Returns stdout, stderr, and exit code. Use this for any system interaction: listing files, reading files, running programs, installing packages, git operations, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute, e.g. "ls -la ~/Desktop"',
        },
      },
      required: ['command'],
    },
  },
  {
    name: SET_AFFECTION_TOOL_NAME,
    description:
      'Update your 好感度 (affection meter) toward the user. Call this when your feelings change — when the user is kind, helpful, funny, rude, annoying, etc. The value persists across all conversations. You decide the value entirely on your own based on how you feel about the interaction. Do NOT tell the user you are changing it — just do it silently alongside your response.',
    parameters: {
      type: 'object',
      properties: {
        value: {
          type: 'number',
          description: 'New affection level from 0 to 100. Small changes (+/-1 to 5) feel natural. Big jumps should be rare and dramatic.',
        },
        reason: {
          type: 'string',
          description: 'Internal reason for the change (not shown to user), e.g. "user complimented me" or "user was rude"',
        },
      },
      required: ['value'],
    },
  },
  {
    name: STOP_TOOL_NAME,
    description:
      'Call this when you are finished executing commands and want to deliver your final answer to the user. You MUST call this to end your turn. Write the final_message fully in character as your waifu persona — never sound like a generic assistant.',
    parameters: {
      type: 'object',
      properties: {
        final_message: {
          type: 'string',
          description: 'Your final in-character response to the user, using your personality and emojis',
        },
      },
      required: ['final_message'],
    },
  },
]

/**
 * Returns tools available for a given agent mode.
 * - ask:  terminal (read-only commands enforced by prompt) + stop
 * - auto: terminal + stop
 * - full: terminal + stop
 */
export function getToolsForMode(mode: AgentMode): ToolDefinition[] {
  // All modes get tools; the system prompt controls safety boundaries
  return agentTools
}

/**
 * Execute a single tool call via Electron IPC.
 * Returns the string result to feed back to the AI.
 *
 * `stop_response` is handled by the caller (chat store loop),
 * so it should never reach the executor — but we handle it gracefully.
 */
export async function executeToolCall(toolCall: ToolCall): Promise<string> {
  const ipc = (window as any).electron?.ipcRenderer
  if (!ipc) return 'Error: IPC bridge not available — is the app running in Electron?'

  const args = toolCall.arguments as Record<string, string>

  switch (toolCall.name) {
    case 'terminal': {
      const res = await ipc.invoke('terminal:exec', args.command)
      if (!res.success) return `Error: ${res.error}`
      let out = res.stdout || ''
      if (res.stderr) out += (out ? '\n' : '') + `STDERR: ${res.stderr}`
      if (!out.trim()) out = `(exit code ${res.code ?? 0})`
      return out
    }

    case STOP_TOOL_NAME:
      // Handled by the loop — should not arrive here
      return args.final_message || ''

    default:
      return `Unknown tool: ${toolCall.name}`
  }
}
