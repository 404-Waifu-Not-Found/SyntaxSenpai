import { createLogger } from '@syntax-senpai/logger'

export const mainLogger = createLogger({
  name: 'desktop-main',
  bindings: { process: 'main' }
})
