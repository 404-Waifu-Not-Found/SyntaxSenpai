import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameKind } from '@syntax-senpai/game-engine'
import {
  applyBestAgentMove,
  applyGameSessionMove,
  closeGameSession,
  gameSession,
  startGameSession,
  subscribeGameSession,
} from '../session'

afterEach(() => {
  closeGameSession()
  vi.unstubAllGlobals()
})

describe('embedded game sessions', () => {
  it.each([
    ['tictactoe', '0'],
    ['connect4', '0'],
    ['chess', 'e2e4'],
  ] as Array<[GameKind, string]>)('plays %s entirely in the renderer without opening a window', async (kind, humanMove) => {
    const invoke = vi.fn()
    const send = vi.fn()
    vi.stubGlobal('window', { electron: { ipcRenderer: { invoke, send } } })
    const events: string[] = []
    const unsubscribe = subscribeGameSession((event) => events.push(event.type))

    const opened = await startGameSession(kind, kind === 'chess' ? {
      chessMoveProvider: async () => ['e7e5', 'c7c5', 'g8f6'],
    } : {})
    expect(opened.kind).toBe(kind)
    expect(gameSession.open).toBe(true)
    expect(gameSession.snapshot?.turn).toBe('human')

    const afterHuman = applyGameSessionMove(humanMove, 'human')
    expect(afterHuman.moveCount).toBe(1)
    expect(afterHuman.turn).toBe('agent')
    const afterAgent = await applyBestAgentMove()
    expect(afterAgent.moveCount).toBe(2)
    expect(gameSession.snapshot).toEqual(afterAgent)

    closeGameSession()
    expect(gameSession.open).toBe(false)
    expect(gameSession.snapshot).toBeNull()
    expect(events).toEqual(['started', 'move', 'move', 'closed'])
    expect(invoke).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('reuses a same-kind session when both the composer and agent request chess', async () => {
    const options = { chessMoveProvider: async () => ['e7e5', 'c7c5', 'g8f6'] }
    await startGameSession('chess', options)
    const sessionId = gameSession.sessionId
    const snapshot = await startGameSession('chess', options)

    expect(gameSession.sessionId).toBe(sessionId)
    expect(gameSession.snapshot).toEqual(snapshot)
  })
})
