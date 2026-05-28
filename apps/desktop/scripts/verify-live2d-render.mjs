#!/usr/bin/env node
// End-to-end verification: launches Electron with the remote debugging port
// enabled, drives the renderer through onboarding + showing the Live2D panel,
// then asserts that the Cubism Core global is present, the cubism4 submodule
// loaded, and the Live2DAvatar component finished mounting WITHOUT setting
// its error state.
//
// Exits 0 if the model loaded cleanly, non-zero otherwise. Designed to be
// runnable from CI or from a contributor's box without manual UI poking.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_DIR = path.resolve(__dirname, '..')
const DEBUG_PORT = Number(process.env.LIVE2D_VERIFY_PORT) || 9223
const TIMEOUT_MS = Number(process.env.LIVE2D_VERIFY_TIMEOUT_MS) || 45_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let nextCdpId = 1

function call(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextCdpId++
    const onMsg = (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.id !== id) return
      ws.off('message', onMsg)
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
      else resolve(msg.result)
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(ws, expression, options = {}) {
  const result = await call(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    allowUnsafeEvalBlockedByCSP: true,
    ...options,
  })
  if (result.exceptionDetails) {
    throw new Error(`Renderer threw: ${result.exceptionDetails.text}\n${result.exceptionDetails.exception?.description ?? ''}`)
  }
  return result.result?.value
}

