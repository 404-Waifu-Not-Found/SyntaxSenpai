import { describe, expect, it } from 'vitest'
import { runAgentSession } from '../index'

describe('runAgentSession', () => {
  it('preserves the canonical runner result while emitting ordered events', async () => {
    const events: string[] = []
    const history: any[] = [{ id: 'user-1', role: 'user', content: 'hello' }]
    const result = await runAgentSession({
      model: 'fixture',
      history,
      tools: [],
      systemPrompt: '',
      maxIterations: 1,
      callProvider: async () => ({ id: 'assistant-1', content: 'hi', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: 'stop' }),
      host: { executeTool: async () => 'unused' },
      onEvent: (event) => events.push(event.type),
    })

    expect(result.finalContent).toBe('hi')
    expect(events).toEqual(['turn_start', 'iteration_start', 'assistant_iteration_end', 'turn_complete'])
  })

  it('turns thrown provider failures into a terminal event before rethrowing', async () => {
    const events: string[] = []
    await expect(runAgentSession({
      model: 'fixture',
      history: [],
      tools: [],
      systemPrompt: '',
      maxIterations: 1,
      callProvider: async () => { throw new Error('provider unavailable') },
      host: { executeTool: async () => 'unused' },
      onEvent: (event) => events.push(event.type),
    })).rejects.toThrow('provider unavailable')
    expect(events).toEqual(['turn_start', 'iteration_start', 'turn_error'])
  })

  it('preserves streaming, tool-result, and retry ordering through the host boundary', async () => {
    const events: string[] = []
    const history: any[] = [{ id: 'user-1', role: 'user', content: 'inspect this' }]
    let providerCalls = 0
    const result = await runAgentSession({
      model: 'fixture',
      history,
      tools: [],
      systemPrompt: '',
      maxIterations: 2,
      callProvider: async (request) => {
        providerCalls += 1
        request.onTextDelta?.(providerCalls === 1 ? 'working' : 'done')
        return providerCalls === 1
          ? { id: 'assistant-1', content: '', toolCalls: [{ id: 'tool-1', name: 'terminal', arguments: { command: 'true' } }] }
          : { id: 'assistant-2', content: 'done', toolCalls: [] }
      },
      host: { executeTool: async () => 'ok' },
      onEvent: (event) => events.push(event.type),
    })

    expect(result.finalContent).toBe('done')
    expect(history.filter((message) => message.role === 'tool').map((message) => message.content)).toEqual(['ok'])
    expect(events).toEqual([
      'turn_start',
      'iteration_start',
      'assistant_text_delta',
      'assistant_iteration_end',
      'tool_start',
      'tool_result',
      'iteration_start',
      'assistant_text_delta',
      'assistant_iteration_end',
      'turn_complete',
    ])
  })

  it('converts a thrown side effect into a tool error and keeps the turn moving', async () => {
    let providerCalls = 0
    const history: any[] = [{ id: 'user-1', role: 'user', content: 'set my expression' }]
    const result = await runAgentSession({
      model: 'fixture',
      history,
      tools: [],
      systemPrompt: '',
      maxIterations: 2,
      callProvider: async () => {
        providerCalls += 1
        return providerCalls === 1
          ? { id: 'assistant-1', content: '', toolCalls: [{ id: 'effect-1', name: 'set_expression', arguments: { expression: 'happy' } }] }
          : { id: 'assistant-2', content: 'recovered', toolCalls: [] }
      },
      host: {
        executeTool: async () => 'unused',
        handleSideEffect: () => { throw new Error('expression host unavailable') },
      },
    })

    expect(result.finalContent).toBe('recovered')
    expect(history.find((message) => message.toolCallId === 'effect-1')?.content).toBe('Error: expression host unavailable')
  })

  it('finishes through stop_response and reports an already-aborted turn cleanly', async () => {
    const stoppedEvents: string[] = []
    const stopped = await runAgentSession({
      model: 'fixture',
      history: [{ id: 'user-1', role: 'user', content: 'stop after this' }],
      tools: [],
      systemPrompt: '',
      maxIterations: 2,
      callProvider: async () => ({ id: 'assistant-1', content: '', toolCalls: [{ id: 'stop-1', name: 'stop_response', arguments: { final_message: 'finished' } }] }),
      host: {
        executeTool: async () => 'unused',
        handleSideEffect: () => ({ resultContent: 'ok', stop: true, finalContent: 'finished' }),
      },
      onEvent: (event) => stoppedEvents.push(event.type),
    })
    expect(stopped.finalContent).toBe('finished')
    expect(stopped.stopped).toBe(true)
    expect(stoppedEvents.at(-1)).toBe('turn_complete')

    const controller = new AbortController()
    controller.abort()
    const aborted = await runAgentSession({
      model: 'fixture',
      history: [],
      tools: [],
      systemPrompt: '',
      maxIterations: 2,
      abortSignal: controller.signal,
      callProvider: async () => { throw new Error('provider should not be called') },
      host: { executeTool: async () => 'unused' },
    })
    expect(aborted.stopped).toBe(true)
    expect(aborted.iterations).toBe(0)
  })
})
