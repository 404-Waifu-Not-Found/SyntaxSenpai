const { join } = require('path')
const { copyFileSync, mkdirSync, existsSync } = require('fs')

const root = join(__dirname, '..')
const source = join(__dirname, 'build', 'Release', 'cubism_native.node')
const destinationDir = join(root, 'dist', 'preload')
const destination = join(destinationDir, 'cubism_native.node')

if (!existsSync(source)) {
  throw new Error(`Native addon not found at ${source}. Run pnpm build:native first.`)
}

mkdirSync(destinationDir, { recursive: true })
copyFileSync(source, destination)
console.log(`Copied native Cubism addon to ${destination}`)
