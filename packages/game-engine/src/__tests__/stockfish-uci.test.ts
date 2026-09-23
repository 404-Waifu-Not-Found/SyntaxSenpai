import { describe, expect, it } from 'vitest'
import { createStockfishAnalysisProvider, createStockfishMoveProvider, type StockfishUciTransport } from '../stockfish-uci'

class FakeUciTransport implements StockfishUciTransport {
  private readonly listeners = new Set<(line: string) => void>()
  readonly commands: string[] = []

  constructor(private readonly mateIn?: number) {}

  send(command: string) {
    this.commands.push(command)
    if (command === 'uci') queueMicrotask(() => this.emit('uciok'))
    if (command === 'isready') queueMicrotask(() => this.emit('readyok'))
    if (command === 'stop') queueMicrotask(() => this.emit('bestmove e7e5'))
    if (command.startsWith('go movetime')) {
      queueMicrotask(() => {
        if (this.mateIn) {
          this.emit(`info depth 18 multipv 1 score mate ${this.mateIn} pv e7e5 g1f3 b8c6`)
          if (!this.commands.includes('stop')) this.emit('bestmove e7e5')
          return
        }
        this.emit('info depth 11 multipv 1 score cp 23 pv e2e4 e7e5')
        this.emit('info depth 11 multipv 2 score cp 18 pv d2d4 d7d5')
        this.emit('info depth 11 multipv 3 score cp 11 pv g1f3 d7d5')
        this.emit('info depth 12 multipv 1 score cp 25 pv e2e4 c7c5')
        this.emit('info depth 12 multipv 2 score cp 20 pv d2d4 d7d5')
        this.emit('bestmove e2e4')
      })
    }
  }

  onLine(listener: (line: string) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {}

  private emit(line: string) {
    for (const listener of this.listeners) listener(line)
  }
}

describe('Stockfish UCI adapter', () => {
  it('keeps MultiPV ranks distinct and returns moves in rank order', async () => {
    const provider = createStockfishMoveProvider(() => new FakeUciTransport())
    const moves = await provider('start FEN', { multiPv: 3, moveTimeMs: 100 })

    expect(moves).toEqual(['e2e4', 'd2d4', 'g1f3'])
  })

  it('returns scores and full principal variations from the latest complete depth', async () => {
    const provider = createStockfishAnalysisProvider(() => new FakeUciTransport())
    const analysis = await provider('start FEN', { multiPv: 3, moveTimeMs: 100 })

    expect(analysis).toMatchObject({
      depth: 11,
      bestMove: 'e2e4',
      stoppedForMate: false,
      lines: [
        { rank: 1, score: { type: 'cp', value: 23 }, moves: ['e2e4', 'e7e5'] },
        { rank: 2, score: { type: 'cp', value: 18 }, moves: ['d2d4', 'd7d5'] },
        { rank: 3, score: { type: 'cp', value: 11 }, moves: ['g1f3', 'd7d5'] },
      ],
    })
  })

  it('stops searching as soon as a forced mate within three is found', async () => {
    const transport = new FakeUciTransport(2)
    const provider = createStockfishAnalysisProvider(() => transport)
    const analysis = await provider('position', { multiPv: 3, moveTimeMs: 5_000, stopOnMateIn: 3 })

    expect(transport.commands).toContain('stop')
    expect(analysis).toMatchObject({
      depth: 18,
      bestMove: 'e7e5',
      stoppedForMate: true,
      lines: [{ rank: 1, score: { type: 'mate', value: 2 }, moves: ['e7e5', 'g1f3', 'b8c6'] }],
    })
  })
})
