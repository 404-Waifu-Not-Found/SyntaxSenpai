import { shallowReactive } from 'vue'
import {
  createGameController,
  type GameController,
  type GameDifficulty,
  type GameKind,
  type GameSide,
  type GameSnapshot,
} from '@syntax-senpai/game-engine'

export interface GameSessionEvent {
  type: 'started' | 'move' | 'closed'
  sessionId: string
  actor?: GameSide
  move?: string
  snapshot?: GameSnapshot
}

export const gameSession = shallowReactive<{
  open: boolean
  sessionId: string | null
  controller: GameController | null
  snapshot: GameSnapshot | null
  busy: boolean
}>({
  open: false,
  sessionId: null,
  controller: null,
  snapshot: null,
  busy: false,
})

const listeners = new Set<(event: GameSessionEvent) => void>()

function gameIpc() {
  return typeof window === 'undefined' ? null : (window as any).electron?.ipcRenderer
}

function syncGameWindow(snapshot: GameSnapshot | null) {
  if (!snapshot) return
  gameIpc()?.send('game:session:update', snapshot)
}

function openGameWindow(snapshot: GameSnapshot) {
  void gameIpc()?.invoke('game:openWindow', snapshot).catch((error: unknown) => {
    console.warn('[game] failed to open dedicated game window', error)
  })
}

function publish(event: GameSessionEvent) {
  for (const listener of listeners) listener(event)
}

export function subscribeGameSession(listener: (event: GameSessionEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function requireController(): GameController {
  if (!gameSession.controller || !gameSession.snapshot || !gameSession.sessionId) {
    throw new Error('No minigame is currently open.')
  }
  return gameSession.controller
}

function updateSnapshot(snapshot: GameSnapshot, event: Omit<GameSessionEvent, 'sessionId' | 'snapshot'>) {
  gameSession.snapshot = snapshot
  syncGameWindow(snapshot)
  publish({ ...event, sessionId: gameSession.sessionId!, snapshot })
}

export function startGameSession(
  kind: GameKind,
  options: { difficulty?: GameDifficulty; humanSide?: string; humanStarts?: boolean } = {},
): GameSnapshot {
  const controller = createGameController(kind, options)
  const sessionId = `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  gameSession.open = true
  gameSession.sessionId = sessionId
  gameSession.controller = controller
  gameSession.snapshot = controller.snapshot()
  gameSession.busy = false
  publish({ type: 'started', sessionId, snapshot: gameSession.snapshot })

  // Let the engine make the opening move when the user chose to play second.
  if (gameSession.snapshot.turn === 'agent') {
    const snapshot = applyBestAgentMove()
    openGameWindow(snapshot)
    return snapshot
  }
  openGameWindow(gameSession.snapshot)
  return gameSession.snapshot
}

export function applyGameSessionMove(move: string, actor: GameSide): GameSnapshot {
  const controller = requireController()
  const snapshot = controller.applyMove(move, actor)
  updateSnapshot(snapshot, { type: 'move', actor, move })
  return snapshot
}

export function applyBestAgentMove(): GameSnapshot {
  const controller = requireController()
  if (gameSession.snapshot?.turn !== 'agent') {
    throw new Error(`It is ${gameSession.snapshot?.turn || 'game over'}'s turn.`)
  }
  const move = controller.bestMove()
  if (!move) throw new Error('The engine has no legal move in this position.')
  return applyGameSessionMove(move, 'agent')
}

export function getGameSessionSnapshot(): GameSnapshot | null {
  return gameSession.snapshot
}

export function closeGameSession() {
  const sessionId = gameSession.sessionId
  if (!sessionId) return
  void gameIpc()?.invoke('game:closeWindow').catch(() => { /* already closed */ })
  gameSession.open = false
  gameSession.sessionId = null
  gameSession.controller = null
  gameSession.snapshot = null
  gameSession.busy = false
  publish({ type: 'closed', sessionId })
}
