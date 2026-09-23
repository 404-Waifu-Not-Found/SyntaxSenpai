import { _electron as electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'syntax-minigames-'))
const env = { ...process.env, NODE_ENV: 'production', SYNTAX_SENPAI_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE

let app
try {
  app = await electron.launch({ args: [path.resolve('dist/main/index.js')], cwd: process.cwd(), env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => {
    localStorage.setItem('syntax-senpai-setup', JSON.stringify({
      waifuId: 'aria', provider: 'lmstudio', model: 'fixture', hasSetup: true, demo: true,
    }))
    localStorage.setItem('syntax-senpai-theme', JSON.stringify({
      colors: { surface: '#123456', primary: '#46a5bd', accent: '#d876ab' },
      rainbow: { enabled: false },
    }))
  })
  await page.reload()

  const launcher = page.getByRole('button', { name: 'Open mini-game center' })
  await launcher.waitFor({ state: 'visible' })
  const windowCount = app.windows().length
  const choose = async (name) => {
    await launcher.click()
    await page.locator('.game-picker-strip').getByRole('button', { name, exact: true }).click()
    await page.locator('.game-chat-aside').waitFor({ state: 'visible' })
    assert.equal(app.windows().length, windowCount, `${name} opened a separate window`)
    assert(await page.locator('#chat-input').isVisible(), `${name} hid the chat input`)
  }

  await choose('Tic-Tac-Toe')
  assert.equal(await page.locator('.mini-game-tic-cell').count(), 9)
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()), '#46a5bd')
  assert.equal(await page.locator('.mini-game-panel').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(18, 52, 86)')
  await page.getByRole('button', { name: 'Tic-Tac-Toe square 1' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.mini-game-tic-cell')].some(cell => cell.textContent?.trim() === 'O'))

  await choose('Connect Four')
  assert.equal(await page.locator('.mini-game-disc').count(), 42)
  await page.getByRole('button', { name: 'Drop in column 1' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.mini-game-disc-human').length === 1 && document.querySelectorAll('.mini-game-disc-agent').length === 1)

  await choose('Chess')
  assert.equal(await page.locator('.mini-game-chess-cell').count(), 64)
  await page.getByRole('button', { name: /e2, white p/ }).click()
  assert.equal(await page.getByRole('button', { name: /e2, white p/ }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: /e4, empty/ }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.mini-game-chess-cell')].some(cell => cell.getAttribute('aria-label')?.startsWith('e4, white p')))

  await choose('Gomoku')
  assert.equal(await page.locator('.gomoku-cell').count(), 225)
  assert.equal(await page.locator('.gomoku-panel').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(18, 52, 86)')
  await page.locator('.gomoku-cell').nth(112).click()
  await page.waitForFunction(() => document.querySelectorAll('.gomoku-stone').length >= 2)

  await choose('Fate Wheel')
  assert.equal(await page.locator('.fate-action').count(), 2)
  assert.equal(await page.locator('.fate-game').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(18, 52, 86)')

  console.log(JSON.stringify({ passed: true, games: 5, windows: windowCount }))
} finally {
  if (app) await app.close()
}
