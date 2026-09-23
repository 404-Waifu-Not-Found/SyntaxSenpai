import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  createStockfishAnalysisProvider,
  type StockfishUciTransport,
} from '@syntax-senpai/game-engine/dist/index.js'

type StockfishModule = {
  locateFile: (filename: string) => string
  print: (line: string) => void
  printErr: (line: string) => void
  listener?: (line: string) => void
  _isReady?: () => boolean
  ccall: (name: string, returnType: null, argumentTypes: string[], args: string[], options?: { async?: boolean }) => unknown
  sendCommand?: (command: string) => void
  terminate?: () => void
}

type StockfishInitializer = () => (module: StockfishModule) => Promise<unknown>

const require = createRequire(import.meta.url)
const stockfishEnginePath = fileURLToPath(
  new URL('../../../packages/game-engine/assets/stockfish/stockfish-19-lite-single.js', import.meta.url),
)

async function createNodeTransport(): Promise<StockfishUciTransport> {
  const wasmPath = stockfishEnginePath.replace(/\.js$/, '.wasm')
  const initializer = require(stockfishEnginePath) as StockfishInitializer
  const initializeModule = initializer()
  const listeners = new Set<(line: string) => void>()
  const errorListeners = new Set<(error: Error) => void>()
  let closed = false

  const engine: StockfishModule = {
    locateFile: (filename) => filename.endsWith('.wasm') ? wasmPath : stockfishEnginePath,
    listener: (line) => {
      const text = String(line)
      for (const listener of listeners) listener(text)
    },
    print: (line) => {
      const text = String(line)
      for (const listener of listeners) listener(text)
    },
    printErr: (line) => {
      const text = String(line)
      for (const listener of listeners) listener(text)
    },
    ccall: () => undefined,
  }

  try {
    await initializeModule(engine)
    while (engine._isReady && !engine._isReady()) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    delete engine._isReady
    engine.sendCommand = (command) => {
      if (closed) return
      setImmediate(() => {
        if (closed) return
        engine.ccall('command', null, ['string'], [command], { async: /^go\b/.test(command) })
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error : new Error(String(error))
    for (const listener of errorListeners) listener(message)
    try { engine.terminate?.() } catch { /* Ignore errors while unwinding a failed WASM init. */ }
    throw message
  }

  return {
    send: (command) => engine.sendCommand?.(command),
    onLine(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onError(listener) {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
    close() {
      if (closed) return
      closed = true
      try { engine.terminate?.() } catch { /* Single-threaded Stockfish has no worker to terminate. */ }
      listeners.clear()
      errorListeners.clear()
    },
  }
}

export const headlessStockfishAnalysisProvider = createStockfishAnalysisProvider(createNodeTransport)
