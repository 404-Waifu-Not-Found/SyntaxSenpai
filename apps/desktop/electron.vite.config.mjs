import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    entry: 'src/main/index.ts',
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'keytar', 'expo-secure-store', 'expo']
      },
      outDir: 'dist/main'
    }
  },
  preload: {
    entry: 'src/preload/index.ts',
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload'
    }
  },
  renderer: {
    entry: 'src/renderer/index.html',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src/renderer/src')
      }
    },
    plugins: [vue(), UnoCSS()],
    optimizeDeps: {
      exclude: ['expo-secure-store', 'expo', 'keytar', 'better-sqlite3']
    },
    build: {
      rollupOptions: {
        external: ['expo-secure-store', 'expo', 'keytar', 'better-sqlite3']
      },
      outDir: 'dist/renderer'
    }
  }
})
