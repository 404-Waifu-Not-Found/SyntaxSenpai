import { shallowReactive } from 'vue'
import {
  createGameController,
  type GameController,
  type GameOptions,
  type GameKind,
  type GameSide,
  type GameSnapshot,
} from '@syntax-senpai/game-engine'
import { browserStockfishAnalysisProvider } from './stockfish-browser'

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
  publish({ ...event, sessionId: gameSession.sessionId!, snapshot })
}

export function startGameSession(
  kind: GameKind,
  options: GameOptions = {},
): Promise<GameSnapshot> {
  // Tool and UI intent detection may both request the same game during one
  // chat turn. Reuse the already-visible session instead of silently
  // replacing the board the renderer is showing.
  if (gameSession.open && gameSession.snapshot?.kind === kind) {
    return Promise.resolve(gameSession.snapshot)
  }

  const controller = createGameController(kind, {
    ...options,
    ...(kind === 'chess' && !options.chessAnalysisProvider && !options.chessMoveProvider
      ? { chessAnalysisProvider: browserStockfishAnalysisProvider }
      : {}),
  })
  const sessionId = `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  gameSession.open = true
  gameSession.sessionId = sessionId
  gameSession.controller = controller
  gameSession.snapshot = controller.snapshot()
  gameSession.busy = gameSession.snapshot.turn === 'agent'
  publish({ type: 'started', sessionId, snapshot: gameSession.snapshot })

  // Let the engine make the opening move when the user chose to play second.
  if (gameSession.snapshot.turn === 'agent') {
    return applyBestAgentMove().finally(() => { gameSession.busy = false })
  }
  return Promise.resolve(gameSession.snapshot)
}

export function applyGameSessionMove(move: string, actor: GameSide): GameSnapshot {
  const controller = requireController()
  const snapshot = controller.applyMove(move, actor)
  updateSnapshot(snapshot, { type: 'move', actor, move })
  return snapshot
}

export async function applyBestAgentMove(): Promise<GameSnapshot> {
  const controller = requireController()
  if (gameSession.snapshot?.turn !== 'agent') {
    throw new Error(`It is ${gameSession.snapshot?.turn || 'game over'}'s turn.`)
  }
  const sessionId = gameSession.sessionId
  const wasBusy = gameSession.busy
  gameSession.busy = true
  try {
    const move = await controller.bestMove()
    if (sessionId !== gameSession.sessionId || controller !== gameSession.controller || !gameSession.open) {
      throw new Error('The game session changed while the engine was thinking.')
    }
    if (!move) throw new Error('The engine has no legal move in this position.')
    return applyGameSessionMove(move, 'agent')
  } finally {
    gameSession.busy = wasBusy
  }
}

export function getGameSessionSnapshot(): GameSnapshot | null {
  return gameSession.snapshot
}

export function closeGameSession() {
  const sessionId = gameSession.sessionId
  if (!sessionId) return
  gameSession.open = false
  gameSession.sessionId = null
  gameSession.controller = null
  gameSession.snapshot = null
  gameSession.busy = false
  publish({ type: 'closed', sessionId })
}
