import { describe, expect, it } from 'vitest'
import { runTurn } from '../main'
import { createHeadlessHost } from '../host'

describe('headless runtime', () => {
  it('runs a scripted JSONL-equivalent turn without a provider key', async () => {
    const events: any[] = []
    const result = await runTurn({
      type: 'turn',
      conversationId: 'jsonl-fixture',
      text: 'hello',
      responses: [{
        id: 'fixture-assistant',
        content: 'hello from the headless runtime',
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        finishReason: 'stop',
      }],
    }, (event) => events.push(event))

    expect(result.response).toBe('hello from the headless runtime')
    expect(result.history.map((message: any) => message.role)).toEqual(['user', 'assistant'])
    expect(result.effects).toContainEqual({ type: 'rename_chat', title: 'hello', automatic: true })
    expect(events.map((event) => event.type)).toEqual([
      'turn_start',
      'conversation_renamed',
      'iteration_start',
      'assistant_iteration_end',
      'turn_complete',
    ])
  })

  it('returns ordered final messages as separate headless outputs', async () => {
    const result = await runTurn({
      type: 'turn',
      conversationId: 'multi-final-fixture',
      text: 'reply in two messages',
      responses: [{
        id: 'fixture-final',
        content: '',
        toolCalls: [{ id: 'finish', name: 'stop_response', arguments: { final_message: '', messages: ['One.', 'Two.'] } }],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        finishReason: 'tool_calls',
      }],
    }, () => {})

    expect(result.messages).toEqual(['One.', 'Two.'])
    expect(result.response).toBe('One.\n\nTwo.')
    expect(result.history.slice(-2).map((message: any) => message.content)).toEqual(result.messages)
  })

  it.each([
    ['tictactoe', 'Perfect minimax'],
    ['connect4', 'Alpha-beta Connect Four (strong)'],
    ['chess', 'Chess alpha-beta (strong)'],
  ] as const)('keeps the real %s engine snapshot while replacing the window with state', async (kind, engine) => {
    const host = createHeadlessHost()
    const started = await host.executeTool({ name: 'game_start', id: `start-${kind}`, arguments: { kind, difficulty: 'strong' } })
    const payload = JSON.parse(started.split('Current state:\n')[1])

    expect(payload.kind).toBe(kind)
    expect(payload.engine).toBe(engine)
    expect(payload.legalMoves.length).toBeGreaterThan(0)
    expect(host.state.effects.at(-1)).toMatchObject({ type: 'game_session', action: 'started' })
  })

  it('emits ordered game events and keeps the game tool contract', async () => {
    const events: any[] = []
    const result = await runTurn({
      type: 'turn',
      conversationId: 'game-fixture',
      text: 'play tic tac toe',
      maxIterations: 2,
      responses: [
        { id: 'game-start', content: '', toolCalls: [{ id: 'tool-start', name: 'game_start', arguments: { kind: 'tictactoe', difficulty: 'strong' } }], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: 'tool_calls' },
        { id: 'game-finish', content: 'The board is ready.', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: 'stop' },
      ],
    }, (event) => events.push(event))

    expect(result.response).toBe('The board is ready.')
    expect(events.map((event) => event.type)).toContain('game_event')
    expect(result.effects).toContainEqual(expect.objectContaining({ type: 'game_session', action: 'started' }))
  })

  it('normalizes attachments into the same multimodal user message shape', async () => {
    const result = await runTurn({
      type: 'turn',
      conversationId: 'attachment-fixture',
      text: 'read this image',
      attachments: [{ url: 'data:image/png;base64,fixture', mimeType: 'image/png', name: 'fixture.png' }],
      responses: [{ id: 'attachment-reply', content: 'seen', toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: 'stop' }],
    }, () => {})

    expect(result.history[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'read this image' },
        { type: 'image_url', imageUrl: { url: 'data:image/png;base64,fixture' } },
      ],
    })
  })
})
