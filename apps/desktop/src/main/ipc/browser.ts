import { decideAction } from '../agent/policy'
const { ipcMain, app, session, BrowserWindow, webContents: webContentsModule } = require('electron')
const path = require('path')

let registered = false

export const BROWSER_PARTITION = 'persist:browser'

/** Only regular web pages are allowed inside the embedded browser. */
export function isAllowedBrowserUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(String(rawUrl || ''))
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function broadcast(channel: string, payload: any) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

type PendingDownload = {
  item: any
  filename: string
}

const pendingDownloads = new Map<string, PendingDownload>()
let downloadSeq = 0

function setupBrowserSession() {
  const ses = session.fromPartition(BROWSER_PARTITION)

  // Sites inside the embedded browser get no device/system permissions.
  ses.setPermissionRequestHandler((_wc: any, _permission: string, callback: (granted: boolean) => void) => {
    callback(false)
  })

  // Downloads pause only while the shared execution policy is evaluated.
  ses.on('will-download', async (_event: any, item: any) => {
    const id = `dl-${Date.now()}-${++downloadSeq}`
    const filename = item.getFilename() || 'download'
    try { item.pause() } catch { /* best effort */ }
    pendingDownloads.set(id, { item, filename })

    item.on('updated', () => {
      broadcast('browser:download:progress', {
        id,
        filename,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state: item.getState(),
      })
    })
    item.once('done', (_e: any, state: string) => {
      pendingDownloads.delete(id)
      broadcast('browser:download:done', {
        id,
        filename,
        state,
        savePath: state === 'completed' ? item.getSavePath() : undefined,
      })
    })

    const decision = await decideAction({ id, name: 'browser_download', arguments: { url: item.getURL(), filename } }, 'Download requested by the active browser task')
    if (!decision.approved) { item.cancel(); broadcast('browser:download:blocked', { id, filename, reason: decision.reason }); return }
    const fsSync = require('fs')
    const safeName = path.basename(filename)
    const ext = path.extname(safeName), base = path.basename(safeName, ext)
    let target = path.join(app.getPath('downloads'), safeName), n = 1
    while (fsSync.existsSync(target)) target = path.join(app.getPath('downloads'), `${base} (${n++})${ext}`)
    item.setSavePath(target); broadcast('browser:download:started', { id, filename, url: item.getURL(), totalBytes: item.getTotalBytes() }); item.resume()

  })
}

function hardenGuestContents(contents: any) {
  // Popups / target=_blank become new tabs in the renderer instead of windows.
  contents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (isAllowedBrowserUrl(url)) broadcast('browser:openUrl', { url })
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event: any, url: string) => {
    if (!isAllowedBrowserUrl(url)) event.preventDefault()
  })
}

export function registerBrowserIpc() {
  if (registered) return
  registered = true

  setupBrowserSession()

  app.on('web-contents-created', (_event: any, contents: any) => {
    if (contents.getType() !== 'webview') return
    hardenGuestContents(contents)
  })

  ipcMain.handle('browser:capturePage', async (_event: any, webContentsId: number) => {
    try {
      const contents = webContentsModule.fromId(Number(webContentsId))
      if (!contents || contents.isDestroyed()) {
        return { success: false, error: 'browser tab not found' }
      }
      if (contents.getType() !== 'webview') {
        return { success: false, error: 'capture is only allowed for browser tabs' }
      }
      const image = await contents.capturePage()
      // Cap width to keep the payload reasonable for vision models.
      const size = image.getSize()
      const maxWidth = 1280
      const resized = size.width > maxWidth
        ? image.resize({ width: maxWidth })
        : image
      return { success: true, dataUrl: resized.toDataURL() }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}

module.exports = { registerBrowserIpc, isAllowedBrowserUrl, BROWSER_PARTITION }

export {}
