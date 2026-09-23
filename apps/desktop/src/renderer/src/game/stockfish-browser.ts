import {
  createStockfishAnalysisProvider,
  type StockfishUciTransport,
} from '@syntax-senpai/game-engine'

function createBrowserTransport(): StockfishUciTransport {
  const engineUrl = new URL('./stockfish/stockfish-19-lite-single.js', window.location.href)
  const wasmUrl = new URL('./stockfish/stockfish-19-lite-single.wasm', window.location.href)
  const worker = new Worker(`${engineUrl.href}#${encodeURIComponent(wasmUrl.href)}`)
  const lineListeners = new Set<(line: string) => void>()
  const errorListeners = new Set<(error: Error) => void>()

  worker.addEventListener('message', (event: MessageEvent) => {
    for (const listener of lineListeners) listener(String(event.data ?? ''))
  })
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Stockfish worker failed to load.')
    for (const listener of errorListeners) listener(error)
  })

  return {
    send: (command) => worker.postMessage(command),
    onLine(listener) {
      lineListeners.add(listener)
      return () => lineListeners.delete(listener)
    },
    onError(listener) {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
    close() {
      worker.terminate()
      lineListeners.clear()
      errorListeners.clear()
    },
  }
}

export const browserStockfishAnalysisProvider = createStockfishAnalysisProvider(createBrowserTransport)
