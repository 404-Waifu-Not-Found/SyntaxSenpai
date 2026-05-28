/**
 * Live2D Cubism Core SDK installer.
 *
 * The Cubism Core JS is a small (~210 KB) runtime that pixi-live2d-display
 * loads via a global `<script>` tag before instantiating any Cubism-4 model.
 * It is NOT bundled with this app because Live2D Inc. requires consumers to
 * accept the Cubism Proprietary License before redistribution. Instead, we
 * fetch it from Live2D's official CDN on demand and cache it under
 * `<userData>/live2d-sdk/live2dcubismcore.min.js`.
 *
 * The renderer (`Live2DAvatar.vue`) will load the cached file via the
 * `userdata://` protocol; the import flow also copies it into each imported
 * model folder for backwards compatibility with the per-model URL derivation.
 */

import fs from 'node:fs'
import path from 'node:path'

const CUBISM_CORE_URL =
  'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'

export const CUBISM_CORE_FILENAME = 'live2dcubismcore.min.js'
export const CUBISM_CORE_DIRNAME = 'live2d-sdk'

// Sanity bounds — the official file is ~207 KB. Anything outside this window
// is almost certainly a CDN error page or a tampered response, and we'd
// rather fail loudly than cache garbage.
const MIN_CORE_BYTES = 50 * 1024
const MAX_CORE_BYTES = 10 * 1024 * 1024

const REQUIRED_HEADER_MARKER = 'Live2D Cubism Core'

export interface CubismCoreStatus {
  installed: boolean
  path: string
  size: number | null
  installedAt: string | null
}

export function cubismCoreDir(userDataDir: string): string {
  return path.join(userDataDir, CUBISM_CORE_DIRNAME)
}

export function cubismCorePath(userDataDir: string): string {
  return path.join(cubismCoreDir(userDataDir), CUBISM_CORE_FILENAME)
}

export function getCubismCoreStatus(userDataDir: string): CubismCoreStatus {
  const filePath = cubismCorePath(userDataDir)
  if (!fs.existsSync(filePath)) {
    return { installed: false, path: filePath, size: null, installedAt: null }
  }
  const stat = fs.statSync(filePath)
  return {
    installed: true,
    path: filePath,
    size: stat.size,
    installedAt: stat.mtime.toISOString(),
  }
}

export interface InstallOptions {
  /** Skip the network request if no cached or bundled copy is available. */
  cacheOnly?: boolean
  /** Override the source URL — only used by tests. */
  sourceUrl?: string
  /** Inject a custom fetch implementation — used by tests to avoid hitting the network. */
  fetchImpl?: typeof globalThis.fetch
  /** Extra paths to probe when looking for a bundled copy — used by tests. */
  bundledSearchPaths?: string[]
}

export interface InstallResult {
  success: boolean
  path: string
  size?: number
  fromCache?: boolean
  fromBundle?: boolean
  error?: string
}

/**
 * Ensure the Cubism Core JS is present in the user-data cache. Returns the
 * absolute path on success.
 *
 * Resolution order, picking the first that works:
 *   1. cached copy in `<userData>/live2d-sdk/`
 *   2. bundled copy shipped with the desktop app (so offline first-launch works)
 *   3. download from the Live2D CDN
 */
export async function ensureCubismCore(
  userDataDir: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const filePath = cubismCorePath(userDataDir)

  if (fs.existsSync(filePath)) {
    const valid = validateCachedFile(filePath)
    if (valid) {
      return { success: true, path: filePath, size: valid.size, fromCache: true }
    }
    // Otherwise fall through and re-fetch from bundle or network.
  }

  // Second: try the bundled copy shipped with the desktop app. This is the
  // primary path on a freshly-installed offline machine.
  const bundled = findBundledCubismCore(options.bundledSearchPaths)
  if (bundled) {
    try {
      const rawBuf = fs.readFileSync(bundled)
      // Node's fs.readFileSync always returns an ArrayBuffer-backed Buffer;
      // the cast is safe and needed because TS 5.7+ made Uint8Array generic.
      const buf = new Uint8Array(rawBuf.buffer as ArrayBuffer, rawBuf.byteOffset, rawBuf.byteLength)
      const validation = validateBuffer(buf)
      if (validation.ok) {
        fs.mkdirSync(cubismCoreDir(userDataDir), { recursive: true })
        const tmp = filePath + '.tmp'
        fs.writeFileSync(tmp, buf)
        fs.renameSync(tmp, filePath)
        return {
          success: true,
          path: filePath,
          size: validation.size,
          fromCache: false,
          fromBundle: true,
        }
      }
    } catch {
      // best effort — fall through to network
    }
  }

  if (options.cacheOnly) {
    return { success: false, path: filePath, error: 'Cubism Core is not installed yet' }
  }
  return downloadCubismCore(userDataDir, options)
}

