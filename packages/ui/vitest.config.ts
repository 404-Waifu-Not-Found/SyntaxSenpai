import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      path.resolve(__dirname, 'apps/server'),
      path.resolve(__dirname, 'apps/ui-server-auth'),
      path.resolve(__dirname, 'apps/stage-tamagotchi'),
      path.resolve(__dirname, 'packages/audio-pipelines-transcribe'),
      path.resolve(__dirname, 'packages/cap-vite'),
      path.resolve(__dirname, 'packages/vishot-runner-browser'),
      path.resolve(__dirname, 'packages/plugin-sdk'),
      path.resolve(__dirname, 'packages/server-runtime'),
      path.resolve(__dirname, 'packages/server-sdk'),
      path.resolve(__dirname, 'packages/stage-shared'),
      path.resolve(__dirname, 'packages/stage-ui'),
      path.resolve(__dirname, 'packages/vishot-runtime'),
      path.resolve(__dirname, 'packages/vite-plugin-warpdrive'),
    ],
  },
})
