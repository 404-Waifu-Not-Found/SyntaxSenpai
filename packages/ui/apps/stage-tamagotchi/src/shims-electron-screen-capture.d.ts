declare module '@proj-airi/electron-screen-capture/main' {
  // Minimal ambient declaration to satisfy workspace typecheck when package dist isn't built.
  export function initScreenCaptureForMain(...args: any[]): void
  export function initScreenCaptureForWindow(...args: any[]): void
  const _default: any
  export default _default
}

declare module '@proj-airi/electron-screen-capture' {
  export type SerializableDesktopCapturerSource = any
  const _default: any
  export default _default
}

declare module '@proj-airi/electron-screen-capture/vue' {
  export function useElectronScreenCapture(ipcRenderer: any, options?: any): any
}

declare module '@proj-airi/electron-screen-capture/renderer' {
  export function setupElectronScreenCapture(context: any): any
  const _default: any
  export default _default
}
