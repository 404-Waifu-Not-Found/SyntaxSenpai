import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = await mkdtemp('/tmp/syntax-native-')
const helper = process.env.SYNTAX_NATIVE_HELPER || path.resolve('resources/native/syntax-computer')
const bundle = path.join(root, 'SyntaxNativeFixture.app')
const contents = path.join(bundle, 'Contents')
const executable = path.join(contents, 'MacOS', 'SyntaxNativeFixture')
const file = path.join(root, 'native-fixture.txt')
await mkdir(path.dirname(executable), { recursive: true })
const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64'
execFileSync('swiftc', ['-target', `${architecture}-apple-macos13.0`, path.resolve('e2e/fixtures/NativeInputFixture.swift'), '-o', executable, '-framework', 'AppKit'])
await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>SyntaxNativeFixture</string>
<key>CFBundleIdentifier</key><string>com.syntaxsenpai.native-input-fixture</string>
<key>CFBundleName</key><string>SyntaxNativeFixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`)

const child = spawn(helper, [], { stdio: 'pipe' })
const pending = new Map()
let sequence = 0
createInterface({ input: child.stdout }).on('line', line => {
  const data = JSON.parse(line)
  const request = pending.get(data.id)
  if (request) {
    pending.delete(data.id)
    data.error ? request.reject(Error(data.error)) : request.resolve(data.result)
  }
})
const call = (method, args = {}) => new Promise((resolve, reject) => {
  const id = String(++sequence)
  pending.set(id, { resolve, reject })
  child.stdin.write(`${JSON.stringify({ id, method, args })}\n`)
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const fixtureId = 'com.syntaxsenpai.native-input-fixture'

try {
  const status = await call('status')
  assert.equal(status.accessibility, true, 'macOS Accessibility permission is required for the actual helper')
  assert.equal(status.postEvents, true, 'macOS event-posting permission is required for native input')
  execFileSync('open', ['-n', bundle, '--args', file])

  let observation
  let lastError
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      observation = await call('observe', { app_id: fixtureId })
      if (observation.windowId === 'SyntaxSenpai Native Fixture' && observation.elements.some(element => element.role === 'AXTextArea')) break
    } catch (error) { lastError = error }
    await delay(100)
  }
  assert(observation?.elements.some(element => element.role === 'AXTextArea'), `Fixture must expose its text area. Last error: ${lastError}`)

  const input = async (method, args = {}) => {
    try {
      let current = await call('observe', { app_id: fixtureId })
      await call('focus', { observation_id: current.id, app_id: fixtureId })
      current = await call('observe', { app_id: fixtureId })
      assert.equal(current.windowId, 'SyntaxSenpai Native Fixture', 'Fixture window changed during native input test')
      return await call(method, { observation_id: current.id, ...args })
    } catch (error) {
      throw new Error(`${method} failed: ${error.message}`)
    }
  }

  await call('focus', { observation_id: observation.id, app_id: fixtureId })
  observation = await call('observe', { app_id: fixtureId })
  const text = observation.elements.find(element => element.role === 'AXTextArea')
  try { await call('click', { observation_id: observation.id, element_id: text.id }) } catch (error) { throw new Error(`click failed: ${error.message}`) }
  await assert.rejects(call('click', { observation_id: observation.id, element_id: text.id }), /Stale observation/)

  await input('key', { key: 'cmd+a' })
  const content = 'SyntaxSenpai native input verified — 你好 🌸\nKeyboard, mouse and Unicode.\n'
  await input('type', { text: content })
  await input('key', { key: 'cmd+s' })
  for (let attempt = 0; attempt < 30 && await readFile(file, 'utf8') !== content; attempt++) await delay(100)
  assert.equal(await readFile(file, 'utf8'), content)

  await input('scroll', { dy: -300, dx: 0 })
  observation = await call('observe', { app_id: fixtureId })
  await call('focus', { observation_id: observation.id, app_id: fixtureId })
  observation = await call('observe', { app_id: fixtureId })
  const area = observation.elements.find(element => element.role === 'AXTextArea').bounds
  await call('drag', { observation_id: observation.id, x: area.x + 20, y: area.y + 10, to_x: area.x + 120, to_y: area.y + 10 })
  await call('stop')
  observation = await call('observe', { app_id: fixtureId })
  assert(observation.elements.some(element => (element.value || '').includes('SyntaxSenpai')))
  await input('key', { key: 'cmd+w' })

  const report = {
    passed: true,
    helper,
    status,
    file,
    checks: ['focus', 'accessibility target click', 'stale observation rejection', 'Unicode typing', 'keyboard shortcuts', 'save/readback', 'scroll', 'drag', 'emergency release', 'observed resulting text']
  }
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  try { execFileSync('pkill', ['-x', 'SyntaxNativeFixture']) } catch {}
  await call('stop').catch(() => {})
  child.stdin.end()
}
