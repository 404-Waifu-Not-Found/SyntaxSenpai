import path from 'node:path'
import process from 'node:process'

import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'

import { Transformer } from '@napi-rs/image'

const SOURCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

async function transform(filePath: string): Promise<any> {
  if ((await stat(filePath)).isDirectory()) {
    return await Promise.allSettled(
      (await readdir(filePath)).map(file => transform(path.join(filePath, file))),
    )
  }

  const ext = path.extname(filePath).toLowerCase()
  if (!SOURCE_EXTENSIONS.includes(ext))
    return
  const dist = path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}.avif`,
  )
  const fileBuffer = await readFile(filePath)
  const u8 = Uint8Array.from(fileBuffer as any)
  const avifBuffer = await new Transformer(u8).avif()
  await writeFile(dist, avifBuffer as any)
  await rm(filePath)
  console.info(`√ ${filePath} -> ${dist}`)
}

async function main() {
  const files = process.argv.slice(2).map(f => path.resolve(process.cwd(), f))
  if (files.length === 0) {
    console.error('No files provided.')
    process.exit(1)
  }

  await Promise.all(files.map(f => stat(f)))
  await Promise.allSettled(files.map(file => transform(file)))
}

main()