/**
 * Locate a bundled `live2dcubismcore.min.js` shipped with the desktop app.
 *
 * Default production search order:
 *   - `<resourcesPath>/live2d-sdk/live2dcubismcore.min.js` (electron-builder
 *     `extraResources`)
 *   - `<__dirname>/../../resources/live2d-sdk/...` (electron-vite dev — the
 *     resources/ folder sits two levels up from dist/main/index.js)
 *   - `<__dirname>/../resources/live2d-sdk/...` (alternate packaging layouts)
 *
 * Pass a `searchPaths` array to override the defaults entirely (used by
 * tests to keep the project's own committed resources file from leaking in).
 * Passing `[]` skips bundled lookup completely.
 */
export function findBundledCubismCore(searchPaths?: string[]): string | null {
  const candidates = searchPaths ?? defaultBundledSearchPaths()
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
        return candidate
      }
    } catch {
      // ignore unreadable entries
    }
  }
  return null
}

function defaultBundledSearchPaths(): string[] {
  const out: string[] = []
  if (process.resourcesPath) {
    out.push(path.join(process.resourcesPath, CUBISM_CORE_DIRNAME, CUBISM_CORE_FILENAME))
  }
  out.push(
    path.resolve(__dirname, '..', '..', 'resources', CUBISM_CORE_DIRNAME, CUBISM_CORE_FILENAME),
  )
  out.push(
    path.resolve(__dirname, '..', 'resources', CUBISM_CORE_DIRNAME, CUBISM_CORE_FILENAME),
  )
  return out
}

/**
 * Force a fresh download, replacing any cached copy.
 */
export async function downloadCubismCore(
  userDataDir: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const dir = cubismCoreDir(userDataDir)
  const filePath = cubismCorePath(userDataDir)
  const fetchFn = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchFn !== 'function') {
    return {
      success: false,
      path: filePath,
      error: 'fetch() is not available in this runtime',
    }
  }
  const url = options.sourceUrl ?? CUBISM_CORE_URL
  try {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/javascript, text/javascript, */*' },
    })
    if (!res.ok) {
      return {
        success: false,
        path: filePath,
        error: `HTTP ${res.status} ${res.statusText || ''} from ${url}`.trim(),
      }
    }
    // res.arrayBuffer() returns ArrayBuffer; Uint8Array<ArrayBuffer> satisfies
    // Node's ArrayBufferView in TS 5.7+ without a cast.
    const buf = new Uint8Array(await res.arrayBuffer())
    const validation = validateBuffer(buf)
    if (!validation.ok) {
      return { success: false, path: filePath, error: validation.reason }
    }
    fs.mkdirSync(dir, { recursive: true })
    const tmp = filePath + '.tmp'
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, filePath)
    return { success: true, path: filePath, size: buf.length, fromCache: false }
  } catch (err: any) {
    return {
      success: false,
      path: filePath,
      error: err?.message || String(err),
    }
  }
}

/**
 * Copy the cached SDK file into a model directory so the per-model URL the
 * renderer derives also resolves. Best-effort: returns true on success,
 * false if the SDK isn't installed yet (caller should fall back to the
 * userdata://live2d-sdk URL).
 */
export function copyCubismCoreInto(userDataDir: string, modelDir: string): boolean {
  const src = cubismCorePath(userDataDir)
  if (!fs.existsSync(src)) return false
  const dest = path.join(modelDir, CUBISM_CORE_FILENAME)
  try {
    fs.copyFileSync(src, dest)
    return true
  } catch {
    return false
  }
}

interface ValidationOk {
  ok: true
  size: number
}
interface ValidationFail {
  ok: false
  reason: string
}

function validateBuffer(buf: Uint8Array<ArrayBuffer>): ValidationOk | ValidationFail {
  if (buf.length < MIN_CORE_BYTES) {
    return { ok: false, reason: `Downloaded file too small (${buf.length} bytes)` }
  }
  if (buf.length > MAX_CORE_BYTES) {
    return { ok: false, reason: `Downloaded file too large (${buf.length} bytes)` }
  }
  const headerSlice = new TextDecoder('utf-8').decode(buf.subarray(0, 4096))
  if (!headerSlice.includes(REQUIRED_HEADER_MARKER)) {
    return {
      ok: false,
      reason: 'Downloaded file is missing the Live2D Cubism Core header — refusing to cache',
    }
  }
  return { ok: true, size: buf.length }
}

function validateCachedFile(filePath: string): ValidationOk | null {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size < MIN_CORE_BYTES || stat.size > MAX_CORE_BYTES) return null
    const fd = fs.openSync(filePath, 'r')
    try {
      const sniff = new Uint8Array(Math.min(4096, stat.size))
      fs.readSync(fd, sniff, 0, sniff.length, 0)
      if (!new TextDecoder('utf-8').decode(sniff).includes(REQUIRED_HEADER_MARKER)) return null
      return { ok: true, size: stat.size }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}
