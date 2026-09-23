const TIC_TAC_TOE_ROW = /^\s*(?:\d\s*[|:.)-]\s*)?(?:\[\s*(?:[xo]|[·.]|-)?\s*\]\s*){2,8}$/i
const SPACED_GAME_ROW = /^\s*(?:[xo·.]\s+){1,7}[xo·.]\s*$/i
const CHESS_ASCII_ROW = /^\s*[1-8]\s*[|:]\s*(?:[prnbqk.]\s*){2,8}$/i
const CHESS_SPACED_ROW = /^\s*(?:[prnbqk.]\s+){1,7}[prnbqk.]\s*$/i
const CHESS_UNICODE_ROW = /^\s*[1-8]\s*[|:]?\s*(?:[♙♘♗♖♕♔♟♞♝♜♛♚·.]\s*){8}$/u
const PIPE_GRID_ROW = /^\s*\|?\s*(?:[xo·.]|[prnbqk]|[♙♘♗♖♕♔♟♞♝♜♛♚])(?:\s*\|\s*(?:[xo·.]|[prnbqk]|[♙♘♗♖♕♔♟♞♝♜♛♚])){2,7}\s*\|?\s*$/iu
const BOARD_INTRO = /^\s*(?:here(?:'s| is) (?:the )?board|the board (?:looks like this|is set up like this)|(?:the )?position is)(?:\s+as follows)?[.!:]*\s*$/i
const CHESS_MOVE_NOTATION = /\b(?:[KQRBN]?[a-h][1-8](?:[a-h][1-8](?:=[QRBN])?[+#]?)?[+#]?|O-O(?:-O)?)\b/i
const SPARSE_PIPE_GRID_ROW = /^\s*\|(?:\s*[xo·.]?\s*\|){2,7}\s*$/i

function isBoardDiagramRow(line: string): boolean {
  return TIC_TAC_TOE_ROW.test(line)
    || SPACED_GAME_ROW.test(line)
    || CHESS_ASCII_ROW.test(line)
    || CHESS_SPACED_ROW.test(line)
    || CHESS_UNICODE_ROW.test(line)
    || PIPE_GRID_ROW.test(line)
    || SPARSE_PIPE_GRID_ROW.test(line)
}

/** Remove plain-text board rows while leaving surrounding assistant prose intact. */
export function stripBoardDiagrams(input: string): string {
  const lines = String(input || '').split(/\r?\n/)
  const kept: string[] = []
  let removedBoardRow = false

  for (const line of lines) {
    if (isBoardDiagramRow(line)) {
      if (BOARD_INTRO.test(kept.at(-1) || '')) kept.pop()
      removedBoardRow = true
      continue
    }
    if (removedBoardRow && BOARD_INTRO.test(line)) {
      continue
    }
    kept.push(line)
    if (line.trim()) removedBoardRow = false
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Prepare a dedicated voice-over line: speech only, with no board or markup. */
export function normalizeVoiceoverText(input: string): string {
  const plainText = stripBoardDiagrams(String(input || ''))
    .replace(/```syntax-senpai-card[\s\S]*?```/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+).*$/gm, ' ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[`*_#>|{}]/g, '')
    .replace(/[^\p{L}\p{N}\p{P}\s]/gu, '')
    .replace(/\s+([,.!?;:])/g, '$1')
  const sentences = plainText
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .filter((sentence) => sentence.trim() && !CHESS_MOVE_NOTATION.test(sentence))
    .slice(0, 2)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const words = sentences.split(/\s+/).filter(Boolean)
  if (words.length <= 35) return sentences
  return `${words.slice(0, 35).join(' ').replace(/[.!?…,:;]+$/, '')}…`
}
