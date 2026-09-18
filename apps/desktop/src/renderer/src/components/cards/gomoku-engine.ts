export type Stone = 'black' | 'white'
export type Cell = Stone | null

function inBounds(size: number, r: number, c: number): boolean {
  return r >= 0 && r < size && c >= 0 && c < size
}

export function createEmptyBoard(size: number): Cell[] {
  return Array.from({ length: size * size }, () => null)
}

export function hasEmptyCell(cells: Cell[]): boolean {
  return cells.some((cell) => cell == null)
}

export function checkWinAt(cells: Cell[], size: number, index: number, stone: Stone): boolean {
  const row = Math.floor(index / size)
  const col = index % size
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const
  for (const [dr, dc] of dirs) {
    let count = 1
    for (const step of [1, -1]) {
      let r = row + dr * step
      let c = col + dc * step
      while (inBounds(size, r, c) && cells[r * size + c] === stone) {
        count += 1
        r += dr * step
        c += dc * step
      }
    }
    if (count >= 5) return true
  }
  return false
}

function simulateWinningMove(cells: Cell[], size: number, stone: Stone): number {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] != null) continue
    cells[i] = stone
    const isWin = checkWinAt(cells, size, i, stone)
    cells[i] = null
    if (isWin) return i
  }
  return -1
}

function getCandidateMoves(cells: Cell[], size: number): number[] {
  const result = new Set<number>()
  let occupied = 0
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] == null) continue
    occupied += 1
    const row = Math.floor(i / size)
    const col = i % size
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = row + dr
        const nc = col + dc
        if (!inBounds(size, nr, nc)) continue
        const idx = nr * size + nc
        if (cells[idx] == null) result.add(idx)
      }
    }
  }
  if (occupied === 0) return []
  return Array.from(result).sort((a, b) => a - b)
}

function evaluateMove(cells: Cell[], size: number, index: number, stone: Stone, opponent: Stone): number {
  const row = Math.floor(index / size)
  const col = index % size
  const center = (size - 1) / 2
  const centerScore = 10 - (Math.abs(row - center) + Math.abs(col - center))
  let allyAdj = 0
  let enemyAdj = 0
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const nr = row + dr
      const nc = col + dc
      if (!inBounds(size, nr, nc)) continue
      const cell = cells[nr * size + nc]
      if (cell === stone) allyAdj += 1
      if (cell === opponent) enemyAdj += 1
    }
  }
  return centerScore + allyAdj * 4 + enemyAdj * 2
}

export function chooseAiMove(cells: Cell[], size: number, aiStone: Stone, userStone: Stone): number {
  const win = simulateWinningMove(cells, size, aiStone)
  if (win >= 0) return win
  const block = simulateWinningMove(cells, size, userStone)
  if (block >= 0) return block

  const candidates = getCandidateMoves(cells, size)
  const empties = candidates.length
    ? candidates
    : cells.map((cell, idx) => ({ cell, idx })).filter((x) => x.cell == null).map((x) => x.idx)

  let best = empties[0] ?? -1
  let bestScore = -Infinity
  for (const idx of empties) {
    const score = evaluateMove(cells, size, idx, aiStone, userStone)
    if (score > bestScore || (score === bestScore && idx < best)) {
      best = idx
      bestScore = score
    }
  }
  return best
}
