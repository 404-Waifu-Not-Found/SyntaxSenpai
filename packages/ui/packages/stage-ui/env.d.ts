/// <reference types="@histoire/plugin-vue/components.d.ts" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<any, any, any>
  export default component
  export type Props = Record<string, any>
}

declare module 'posthog-js' {
  export type PostHogConfig = any
  const posthog: any
  export default posthog
}
