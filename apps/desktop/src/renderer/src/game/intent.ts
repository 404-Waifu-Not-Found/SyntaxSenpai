import type { GameDifficulty, GameKind } from '@syntax-senpai/game-engine'

export interface GameLaunchIntent {
  kind: GameKind
  difficulty: GameDifficulty
  humanSide: 'w' | 'b'
  humanStarts: boolean
}

/**
 * Recognise an explicit request to open one of the playable in-chat games.
 *
 * This is intentionally narrow: the model still owns game commentary and
 * moves, but a clear game request must not depend on a provider deciding to
 * emit a tool call before the user gets a GUI.
 */
export function detectGameLaunchIntent(text: string): GameLaunchIntent | null {
  const normalized = text.toLowerCase().replace(/[’']/g, "'")
  const kind: GameKind | null = /\b(?:tic[\s-]*tac[\s-]*toe|noughts?\s+and\s+crosses?)\b/.test(normalized)
    ? 'tictactoe'
    : /\b(?:connect\s*4|connect\s*four|four\s+in\s+a\s+row)\b/.test(normalized)
      ? 'connect4'
      : /\bchess\b/.test(normalized)
        ? 'chess'
        : null

  if (!kind) return null

  const difficulty: GameDifficulty = /\b(?:hard|strong|serious|expert|challenging)\b/.test(normalized)
    ? 'strong'
    : /\b(?:easy|casual|beginner|relaxed)\b/.test(normalized)
      ? 'casual'
      : 'balanced'
  const humanStarts = !/\b(?:you|agent|ai|computer)\s+(?:go|start|move)s?\b|\b(?:let|make)\s+you\s+(?:go|start|move)\b|\bplay\s+second\b/.test(normalized)
  const humanSide: 'w' | 'b' = /\b(?:black|second)\b/.test(normalized) ? 'b' : 'w'

  return { kind, difficulty, humanSide, humanStarts }
}
