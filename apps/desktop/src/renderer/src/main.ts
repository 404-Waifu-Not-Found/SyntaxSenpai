import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

import '@unocss/reset/tailwind.css'
import 'uno.css'
import '@syntax-senpai/ui/main.css'

if (typeof (globalThis as any).process === 'undefined') {
  ;(globalThis as any).process = { env: {} }
}

// Surface unexpected failures instead of swallowing them. App.vue listens on
// the 'app:error' custom event and shows a toast.
window.addEventListener('error', (event) => {
  const message = event.error?.message || event.message || 'Unknown error'
  console.error('[renderer] window error:', event.error || event.message)
  window.dispatchEvent(new CustomEvent('app:error', { detail: message }))
})
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const message = reason?.message || (typeof reason === 'string' ? reason : 'Unhandled rejection')
  console.error('[renderer] unhandledRejection:', reason)
  window.dispatchEvent(new CustomEvent('app:error', { detail: message }))
})

const APP_FONTS = [
  ['DM Sans', 400],
  ['DM Sans', 500],
  ['DM Sans', 600],
  ['DM Sans', 700],
  ['Comfortaa', 400],
  ['Comfortaa', 700],
  ['Nunito', 400],
  ['Nunito', 700],
  ['JetBrains Mono', 400],
  ['JetBrains Mono', 500],
] as const

async function warmAppFonts() {
  if (!document.fonts) return

  const fontLoads = Promise.all(
    APP_FONTS.map(([family, weight]) => document.fonts.load(`${weight} 16px "${family}"`)),
  )
  const timeout = new Promise<void>(resolve => window.setTimeout(resolve, 1500))

  // Never hold the app hostage to a font server. If a face is unavailable,
  // the explicit stacks in uno.config.ts provide a stable local fallback.
  await Promise.race([fontLoads, timeout]).catch(error => {
    console.warn('[renderer] font warm-up failed; using fallback stacks:', error)
  })
}

async function bootstrap() {
  await warmAppFonts()
  const app = createApp(App)
  app.use(createPinia())
  app.mount('#app')
}

void bootstrap()
