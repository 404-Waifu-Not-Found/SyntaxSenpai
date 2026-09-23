import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
if (process.platform === 'darwin') {
  const root = fileURLToPath(new URL('../', import.meta.url))
  mkdirSync(root + 'resources/native', { recursive: true })
  const out = spawnSync('xcrun', ['swiftc', '-O', '-framework', 'AppKit', '-framework', 'ApplicationServices', root + 'native/ComputerHelper.swift', '-o', root + 'resources/native/syntax-computer'], { stdio: 'inherit' })
  if (out.status !== 0) process.exit(out.status || 1)
}
