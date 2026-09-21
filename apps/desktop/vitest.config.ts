import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({ resolve: { alias: { '@syntax-senpai/agent-tools/catalog': path.resolve(__dirname, '../../packages/agent-tools/src/catalog.ts'), ...Object.fromEntries(['ai-core','agent-tools','waifu-core','storage','game-engine','logger','ws-protocol','wechat-ilink'].map(name => ['@syntax-senpai/' + name, path.resolve(__dirname, '../../packages', name, 'src')])) } }, test: { environment: 'node', exclude: ['**/node_modules/**', '**/dist*/**', '**/e2e/**'] } })
