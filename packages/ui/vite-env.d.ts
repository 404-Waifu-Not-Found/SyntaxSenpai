/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_POSTHOG?: string
  readonly VITE_POSTHOG_PROJECT_KEY_WEB?: string
  readonly VITE_POSTHOG_PROJECT_KEY_DESKTOP?: string
  readonly VITE_POSTHOG_PROJECT_KEY_POCKET?: string
  readonly VITE_POSTHOG_PROJECT_KEY_DOCS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  readonly dirname: string
  readonly main?: boolean
}

// Virtual modules used by unplugin/vite plugins
declare module 'virtual:generated-layouts' {
  export function setupLayouts(routes: any): any
  export default setupLayouts
}

declare module 'virtual:generated-pages' {
  const pages: any
  export default pages
}

declare module 'virtual:pwa-register' {
  export function registerSW(options?: any): () => void
  export default registerSW
}

declare module 'virtual:generated-sitemap' {
  const sitemap: any
  export default sitemap
}

declare module 'virtual:generated-theme' {
  const theme: any
  export default theme
}

declare module '*?asset' {
  const src: string
  export default src
}

declare module '~build/*' {
  const value: any
  export default value
}

declare module '~build/git' {
  export const committerDate: string
  export const abbreviatedSha: string
  export const branch: string
  export default { committerDate: string, abbreviatedSha: string, branch: string }
}

declare module '*.yaml' {
  const content: any
  export default content
}

declare module 'virtual:drizzle-migrations.sql' {
  const migrations: string
  export default migrations
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<any, any, any>
  export default component
  export type Props = Record<string, any>
}

declare module 'vite-plugin-inspect' {
  import type { Plugin } from 'vite'
  const plugin: () => Plugin
  export default plugin
}

declare module '@proj-airi/electron-screen-capture' {
  export type SerializableDesktopCapturerSource = any
  const _default: any
  export default _default
}

declare module '@proj-airi/electron-screen-capture/main' {
  export function initScreenCaptureForMain(...args: any[]): void
  export function initScreenCaptureForWindow(...args: any[]): void
  const _default: any
  export default _default
}

declare module '@proj-airi/electron-screen-capture/vue' {
  export function useElectronScreenCapture(ipcRenderer: any, options?: any): any
}

declare module '@proj-airi/electron-screen-capture/renderer' {
  export function setupElectronScreenCapture(context: any): any
  export default any
}


declare module 'posthog-js' {
  export type PostHogConfig = any
  export function init(key: string, config?: PostHogConfig): any
  const posthog: any
  export default posthog
}

declare module '@proj-airi/*' {
  const _any: any
  export default _any
  export const __any: any
}
