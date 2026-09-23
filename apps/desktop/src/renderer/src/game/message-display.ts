const GAME_NAME: Record<string, string> = {
  tictactoe: 'Tic-Tac-Toe',
  connect4: 'Connect Four',
  chess: 'Chess',
}

/** Replace the machine-oriented board payload with the one-line move a user made. */
export function summarizeGameEvent(content: string): string {
  const match = content.match(/^\[Minigame event\]\s*The user just played (.+?) in (tictactoe|connect4|chess)\./i)
  if (!match) return content
  const gameName = GAME_NAME[match[2].toLowerCase()] || 'the game'
  return `Played ${match[1]} in ${gameName}. The updated board was shared with your agent.`
}
