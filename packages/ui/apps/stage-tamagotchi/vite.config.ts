import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      // Point the electron-screen-capture main entry to the built dist file in the workspace
      '@proj-airi/electron-screen-capture/main': path.resolve(__dirname, '../../packages/electron-screen-capture/dist/main.mjs'),
    },
  },
})
