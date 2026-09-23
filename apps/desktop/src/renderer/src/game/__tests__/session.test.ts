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
  ] as Array<[GameKind, string]>)('plays %s entirely in the renderer without opening a window', (kind, humanMove) => {
    const invoke = vi.fn()
    const send = vi.fn()
    vi.stubGlobal('window', { electron: { ipcRenderer: { invoke, send } } })
    const events: string[] = []
    const unsubscribe = subscribeGameSession((event) => events.push(event.type))

    const opened = startGameSession(kind)
    expect(opened.kind).toBe(kind)
    expect(gameSession.open).toBe(true)
    expect(gameSession.snapshot?.turn).toBe('human')

    const afterHuman = applyGameSessionMove(humanMove, 'human')
    expect(afterHuman.moveCount).toBe(1)
    expect(afterHuman.turn).toBe('agent')
    const afterAgent = applyBestAgentMove()
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
})
