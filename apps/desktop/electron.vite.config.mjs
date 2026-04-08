import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceAlias = {
  '@syntax-senpai/ai-core': path.resolve(__dirname, '../../packages/ai-core/src/index.ts'),
  '@syntax-senpai/agent-tools': path.resolve(__dirname, '../../packages/agent-tools/src/index.ts'),
  '@syntax-senpai/storage': path.resolve(__dirname, '../../packages/storage/src/index.ts'),
  '@syntax-senpai/waifu-core': path.resolve(__dirname, '../../packages/waifu-core/src/index.ts'),
  '@syntax-senpai/ws-protocol': path.resolve(__dirname, '../../packages/ws-protocol/src/index.ts'),
}

export default defineConfig({
  main: {
    entry: 'src/main/index.ts',
    plugins: [externalizeDepsPlugin({
      exclude: [
        '@syntax-senpai/ai-core',
        '@syntax-senpai/agent-tools',
        '@syntax-senpai/storage',
        '@syntax-senpai/waifu-core',
        '@syntax-senpai/ws-protocol'
      ]
    })],
    resolve: {
      alias: workspaceAlias
    },
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'keytar', 'expo-secure-store', 'expo']
      },
      outDir: 'dist/main'
    }
  },
  preload: {
    entry: 'src/preload/index.ts',
    plugins: [externalizeDepsPlugin({
      exclude: [
        '@syntax-senpai/ai-core',
        '@syntax-senpai/agent-tools',
        '@syntax-senpai/storage',
        '@syntax-senpai/waifu-core',
        '@syntax-senpai/ws-protocol'
      ]
    })],
    resolve: {
      alias: workspaceAlias
    },
    build: {
      outDir: 'dist/preload'
    }
  },
  renderer: {
    entry: 'src/renderer/index.html',
    resolve: {
      alias: {
        ...workspaceAlias,
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
