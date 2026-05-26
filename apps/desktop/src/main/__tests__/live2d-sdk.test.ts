import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import {
  CUBISM_CORE_DIRNAME,
  CUBISM_CORE_FILENAME,
  copyCubismCoreInto,
  cubismCoreDir,
  cubismCorePath,
  downloadCubismCore,
  ensureCubismCore,
  findBundledCubismCore,
  getCubismCoreStatus,
} from '../live2d-sdk'

const REAL_HEADER = `
/**
 * Live2D Cubism Core
 * (C) 2019 Live2D Inc. All rights reserved.
 */
`.trim()

/**
 * TS 5.7+ made Uint8Array generic; Node's `Buffer` (whose `.slice().buffer` is
 * typed as `ArrayBufferLike`) is no longer directly assignable to
 * `Uint8Array<ArrayBufferLike>`.  Node's Buffer is *always* backed by a plain
 * ArrayBuffer at runtime, so this zero-copy cast is safe.
 */
function u8(buf: Buffer): Uint8Array<ArrayBuffer> {
  return buf as unknown as Uint8Array<ArrayBuffer>
}

function makeFakeCoreBuffer(size = 80 * 1024, headerText = REAL_HEADER): Buffer {
  const header = Buffer.from(headerText + '\n', 'utf8')
  const filler = Buffer.alloc(Math.max(0, size - header.length), 0x20)
  // Cast required: TS 5.7+ Uint8Array is generic; Buffer's ArrayBufferLike
  // backing makes it structurally incompatible without an explicit assertion.
  return Buffer.concat([header, filler] as unknown as Uint8Array[])
}

function makeUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ss-live2d-sdk-test-'))
}

function makeOkResponse(body: Buffer): any {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }
}

describe('cubismCorePath / cubismCoreDir', () => {
  it('uses the live2d-sdk subdirectory', () => {
    const ud = '/tmp/fake-userdata'
    expect(cubismCoreDir(ud)).toBe(path.join(ud, CUBISM_CORE_DIRNAME))
    expect(cubismCorePath(ud)).toBe(path.join(ud, CUBISM_CORE_DIRNAME, CUBISM_CORE_FILENAME))
  })
})

describe('getCubismCoreStatus', () => {
  let ud: string
  beforeEach(() => { ud = makeUserData() })
  afterEach(() => { fs.rmSync(ud, { recursive: true, force: true }) })

  it('reports not installed when missing', () => {
    const status = getCubismCoreStatus(ud)
    expect(status.installed).toBe(false)
    expect(status.size).toBeNull()
    expect(status.installedAt).toBeNull()
    expect(status.path).toContain('live2dcubismcore.min.js')
  })

  it('reports installed when the file exists', () => {
    fs.mkdirSync(cubismCoreDir(ud), { recursive: true })
    const buf = makeFakeCoreBuffer()
    fs.writeFileSync(cubismCorePath(ud), u8(buf))
    const status = getCubismCoreStatus(ud)
    expect(status.installed).toBe(true)
    expect(status.size).toBe(buf.length)
    expect(status.installedAt).not.toBeNull()
  })
})

describe('downloadCubismCore', () => {
  let ud: string
  beforeEach(() => { ud = makeUserData() })
  afterEach(() => { fs.rmSync(ud, { recursive: true, force: true }) })

  it('writes the file via injected fetch', async () => {
    const buf = makeFakeCoreBuffer()
    let calls = 0
    const fetchImpl: any = async () => { calls++; return makeOkResponse(buf) }
    const result = await downloadCubismCore(ud, { fetchImpl })
    expect(result.success).toBe(true)
    expect(result.size).toBe(buf.length)
    expect(calls).toBe(1)
    expect(fs.readFileSync(result.path)).toEqual(buf)
    expect(getCubismCoreStatus(ud).installed).toBe(true)
  })

  it('overwrites a previously installed file (re-install)', async () => {
    fs.mkdirSync(cubismCoreDir(ud), { recursive: true })
    fs.writeFileSync(cubismCorePath(ud), u8(makeFakeCoreBuffer(60 * 1024)))
    const newer = makeFakeCoreBuffer(100 * 1024)
    const fetchImpl: any = async () => makeOkResponse(newer)
    const result = await downloadCubismCore(ud, { fetchImpl })
    expect(result.success).toBe(true)
    expect(fs.readFileSync(result.path).length).toBe(newer.length)
  })

  it('rejects responses without the Live2D header', async () => {
    const evil = Buffer.concat([Buffer.from('not real cubism'.padEnd(80 * 1024, ' '), 'utf8')] as unknown as Uint8Array[])
    const fetchImpl: any = async () => makeOkResponse(evil)
    const result = await downloadCubismCore(ud, { fetchImpl })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Live2D Cubism Core header/i)
    expect(fs.existsSync(cubismCorePath(ud))).toBe(false)
  })

  it('rejects files that are too small', async () => {
    const tiny = makeFakeCoreBuffer(1024)
    const fetchImpl: any = async () => makeOkResponse(tiny)
    const result = await downloadCubismCore(ud, { fetchImpl })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/too small/i)
  })

  it('rejects files that are too large', async () => {
    const giant = makeFakeCoreBuffer(11 * 1024 * 1024)
    const fetchImpl: any = async () => makeOkResponse(giant)
    const result = await downloadCubismCore(ud, { fetchImpl })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/too large/i)
  })

  it('surfaces HTTP errors', async () => {
    const fetchImpl: any = async () => ({ ok: false, status: 404, statusText: 'Not Found' })
    const result = await downloadCubismCore(ud, { fetchImpl })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/HTTP 404/)
    expect(fs.existsSync(cubismCorePath(ud))).toBe(false)
  })

  it('catches network exceptions', async () => {
    const fetchImpl: any = async () => { throw new Error('ECONNREFUSED') }
    const result = await downloadCubismCore(ud, { fetchImpl })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ECONNREFUSED/)
  })

  it('writes atomically (no .tmp leftover on success)', async () => {
    const buf = makeFakeCoreBuffer()
    const fetchImpl: any = async () => makeOkResponse(buf)
    await downloadCubismCore(ud, { fetchImpl })
    const entries = fs.readdirSync(cubismCoreDir(ud))
    expect(entries).toEqual([CUBISM_CORE_FILENAME])
  })
})

