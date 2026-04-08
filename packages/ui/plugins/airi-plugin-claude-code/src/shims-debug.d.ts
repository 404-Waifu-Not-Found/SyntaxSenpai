declare module 'debug' {
  // Minimal shim for debug library types used in this project.
  function createDebugger(namespace?: string): any
  namespace createDebugger {
    export function enable(ns: string): void
    export function disable(): string
  }
  export = createDebugger
}
