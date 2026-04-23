import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const srcDir = path.join(rootDir, 'src')
const distDir = path.join(rootDir, 'dist')
const monorepoRoot = path.resolve(rootDir, '..', '..')

fs.rmSync(distDir, { recursive: true, force: true })
fs.mkdirSync(distDir, { recursive: true })
fs.cpSync(srcDir, distDir, { recursive: true })

// Inline workspace deps so the runtime is self-contained in Docker.
const workspaceDeps = ['@syntax-senpai/logger']
for (const dep of workspaceDeps) {
  const [scope, name] = dep.split('/')
  const depSrc = path.join(monorepoRoot, 'packages', name)
  const depDst = path.join(distDir, 'node_modules', scope, name)
  fs.mkdirSync(depDst, { recursive: true })
  fs.cpSync(path.join(depSrc, 'src'), path.join(depDst, 'src'), { recursive: true })
  fs.cpSync(path.join(depSrc, 'package.json'), path.join(depDst, 'package.json'))
}