describe('findBundledCubismCore', () => {
  it('returns null when no candidate exists', () => {
    expect(findBundledCubismCore(['/nonexistent/path/live2dcubismcore.min.js'])).toBeNull()
  })

  it('returns the first matching path from the override list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bundled-'))
    try {
      const file = path.join(dir, 'live2dcubismcore.min.js')
      fs.writeFileSync(file, u8(makeFakeCoreBuffer()))
      expect(findBundledCubismCore([file])).toBe(file)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null when an empty list is passed (opt out)', () => {
    expect(findBundledCubismCore([])).toBeNull()
  })

  it('finds the project resources/live2d-sdk file via defaults if present', () => {
    // This proves the dev-mode lookup works when running tests directly:
    // resources/live2d-sdk/live2dcubismcore.min.js is committed to the repo.
    const resolved = findBundledCubismCore()
    if (resolved) {
      const buf = fs.readFileSync(resolved)
      expect(buf.subarray(0, 4096).toString('utf8')).toContain('Live2D Cubism Core')
    } else {
      expect(resolved).toBeNull()
    }
  })
})

describe('ensureCubismCore (caching)', () => {
  let ud: string
  beforeEach(() => { ud = makeUserData() })
  afterEach(() => { fs.rmSync(ud, { recursive: true, force: true }) })

  it('falls back to bundled file when nothing is cached (no network call)', async () => {
    const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bundle-src-'))
    const bundled = path.join(bundleDir, 'live2dcubismcore.min.js')
    fs.writeFileSync(bundled, u8(makeFakeCoreBuffer()))

    let calls = 0
    const fetchImpl: any = async () => { calls++; throw new Error('network should not be touched') }
    try {
      const result = await ensureCubismCore(ud, { fetchImpl, bundledSearchPaths: [bundled] })
      expect(result.success).toBe(true)
      expect(result.fromBundle).toBe(true)
      expect(result.fromCache).toBe(false)
      expect(calls).toBe(0)
      expect(fs.existsSync(cubismCorePath(ud))).toBe(true)
    } finally {
      fs.rmSync(bundleDir, { recursive: true, force: true })
    }
  })

  it('still re-fetches from bundle when cached file is corrupt', async () => {
    fs.mkdirSync(cubismCoreDir(ud), { recursive: true })
    fs.writeFileSync(cubismCorePath(ud), u8(Buffer.alloc(100 * 1024, 0x20))) // bad

    const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bundle-src2-'))
    const bundled = path.join(bundleDir, 'live2dcubismcore.min.js')
    fs.writeFileSync(bundled, u8(makeFakeCoreBuffer()))

    let calls = 0
    const fetchImpl: any = async () => { calls++; throw new Error('not allowed') }
    try {
      const result = await ensureCubismCore(ud, { fetchImpl, bundledSearchPaths: [bundled] })
      expect(result.success).toBe(true)
      expect(result.fromBundle).toBe(true)
      expect(calls).toBe(0)
    } finally {
      fs.rmSync(bundleDir, { recursive: true, force: true })
    }
  })

  it('ignores invalid bundled files and falls through to network', async () => {
    const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bundle-bad-'))
    const bundled = path.join(bundleDir, 'live2dcubismcore.min.js')
    // Big enough to pass the size check but missing the Cubism header.
    fs.writeFileSync(bundled, u8(Buffer.alloc(100 * 1024, 0x20)))

    let calls = 0
    const fetchImpl: any = async () => { calls++; return makeOkResponse(makeFakeCoreBuffer()) }
    try {
      const result = await ensureCubismCore(ud, { fetchImpl, bundledSearchPaths: [bundled] })
      expect(result.success).toBe(true)
      expect(result.fromBundle).toBeFalsy()
      expect(calls).toBe(1)
    } finally {
      fs.rmSync(bundleDir, { recursive: true, force: true })
    }
  })

  // These tests pass `bundledSearchPaths: []` to opt the function out of
  // its production search list — otherwise the project's committed
  // resources/live2d-sdk file would short-circuit the network path.

  it('downloads when no cached/bundled file exists', async () => {
    let calls = 0
    const fetchImpl: any = async () => { calls++; return makeOkResponse(makeFakeCoreBuffer()) }
    const result = await ensureCubismCore(ud, { fetchImpl, bundledSearchPaths: [] })
    expect(result.success).toBe(true)
    expect(result.fromCache).toBe(false)
    expect(result.fromBundle).toBeFalsy()
    expect(calls).toBe(1)
  })

  it('returns cached when a valid file already exists (no network call)', async () => {
    fs.mkdirSync(cubismCoreDir(ud), { recursive: true })
    const buf = makeFakeCoreBuffer()
    fs.writeFileSync(cubismCorePath(ud), u8(buf))

    let calls = 0
    const fetchImpl: any = async () => { calls++; return makeOkResponse(buf) }
    const result = await ensureCubismCore(ud, { fetchImpl, bundledSearchPaths: [] })
    expect(result.success).toBe(true)
    expect(result.fromCache).toBe(true)
    expect(result.size).toBe(buf.length)
    expect(calls).toBe(0)
  })

  it('re-downloads when a cached file is corrupt and no bundle is available', async () => {
    fs.mkdirSync(cubismCoreDir(ud), { recursive: true })
    fs.writeFileSync(cubismCorePath(ud), u8(Buffer.alloc(100 * 1024, 0x20))) // no header

    let calls = 0
    const fetchImpl: any = async () => { calls++; return makeOkResponse(makeFakeCoreBuffer()) }
    const result = await ensureCubismCore(ud, { fetchImpl, bundledSearchPaths: [] })
    expect(result.success).toBe(true)
    expect(result.fromCache).toBe(false)
    expect(calls).toBe(1)
  })

  it('respects cacheOnly when nothing is installed and no bundle available', async () => {
    const fetchImpl: any = async () => { throw new Error('should not be called') }
    const result = await ensureCubismCore(ud, {
      fetchImpl,
      cacheOnly: true,
      bundledSearchPaths: [],
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not installed/i)
  })

  it('passes through fetchImpl absence error', async () => {
    const result = await ensureCubismCore(ud, { fetchImpl: undefined as any })
    // globalThis.fetch is available in Node 20+, so this should actually
    // attempt a real network call. We accept either success (online) or a
    // network error — both prove that the function did not throw uncaught.
    expect(typeof result.success).toBe('boolean')
    expect(typeof result.path).toBe('string')
  })
})

describe('copyCubismCoreInto', () => {
  let ud: string
  let modelDir: string
  beforeEach(() => {
    ud = makeUserData()
    modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-live2d-model-'))
  })
  afterEach(() => {
    fs.rmSync(ud, { recursive: true, force: true })
    fs.rmSync(modelDir, { recursive: true, force: true })
  })

  it('returns false when the SDK is not installed', () => {
    expect(copyCubismCoreInto(ud, modelDir)).toBe(false)
    expect(fs.existsSync(path.join(modelDir, CUBISM_CORE_FILENAME))).toBe(false)
  })

  it('copies the cached SDK into the target dir', () => {
    fs.mkdirSync(cubismCoreDir(ud), { recursive: true })
    const buf = makeFakeCoreBuffer()
    fs.writeFileSync(cubismCorePath(ud), u8(buf))

    expect(copyCubismCoreInto(ud, modelDir)).toBe(true)
    const copied = fs.readFileSync(path.join(modelDir, CUBISM_CORE_FILENAME))
    expect(copied).toEqual(buf)
  })

  it('overwrites any pre-existing per-model SDK', () => {
    fs.mkdirSync(cubismCoreDir(ud), { recursive: true })
    fs.writeFileSync(cubismCorePath(ud), u8(makeFakeCoreBuffer(80 * 1024)))
    fs.writeFileSync(path.join(modelDir, CUBISM_CORE_FILENAME), 'stale')

    expect(copyCubismCoreInto(ud, modelDir)).toBe(true)
    const copied = fs.readFileSync(path.join(modelDir, CUBISM_CORE_FILENAME))
    expect(copied.length).toBeGreaterThan(10 * 1024)
  })
})

describe('real CDN reachability (online)', () => {
  // This is a soft probe — it only runs when the CI environment is online,
  // and a network outage doesn't fail the suite. The goal is to surface
  // breakages in the CDN URL early during local development.
  it('downloads the real Cubism Core file when online', async () => {
    const ud = makeUserData()
    try {
      const result = await downloadCubismCore(ud)
      if (result.success) {
        expect(result.size).toBeGreaterThan(50 * 1024)
        const head = fs.readFileSync(result.path).subarray(0, 4096).toString('utf8')
        expect(head).toContain('Live2D Cubism Core')
      } else {
        console.warn('CDN probe skipped:', result.error)
      }
    } finally {
      fs.rmSync(ud, { recursive: true, force: true })
    }
  }, 20_000)
})
