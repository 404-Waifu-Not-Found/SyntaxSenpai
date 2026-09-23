import { describe, expect, it } from 'vitest'
import { handleInputLine, runHumanMove, runTurn } from '../main'
import { createHeadlessHost, isHeadlessToolAvailable } from '../host'

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

  it.each([
    ['tictactoe', '4'],
    ['connect4', '3'],
    ['chess', 'e2e4'],
  ] as const)('accepts a human %s move, lets the engine reply, then gets an agent remark', async (kind, move) => {
    const conversationId = `human-move-${kind}`
    await runTurn({
      type: 'turn', conversationId, text: `Play ${kind}`, maxIterations: 2,
      responses: [
        { id: 'start', content: '', toolCalls: [{ id: 'game', name: 'game_start', arguments: { kind, difficulty: 'strong' } }], finishReason: 'tool_calls' },
        { id: 'ready', content: 'Board ready.', toolCalls: [], finishReason: 'stop' },
      ],
    }, () => {})

    const events: any[] = []
    const result = await runHumanMove({
      type: 'human_move', conversationId, move,
      responses: [{ id: 'remark', content: 'Nice move.', toolCalls: [], finishReason: 'stop' }],
    }, (event) => events.push(event))

    expect(result.response).toBe('Nice move.')
    expect(result.gameSnapshot.moveCount).toBe(2)
    expect(result.gameSnapshot.turn).toBe('human')
    expect(result.newEffects.map((effect) => effect.action)).toEqual(['human_move', 'agent_move'])
    expect(events.filter((event) => event.type === 'game_event').map((event) => event.action)).toEqual(['human_move', 'agent_move'])
    expect(String(result.newMessages[0].content)).toContain('authoritative current game state')
  })

  it('rejects an illegal human move without advancing the game', async () => {
    const host = createHeadlessHost()
    await host.executeTool({ name: 'game_start', id: 'start', arguments: { kind: 'tictactoe' } })
    expect(() => host.playHumanMove('99')).toThrow()
    expect(host.getGameSnapshot()?.moveCount).toBe(0)
  })

  it('does not leak a failed provider turn into later history', async () => {
    await expect(runTurn({
      type: 'turn', conversationId: 'failed-provider-history', text: 'ghost message', provider: 'not-a-provider',
    }, () => {})).rejects.toThrow('Unsupported provider')
    const recovered = await runTurn({
      type: 'turn', conversationId: 'failed-provider-history', text: 'real message',
      responses: [{ id: 'ok', content: 'Recovered.', toolCalls: [], finishReason: 'stop' }],
    }, () => {})
    expect(recovered.history.map((message: any) => message.content)).toEqual(['real message', 'Recovered.'])
  })

  it('fails closed when a scripted provider runs out of replies', async () => {
    await expect(runTurn({
      type: 'turn', conversationId: 'exhausted-script', text: 'read metadata', maxIterations: 2,
      responses: [{ id: 'read', content: '', toolCalls: [{ id: 'read-tool', name: 'read_file', arguments: { path: 'package.json', limit: 1 } }], finishReason: 'tool_calls' }],
    }, () => {})).rejects.toThrow('Scripted provider responses exhausted')
    await expect(runTurn({ type: 'turn', conversationId: 'empty-fixture', text: 'hello', responses: [] }, () => {}))
      .rejects.toThrow('responses must contain at least one')
  })

  it('hides unavailable tools and never fabricates language-server results', async () => {
    expect(isHeadlessToolAvailable('lsp_diagnostics')).toBe(false)
    expect(isHeadlessToolAvailable('browser_click')).toBe(false)
    const host = createHeadlessHost()
    expect(await host.executeTool({ id: 'fake', name: 'lsp_diagnostics', arguments: { path: 'missing.ts' } }))
      .toContain('not available in the headless host')
    const result = await runTurn({
      type: 'turn', conversationId: 'unavailable-tool', text: 'check missing.ts', maxIterations: 2,
      responses: [
        { id: 'fake-tool', content: '', toolCalls: [{ id: 'lsp', name: 'lsp_diagnostics', arguments: { path: 'missing.ts' } }], finishReason: 'tool_calls' },
        { id: 'done', content: 'Could not check it.', toolCalls: [], finishReason: 'stop' },
      ],
    }, () => {})
    expect(String(result.history.find((message: any) => message.role === 'tool')?.content)).toContain('not available for this headless turn')
  })

  it('emits compact JSONL responses by default and full state on request', async () => {
    const compact: any[] = []
    await handleInputLine(JSON.stringify({
      type: 'turn', conversationId: 'compact-jsonl', text: 'hello',
      responses: [{ id: 'compact', content: 'Hi.', toolCalls: [], finishReason: 'stop' }],
    }), (event) => compact.push(event))
    const compactResponse = compact.at(-1)
    expect(compactResponse.type).toBe('response')
    expect(compactResponse.history).toBeUndefined()
    expect(compactResponse.newMessages).toHaveLength(2)

    const full: any[] = []
    await handleInputLine(JSON.stringify({
      type: 'turn', conversationId: 'compact-jsonl', text: 'again', includeHistory: true,
      responses: [{ id: 'full', content: 'Hello again.', toolCalls: [], finishReason: 'stop' }],
    }), (event) => full.push(event))
    expect(full.at(-1).history).toHaveLength(4)
    expect(full.at(-1).effects).toHaveLength(1)
  })

  it('processes a human_move JSONL input with ordered board and reply events', async () => {
    const conversationId = 'jsonl-human-move'
    await handleInputLine(JSON.stringify({
      type: 'turn', conversationId, text: 'play tic tac toe',
      responses: [
        { id: 'start', content: '', toolCalls: [{ id: 'start-tool', name: 'game_start', arguments: { kind: 'tictactoe' } }], finishReason: 'tool_calls' },
        { id: 'ready', content: 'Ready.', toolCalls: [], finishReason: 'stop' },
      ],
    }), () => {})
    const output: any[] = []
    await handleInputLine(JSON.stringify({
      type: 'human_move', conversationId, move: '4',
      responses: [{ id: 'remark', content: 'Good center move.', toolCalls: [], finishReason: 'stop' }],
    }), (event) => output.push(event))
    expect(output.slice(0, 2).map((event) => event.action)).toEqual(['human_move', 'agent_move'])
    expect(output.at(-1)).toMatchObject({ type: 'response', response: 'Good center move.', gameSnapshot: { moveCount: 2 } })
    expect(output.at(-1).history).toBeUndefined()
  })

  it('keeps a completed board move when the commentary provider fails', async () => {
    const conversationId = 'game-commentary-failure'
    await runTurn({
      type: 'turn', conversationId, text: 'Play tic tac toe',
      responses: [
        { id: 'start', content: '', toolCalls: [{ id: 'start-tool', name: 'game_start', arguments: { kind: 'tictactoe' } }], finishReason: 'tool_calls' },
        { id: 'ready', content: 'Ready.', toolCalls: [], finishReason: 'stop' },
      ],
    }, () => {})
    const events: any[] = []
    const moved = await runHumanMove({ type: 'human_move', conversationId, move: '4', provider: 'not-a-provider' }, (event) => events.push(event))
    expect(moved.gameSnapshot.moveCount).toBe(2)
    expect(moved.commentaryError).toContain('Unsupported provider')
    expect(events.filter((event) => event.type === 'game_event')).toHaveLength(2)
    const next = await runHumanMove({
      type: 'human_move', conversationId, move: moved.gameSnapshot.legalMoves[0],
      responses: [{ id: 'remark', content: 'Still playing.', toolCalls: [], finishReason: 'stop' }],
    }, () => {})
    expect(next.gameSnapshot.moveCount).toBe(4)
    expect(next.response).toBe('Still playing.')
  })
})
