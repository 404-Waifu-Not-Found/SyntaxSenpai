import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/evaluate.test.ts'],
    environment: 'node'
  }
})