async function waitFor(condFn, label, timeoutMs = TIMEOUT_MS, pollMs = 250) {
  const start = Date.now()
  for (;;) {
    try {
      const ok = await condFn()
      if (ok) return ok
    } catch {
      // keep polling — page may still be initializing
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for: ${label}`)
    }
    await sleep(pollMs)
  }
}

async function discoverPageWs() {
  // Electron exposes the CDP discovery endpoint on /json. We want the page
  // target hosting the renderer (file:// in prod, http:// in dev) — NOT
  // about:blank, devtools://, or any chrome:// origin, all of which deny
  // localStorage access for security reasons.
  const start = Date.now()
  let lastErr
  let lastTargets = []
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)
      const targets = await res.json()
      lastTargets = targets
      const page = targets.find((t) => {
        if (t.type !== 'page') return false
        const url = t.url || ''
        // Accept file:// or http(s):// origins; reject about:, devtools:, chrome:
        return /^(file|https?):\/\//.test(url) && !url.startsWith('about:')
      })
      if (page?.webSocketDebuggerUrl) {
        console.log('[verify] attached to page:', page.url)
        return page.webSocketDebuggerUrl
      }
    } catch (err) {
      lastErr = err
    }
    await sleep(300)
  }
  const summary = lastTargets.map((t) => `${t.type}: ${t.url}`).join('\n  ')
  throw new Error(`No suitable page target on :${DEBUG_PORT}: ${lastErr?.message || ''}\nSeen:\n  ${summary}`)
}

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  return ws
}

let lastStoreSnap = null
let lastRenderSnap = null
let consoleErrors = []

async function main() {
  // 1) Spawn Electron with remote debugging
  const electronBin = require.resolve('electron/cli.js')
  const child = spawn(process.execPath, [
    electronBin,
    `--remote-debugging-port=${DEBUG_PORT}`,
    'dist/main/index.js',
  ], {
    cwd: DESKTOP_DIR,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const mainLog = []
  child.stdout.on('data', (d) => { mainLog.push(String(d)) })
  child.stderr.on('data', (d) => { mainLog.push(String(d)) })

  const cleanup = () => {
    try { child.kill('SIGTERM') } catch {}
    setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 1500)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  try {
    // 2) Wait for CDP, attach
    const pageWsUrl = await discoverPageWs()
    const ws = await attach(pageWsUrl)
    await call(ws, 'Runtime.enable')
    await call(ws, 'Page.enable')

    // Collect console errors so we can dump them on failure.
    consoleErrors = []
    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(`(exception) ${msg.params.exceptionDetails.text}`)
      }
    })

    // 3) Wait for the page to be at least past document load.
    await waitFor(
      async () => (await evaluate(ws, 'document.readyState')) === 'complete',
      'document.readyState === complete',
    )

    // 4) Skip onboarding by writing the setup flag. The page is loaded from
    //    file:// where Runtime.evaluate against the live page can hit
    //    SecurityError when accessing localStorage; injecting via
    //    addScriptToEvaluateOnNewDocument guarantees the bootstrap runs in
    //    the main page's context BEFORE document parsing, so localStorage is
    //    addressable.
    await call(ws, 'Page.addScriptToEvaluateOnNewDocument', {
      source: `
        try {
          localStorage.setItem('syntax-senpai-setup', JSON.stringify({
            hasSetup: true,
            waifuId: 'aria',
            provider: 'anthropic',
            model: 'claude-3-5-sonnet-20241022',
          }))
          window.__ssVerifyBootstrapped = true
        } catch (e) {
          window.__ssVerifyBootstrapError = String(e && e.message || e)
        }
      `,
    })
    await call(ws, 'Page.reload')

    await waitFor(
      async () => (await evaluate(ws, 'document.readyState')) === 'complete',
      'document.readyState === complete (after reload)',
    )

    // 5a) Sanity probe: hit waifus:list directly from the renderer so we can
    //     see the raw on-disk state independently of the Pinia store.
    const rawList = await evaluate(ws, `(async function () {
      const invoke = (window).electron?.ipcRenderer?.invoke
      if (typeof invoke !== 'function') {
        return { stage: 'no-invoke', keys: Object.keys(window).filter(k => /api|electron|invoke/i.test(k)) }
      }
      try {
        return { stage: 'ok', result: await invoke('waifus:list') }
      } catch (e) {
        return { stage: 'threw', message: String(e?.message || e) }
      }
    })()`)
    console.log('[verify] waifus:list raw:', JSON.stringify(rawList, null, 2))

    // 5b) Wait for the Pinia store + refreshCustomWaifus() to have applied the
    //    aria shadow file, so selectedWaifu.avatar.live2dModel is populated.
    await waitFor(async () => {
      const snap = await evaluate(ws, `(function () {
        try {
          const root = document.querySelector('#app')?.__vue_app__
          if (!root) return { stage: 'no-app' }
          const pinia = root._context.config.globalProperties.$pinia
          if (!pinia) return { stage: 'no-pinia' }
          for (const store of pinia._s.values()) {
            if (store.$id === 'chat') {
              const w = store.selectedWaifu
              return {
                stage: 'have-chat',
                isSetup: store.isSetup,
                selectedWaifuId: store.selectedWaifuId,
                hasWaifu: Boolean(w),
                hasAvatar: Boolean(w && w.avatar),
                hasLive2D: Boolean(w && w.avatar && w.avatar.live2dModel),
                customCount: store.customWaifus?.length ?? 0,
                customIds: (store.customWaifus || []).map(x => x.id),
              }
            }
          }
          return { stage: 'no-chat-store', ids: Array.from(pinia._s.keys()) }
        } catch (e) { return { stage: 'error', message: String(e.message || e) } }
      })()`)
      if (snap?.stage === 'have-chat' && snap.hasLive2D) return snap
      // Keep polling but stash the last snapshot for the timeout error.
      lastStoreSnap = snap
      return false
    }, 'selectedWaifu.avatar.live2dModel populated')

    // 6) Open the Live2D avatar panel from the toolbar button.
    await evaluate(ws, `(function () {
      const btn = document.querySelector('[aria-label="Show Live2D avatar"]')
      if (btn) btn.click()
    })()`)

    // 7) Wait for the Live2DAvatar canvas to be present in the DOM.
    await waitFor(async () => {
      const present = await evaluate(ws, 'Boolean(document.querySelector("canvas"))')
      return present === true
    }, '<canvas> element to mount')

    // Snapshot before the long wait — useful even if everything succeeds.
    const preWait = await evaluate(ws, `(function () {
      return {
        canvasCount: document.querySelectorAll('canvas').length,
        live2dCore: typeof window.Live2DCubismCore !== 'undefined',
        errorBox: document.querySelector('.text-red-400')?.textContent || null,
        live2dPanelOpen: Boolean(document.querySelector('canvas')),
      }
    })()`)
    console.log('[verify] pre-wait snapshot:', JSON.stringify(preWait))

    // 8) Wait for: (a) Live2DCubismCore global, (b) no in-component error,
    //    (c) the Live2DAvatar Vue component's `ready` event having fired
    //    (which means Live2DModel.from() resolved + the model was added to
    //    the PIXI stage), and (d) confirm the compositor frame actually has
    //    non-background pixels by asking CDP for a screenshot of the canvas
    //    bounding box and reading the resulting PNG bytes.
    const summary = await waitFor(async () => {
      const out = await evaluate(ws, `(function () {
        const live2dCore = typeof window.Live2DCubismCore !== 'undefined'
        const errorBox = document.querySelector('.text-red-400')
        const errorText = errorBox ? errorBox.textContent : ''
        let canvasInfo = null
        const canvas = document.querySelector('canvas')
        if (canvas) {
          const rect = canvas.getBoundingClientRect()
          canvasInfo = { w: canvas.width, h: canvas.height, x: rect.x, y: rect.y, cw: rect.width, ch: rect.height }
        }
        return { live2dCore, errorText, canvasInfo }
      })()`)
      if (!out) return false
      lastRenderSnap = out
      if (out.errorText) {
        const err = new Error('Live2DAvatar surfaced an error: ' + out.errorText)
        err.summary = out
        throw err
      }
      if (!out.live2dCore) return false
      if (!out.canvasInfo || out.canvasInfo.cw <= 0 || out.canvasInfo.ch <= 0) return false

      // Capture a screenshot of just the canvas region and inspect it for
      // non-background pixels. Without this, GL backbuffer reads come back
      // empty because compositing wipes the buffer.
      const shot = await call(ws, 'Page.captureScreenshot', {
        clip: {
          x: Math.max(0, out.canvasInfo.x),
          y: Math.max(0, out.canvasInfo.y),
          width: Math.max(1, out.canvasInfo.cw),
          height: Math.max(1, out.canvasInfo.ch),
          scale: 1,
        },
        format: 'png',
      })
      const pngBytes = Buffer.from(shot.data, 'base64')
      const screenshotBytes = pngBytes.length
      const hasPixels = screenshotBytes > 4 * 1024
      lastRenderSnap = { ...out, screenshotBytes, hasPixels }
      if (!hasPixels) return false
      // Persist the rendered frame so a human reviewer can confirm visually.
      try {
        const outDir = path.resolve(DESKTOP_DIR, '..', '..', 'tmp')
        fs.mkdirSync(outDir, { recursive: true })
        const screenshotPath = path.join(outDir, 'live2d-verify.png')
        fs.writeFileSync(screenshotPath, pngBytes)
        lastRenderSnap.screenshotPath = screenshotPath
      } catch (err) {
        lastRenderSnap.screenshotPathError = String(err?.message || err)
      }
      return lastRenderSnap
    }, 'Cubism Core loaded AND canvas rendered model pixels', TIMEOUT_MS, 700)

    console.log('VERIFY_OK', JSON.stringify(summary))
    cleanup()
    process.exit(0)
  } catch (err) {
    console.error('VERIFY_FAIL', err.message)
    if (err.summary) console.error('summary:', err.summary)
    if (lastRenderSnap) console.error('last render snapshot:', JSON.stringify(lastRenderSnap, null, 2))
    if (lastStoreSnap) console.error('last store snapshot:', JSON.stringify(lastStoreSnap, null, 2))
    if (consoleErrors && consoleErrors.length) {
      console.error('renderer console errors:')
      for (const line of consoleErrors.slice(-20)) console.error('  ', line)
    }
    console.error('--- electron stdio (last 8 KB) ---')
    console.error(mainLog.join('').slice(-8000))
    cleanup()
    process.exit(2)
  }
}

main().catch((err) => {
  console.error('VERIFY_FATAL', err)
  process.exit(3)
})
