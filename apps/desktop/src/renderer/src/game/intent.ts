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
const GAME_MENTION_PATTERNS: Array<{ kind: GameKind; pattern: RegExp }> = [
  { kind: 'tictactoe', pattern: /\b(?:tic[\s-]*tac[\s-]*toe|noughts?\s+and\s+crosses?)\b/gi },
  { kind: 'connect4', pattern: /\b(?:connect\s*4|connect\s*four|four\s+in\s+a\s+row)\b/gi },
  { kind: 'chess', pattern: /\bchess\b|国际象棋|西洋棋|象棋|échecs?|шахмат|チェス/giu },
]

const GENERIC_PLAY_REQUEST = /\b(?:play|start|open)\s+(?:a\s+|some\s+)?game\b|\b(?:let'?s|let us)\s+play\s+(?:a\s+|some\s+)?game\b|(?:玩|来)(?:个|一局|场)?游戏|joue(?:r|z|ons)?\s+à\s+un\s+jeu|сыгра(?:й|ем|ть)\s+[^。.!?]*?игру|ゲーム(?:を)?(?:しよう|しませんか|して)/iu
const CANCEL_GAME_REQUEST = /\b(?:do not|don't|dont|stop|close|cancel)\s+(?:\w+\s+){0,3}game\b|(?:不要|别|不想|关闭|关掉).{0,8}游戏/iu

function resolveGameChoice(text: string, assistantContext: string): GameKind | null {
  const ordinal = /\b(?:first|1st|one|second|2nd|two|third|3rd|three|fourth|4th)\b|(?:option|game|number)\s*[1-4]/i.exec(text)?.[0]
  if (!ordinal) return null

  const choiceIndex = /second|2nd|two|(?:option|game|number)\s*2/i.test(ordinal)
    ? 1
    : /third|3rd|three|(?:option|game|number)\s*3/i.test(ordinal)
      ? 2
      : /fourth|4th|(?:option|game|number)\s*4/i.test(ordinal)
        ? 3
        : 0
  const matches: Array<{ kind: GameKind; index: number }> = []
  for (const { kind, pattern } of GAME_MENTION_PATTERNS) {
    pattern.lastIndex = 0
    const match = pattern.exec(assistantContext)
    if (match) matches.push({ kind, index: match.index })
  }
  matches.sort((a, b) => a.index - b.index)
  const orderedKinds = matches.map(({ kind }) => kind)
  // Only interpret an ordinal when the previous assistant message really
  // offered a list of distinct games; otherwise "the first one" is ambiguous.
  if (orderedKinds.length < 2) return null
  return orderedKinds[choiceIndex] ?? null
}

export function detectGameLaunchIntent(text: string, assistantContext = ''): GameLaunchIntent | null {
  const normalized = text.toLowerCase().replace(/[’']/g, "'")
  let kind: GameKind | null = /\b(?:tic[\s-]*tac[\s-]*toe|noughts?\s+and\s+crosses?)\b/.test(normalized)
    ? 'tictactoe'
    : /\b(?:connect\s*4|connect\s*four|four\s+in\s+a\s+row)\b/.test(normalized)
      ? 'connect4'
      : /\bchess\b|国际象棋|西洋棋|象棋|échecs?|шахмат|チェス/u.test(normalized)
        ? 'chess'
        : null

  if (!kind) {
    kind = resolveGameChoice(normalized, assistantContext)
  }

  // A generic play request, including the new-chat suggestion, starts a
  // playable default board before the model can claim one exists in text.
  if (!kind && GENERIC_PLAY_REQUEST.test(normalized) && !CANCEL_GAME_REQUEST.test(normalized)) {
    kind = 'tictactoe'
  }

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
