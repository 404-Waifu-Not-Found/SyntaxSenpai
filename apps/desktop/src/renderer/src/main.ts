import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

import '@unocss/reset/tailwind.css'
import 'uno.css'
import '@syntax-senpai/ui/main.css'

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

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
