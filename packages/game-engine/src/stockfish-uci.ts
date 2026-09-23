export interface StockfishUciTransport {
  send(command: string): void
  onLine(listener: (line: string) => void): () => void
  onError?(listener: (error: Error) => void): () => void
  close(): void
}

export interface StockfishAnalysisOptions {
  multiPv: number
  moveTimeMs: number
  stopOnMateIn?: number
}

export interface StockfishScore {
  type: 'cp' | 'mate'
  value: number
}

export interface StockfishPrincipalVariation {
  rank: number
  depth: number
  score: StockfishScore
  moves: string[]
}

export interface StockfishAnalysis {
  depth: number
  bestMove: string | null
  lines: StockfishPrincipalVariation[]
  stoppedForMate: boolean
}

export type StockfishAnalysisProvider = (
  fen: string,
  options: StockfishAnalysisOptions,
) => Promise<StockfishAnalysis>

export type StockfishMoveProvider = (
  fen: string,
  options: StockfishAnalysisOptions,
) => Promise<string[]>

type Waiter = {
  matches: (line: string) => boolean
  resolve: (line: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class UciLineBus {
  private readonly listeners = new Set<(line: string) => void>()
  private readonly waiters = new Set<Waiter>()
  private failure: Error | null = null

  publish(line: string) {
    for (const listener of this.listeners) listener(line)
    for (const waiter of this.waiters) {
      let matches = false
      try { matches = waiter.matches(line) } catch (error) {
        this.remove(waiter)
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
        continue
      }
      if (!matches) continue
      this.remove(waiter)
      waiter.resolve(line)
    }
  }

  subscribe(listener: (line: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  waitFor(matches: (line: string) => boolean, timeoutMs: number, description: string): Promise<string> {
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        matches,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.remove(waiter)
          reject(new Error(`Stockfish timed out waiting for ${description}.`))
        }, timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  fail(error: Error) {
    this.failure = error
    for (const waiter of this.waiters) {
      this.remove(waiter)
      waiter.reject(error)
    }
  }

  dispose() {
    this.fail(new Error('Stockfish transport closed.'))
    this.listeners.clear()
  }

  private remove(waiter: Waiter) {
    clearTimeout(waiter.timer)
    this.waiters.delete(waiter)
  }
}

interface UciConnection {
  transport: StockfishUciTransport
  bus: UciLineBus
  close(): void
}

function parsePrincipalVariation(line: string): StockfishPrincipalVariation | null {
  if (!line.startsWith('info ')) return null
  const depth = Number(line.match(/\bdepth\s+(\d+)/)?.[1])
  const rank = Number(line.match(/\bmultipv\s+(\d+)/)?.[1] ?? '1')
  const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/)
  const pvMatch = line.match(/\bpv\s+(.+)$/)
  if (!Number.isFinite(depth) || !Number.isFinite(rank) || rank < 1 || rank > 3 || !scoreMatch || !pvMatch) return null
  const moves = pvMatch[1].trim().split(/\s+/).filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))
  if (!moves.length) return null
  return { depth, rank, score: { type: scoreMatch[1] as StockfishScore['type'], value: Number(scoreMatch[2]) }, moves }
}

/**
 * Build a serial UCI client over either a browser Worker or a Node/WASM host.
 * MultiPV lines are kept separate by rank so the caller can intentionally
 * choose Stockfish's third-ranked move rather than its bestmove output.
 */
export function createStockfishAnalysisProvider(
  createTransport: () => StockfishUciTransport | Promise<StockfishUciTransport>,
): StockfishAnalysisProvider {
  let connectionPromise: Promise<UciConnection> | null = null
  let queue: Promise<unknown> = Promise.resolve()

  const openConnection = async (): Promise<UciConnection> => {
    const transport = await createTransport()
    const bus = new UciLineBus()
    const unsubscribeLines = transport.onLine((line) => bus.publish(String(line).trim()))
    const unsubscribeErrors = transport.onError?.((error) => bus.fail(error))
    const connection: UciConnection = {
      transport,
      bus,
      close() {
        unsubscribeLines()
        unsubscribeErrors?.()
        bus.dispose()
        transport.close()
      },
    }

    try {
      const uciReady = bus.waitFor((line) => line === 'uciok', 20_000, 'the UCI handshake')
      transport.send('uci')
      await uciReady

      transport.send('setoption name Threads value 1')
      transport.send('setoption name MultiPV value 3')
      const engineReady = bus.waitFor((line) => line === 'readyok', 10_000, 'engine readiness')
      transport.send('isready')
      await engineReady
      return connection
    } catch (error) {
      connection.close()
      throw error
    }
  }

  const ensureConnection = () => {
    if (!connectionPromise) {
      connectionPromise = openConnection().catch((error) => {
        connectionPromise = null
        throw error
      })
    }
    return connectionPromise
  }

  const analyze = async (fen: string, options: StockfishAnalysisOptions): Promise<StockfishAnalysis> => {
    const connection = await ensureConnection()
    try {
      const ready = connection.bus.waitFor((line) => line === 'readyok', 10_000, 'a new-game reset')
      connection.transport.send('ucinewgame')
      connection.transport.send('isready')
      await ready

      const linesByDepth = new Map<number, Map<number, StockfishPrincipalVariation>>()
      const stopOnMateIn = Math.max(1, Math.round(options.stopOnMateIn ?? 3))
      let stoppedForMate = false
      const unsubscribe = connection.bus.subscribe((line) => {
        const pv = parsePrincipalVariation(line)
        if (!pv) return
        let rankedLines = linesByDepth.get(pv.depth)
        if (!rankedLines) {
          rankedLines = new Map()
          linesByDepth.set(pv.depth, rankedLines)
        }
        rankedLines.set(pv.rank, pv)
        // Stop as soon as Stockfish finds a short forced mate for the side to
        // move. The board applies the engine move before asking the LLM to
        // comment, avoiding both a wasted search and a tool-call round trip.
        if (!stoppedForMate && pv.rank === 1 && pv.score.type === 'mate' &&
          pv.score.value > 0 && pv.score.value <= stopOnMateIn) {
          stoppedForMate = true
          connection.transport.send('stop')
        }
      })

      try {
        const done = connection.bus.waitFor((line) => line.startsWith('bestmove '), Math.max(8_000, options.moveTimeMs + 6_000), 'the search result')
        connection.transport.send(`position fen ${fen}`)
        connection.transport.send(`go movetime ${Math.max(75, Math.min(5_000, Math.round(options.moveTimeMs)))}`)
        const completion = { line: await done, early: stoppedForMate }
        const bestMove = completion.line.match(/^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1] ?? null
        const depths = [...linesByDepth.keys()].sort((a, b) => b - a)
        const requestedLines = Math.max(1, Math.min(3, Math.round(options.multiPv || 3)))
        const forcedMateDepth = completion.early
          ? depths.find((depth) => linesByDepth.get(depth)?.get(1)?.score.type === 'mate' &&
            linesByDepth.get(depth)!.get(1)!.score.value > 0 && linesByDepth.get(depth)!.get(1)!.score.value <= stopOnMateIn)
          : undefined
        const selectedDepth = forcedMateDepth ?? depths.find((depth) => (linesByDepth.get(depth)?.size ?? 0) >= requestedLines) ?? depths[0]
        const lines = selectedDepth === undefined
          ? []
          : [...(linesByDepth.get(selectedDepth)?.values() ?? [])].sort((a, b) => a.rank - b.rank).slice(0, requestedLines)
        if (!lines.length && bestMove) {
          lines.push({ rank: 1, depth: 0, score: { type: 'cp', value: 0 }, moves: [bestMove] })
        }
        return { depth: selectedDepth ?? 0, bestMove, lines, stoppedForMate: completion.early }
      } finally {
        unsubscribe()
      }
    } catch (error) {
      if (connectionPromise) {
        connection.close()
        connectionPromise = null
      }
      throw error
    }
  }

  return (fen, options) => {
    const work = queue.then(() => analyze(fen, options), () => analyze(fen, options))
    queue = work.then(() => undefined, () => undefined)
    return work
  }
}

/** Compatibility wrapper for consumers that only need the ranked first moves. */
export function createStockfishMoveProvider(
  createTransport: () => StockfishUciTransport | Promise<StockfishUciTransport>,
): StockfishMoveProvider {
  const analyze = createStockfishAnalysisProvider(createTransport)
  return async (fen, options) => {
    const result = await analyze(fen, options)
    const moves = result.lines.map((line) => line.moves[0]).filter((move): move is string => !!move)
    if (!moves.length && result.bestMove) moves.push(result.bestMove)
    return moves
  }
}
