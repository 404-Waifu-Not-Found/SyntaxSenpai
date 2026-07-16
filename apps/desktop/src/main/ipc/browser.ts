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

  // Downloads pause until the user confirms via the renderer toast.
  ses.on('will-download', (_event: any, item: any) => {
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

    broadcast('browser:download:request', {
      id,
      filename,
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
    })
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

  ipcMain.handle('browser:download:respond', async (_event: any, payload: { id: string; allow: boolean }) => {
    try {
      const pending = pendingDownloads.get(String(payload?.id))
      if (!pending) return { success: false, error: 'download not found (may have expired)' }
      if (payload?.allow) {
        const downloadsDir = app.getPath('downloads')
        // Avoid clobbering an existing file with the same name.
        let target = path.join(downloadsDir, pending.filename)
        let n = 1
        const fsSync = require('fs')
        const ext = path.extname(pending.filename)
        const base = path.basename(pending.filename, ext)
        while (fsSync.existsSync(target)) {
          target = path.join(downloadsDir, `${base} (${n})${ext}`)
          n += 1
        }
        pending.item.setSavePath(target)
        pending.item.resume()
        return { success: true, savePath: target }
      }
      pending.item.cancel()
      pendingDownloads.delete(String(payload?.id))
      return { success: true, cancelled: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
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
