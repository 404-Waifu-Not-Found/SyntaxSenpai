import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Vue from '@vitejs/plugin-vue'
import Unocss from 'unocss/vite'
import VueRouter from 'unplugin-vue-router/vite'

import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    // https://github.com/posva/unplugin-vue-router
    VueRouter({
      extensions: ['.vue', '.md'],
      dts: resolve(fileURLToPath(new URL('.', import.meta.url)), 'src', 'typed-router.d.ts'),
    }),
    Vue(),
    // https://github.com/antfu/unocss
    // see uno.config.ts for config
    Unocss(),
  ],
})
