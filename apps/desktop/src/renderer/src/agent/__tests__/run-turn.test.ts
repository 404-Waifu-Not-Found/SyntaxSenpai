import { describe, expect, it } from 'vitest'
import type { ToolCall } from '@syntax-senpai/ai-core'
import { canExecuteToolInParallel, runAgentTurn } from '../run-turn'

function toolCall(id: string, name = 'terminal'): ToolCall {
  return { id, name, arguments: { command: id } }
}

describe('runAgentTurn parallel tool execution', () => {
  it('runs independent terminal calls concurrently and preserves result order', async () => {
    const history: any[] = []
    let active = 0
    let peak = 0
    let providerCalls = 0

    const result = await runAgentTurn({
      callProvider: async () => {
        providerCalls += 1
        return providerCalls === 1
          ? { id: 'assistant-1', content: '', toolCalls: [toolCall('slow'), toolCall('fast')] }
          : { id: 'assistant-2', content: 'done', toolCalls: [] }
      },
      model: 'test',
      history,
      tools: [],
      systemPrompt: '',
      maxIterations: 2,
      executeTool: async (tc) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, tc.id === 'slow' ? 30 : 5))
        active -= 1
        return `result-${tc.id}`
      },
    })

    expect(peak).toBe(2)
    expect(result.finalContent).toBe('done')
    expect(history.filter((message) => message.role === 'tool').map((message) => message.toolCallId))
      .toEqual(['slow', 'fast'])
  })

  it('respects the parallelism cap', async () => {
    let active = 0
    let peak = 0
    let providerCalls = 0

    await runAgentTurn({
      callProvider: async () => {
        providerCalls += 1
        return providerCalls === 1
          ? { id: 'assistant-1', content: '', toolCalls: ['a', 'b', 'c', 'd'].map((id) => toolCall(id)) }
          : { id: 'assistant-2', content: 'done', toolCalls: [] }
      },
      model: 'test',
      history: [],
      tools: [],
      systemPrompt: '',
      maxIterations: 2,
      maxParallelTools: 2,
      executeTool: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return 'ok'
      },
    })

    expect(peak).toBe(2)
  })

  it('keeps mutating and browser tools serial', () => {
    expect(canExecuteToolInParallel(toolCall('read', 'read_file'))).toBe(true)
    expect(canExecuteToolInParallel(toolCall('write', 'write_file'))).toBe(false)
    expect(canExecuteToolInParallel(toolCall('browser', 'browser_navigate'))).toBe(false)
  })
})
