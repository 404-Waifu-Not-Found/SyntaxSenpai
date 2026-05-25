const electronModule = require('electron')

// When started via the npm `electron` shim, Electron may run this entry in
// `ELECTRON_RUN_AS_NODE` mode first. Relaunch the real app binary without that
// env var so the actual browser process gets Electron APIs.
if (typeof electronModule === 'string') {
  const cp = require('child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.SYNTAX_SENPAI_ELECTRON_LAUNCHED = '1'
  const child = cp.spawn(electronModule, [process.cwd()], {
    stdio: 'inherit',
    detached: true,
    env
  })

  try { child.unref && child.unref() } catch (e) {}
  process.exit(0)
}

const { app, BrowserWindow, ipcMain, clipboard, globalShortcut, Tray, Menu, nativeImage, screen } = electronModule
const { join } = require('path')
const fs = require('fs')
import { registerChatIpc } from './ipc/chat'
import { registerAgentIpc } from './ipc/agent'
import { registerKeystoreIpc } from './ipc/keystore'
import { registerProviderIpc } from './ipc/provider'
import { registerTerminalIpc } from './ipc/terminal'
import { registerFilesystemIpc } from './ipc/filesystem'
import { registerSpotifyIpc } from './ipc/spotify'
import { registerExportIpc } from './ipc/export'
import { registerWsIpc } from './ipc/ws'
import { registerPluginsIpc } from './ipc/plugins'
import { registerWaifusIpc } from './ipc/waifus'
import { registerStrictModeIpc } from './ipc/strict-mode'
import { registerLogIpc } from './ipc/log'
import { registerRepositoryIpc } from './ipc/repository'
import { registerSkillsIpc } from './ipc/skills'
import { registerPendingPluginsIpc } from './ipc/pending-plugins'
import { registerWechatIpc, autoResumeBot as autoResumeWechatBot } from './ipc/wechat'
import { startWsServer } from './ws-server'
import { mainLogger } from './logger'

const isDev = process.env.NODE_ENV === 'development'

let mainWindow: any = null
let tray: any = null
let currentWindowFrameless = false

const NORMAL_WINDOW_MIN_WIDTH = 800
const NORMAL_WINDOW_MIN_HEIGHT = 600
const NORMAL_WINDOW_DEFAULT_BOUNDS = { width: 1200, height: 800 }
const OVERLAY_WINDOW_MIN_WIDTH = 320
const OVERLAY_WINDOW_MIN_HEIGHT = 240
const OVERLAY_WINDOW_DEFAULT_BOUNDS = { width: 420, height: 620 }
const OVERLAY_WIDTH_RATIO = 0.38
const OVERLAY_HEIGHT_RATIO = 0.82
const WINDOW_STATE_FILE = 'window-state.json'

type WindowMode = 'normal' | 'overlay' | 'fullscreen'
type WindowBounds = { width: number; height: number; x?: number; y?: number }
type WindowState = {
  mode: WindowMode
  normalBounds: WindowBounds
  overlayBounds: WindowBounds
}

const defaultWindowState = (): WindowState => ({
  mode: 'normal',
  normalBounds: { ...NORMAL_WINDOW_DEFAULT_BOUNDS },
  overlayBounds: { ...OVERLAY_WINDOW_DEFAULT_BOUNDS },
})

let windowState: WindowState = defaultWindowState()

function getWindowStatePath(): string {
  return join(app.getPath('userData'), WINDOW_STATE_FILE)
}

function sanitizeBounds(bounds: any, fallback: WindowBounds, minWidth: number, minHeight: number): WindowBounds {
  const width = Math.max(minWidth, Number(bounds?.width) || fallback.width)
  const height = Math.max(minHeight, Number(bounds?.height) || fallback.height)
  const next: WindowBounds = { width, height }
  if (Number.isFinite(bounds?.x)) next.x = Number(bounds.x)
  if (Number.isFinite(bounds?.y)) next.y = Number(bounds.y)
  return next
}

function loadWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      mode: parsed?.mode === 'overlay'
        ? 'overlay'
        : parsed?.mode === 'fullscreen'
          ? 'fullscreen'
          : 'normal',
      normalBounds: sanitizeBounds(parsed?.normalBounds, NORMAL_WINDOW_DEFAULT_BOUNDS, NORMAL_WINDOW_MIN_WIDTH, NORMAL_WINDOW_MIN_HEIGHT),
      overlayBounds: sanitizeBounds(parsed?.overlayBounds, OVERLAY_WINDOW_DEFAULT_BOUNDS, OVERLAY_WINDOW_MIN_WIDTH, OVERLAY_WINDOW_MIN_HEIGHT),
    }
  } catch {
    return defaultWindowState()
  }
}

function saveWindowState() {
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(windowState, null, 2), 'utf8')
  } catch (err) {
    mainLogger.warn({ err }, 'window state save failed')
  }
}

function updateStoredBoundsFromWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (windowState.mode === 'fullscreen') return
  const bounds = mainWindow.getBounds()
  const key = windowState.mode === 'overlay' ? 'overlayBounds' : 'normalBounds'
  const minWidth = windowState.mode === 'overlay' ? OVERLAY_WINDOW_MIN_WIDTH : NORMAL_WINDOW_MIN_WIDTH
  const minHeight = windowState.mode === 'overlay' ? OVERLAY_WINDOW_MIN_HEIGHT : NORMAL_WINDOW_MIN_HEIGHT
  windowState[key] = sanitizeBounds(bounds, windowState[key], minWidth, minHeight)
  saveWindowState()
}

function getActiveBoundsForMode(mode: WindowMode): WindowBounds {
  return mode === 'overlay' ? windowState.overlayBounds : windowState.normalBounds
}

function shouldUseFramelessWindow(mode: WindowMode): boolean {
  return mode === 'overlay'
}

function shouldUseTransparentWindow(mode: WindowMode): boolean {
  return mode === 'overlay'
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function hasDefaultOverlaySize(bounds: WindowBounds): boolean {
  return bounds.width === OVERLAY_WINDOW_DEFAULT_BOUNDS.width
    && bounds.height === OVERLAY_WINDOW_DEFAULT_BOUNDS.height
}

function getCenteredOverlayBounds(width: number, height: number, currentBounds?: { x: number; y: number; width: number; height: number }): WindowBounds {
  const display = currentBounds
    ? screen.getDisplayMatching(currentBounds)
    : screen.getPrimaryDisplay()
  const workArea = display?.workArea ?? display?.bounds ?? { x: 0, y: 0, width, height }
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  }
}

function getOverlayBoundsForActivation(currentBounds?: { x: number; y: number; width: number; height: number }, preferredBounds?: WindowBounds): WindowBounds {
  const display = currentBounds
    ? screen.getDisplayMatching(currentBounds)
    : screen.getPrimaryDisplay()
  const workArea = display?.workArea ?? display?.bounds ?? {
    x: 0,
    y: 0,
    width: NORMAL_WINDOW_DEFAULT_BOUNDS.width,
    height: NORMAL_WINDOW_DEFAULT_BOUNDS.height,
  }

  const useStoredOverlaySize = preferredBounds && !hasDefaultOverlaySize(preferredBounds)
  const referenceWidth = currentBounds?.width
    ?? Math.min(NORMAL_WINDOW_DEFAULT_BOUNDS.width, Math.round(workArea.width * 0.7))
  const referenceHeight = currentBounds?.height
    ?? Math.min(NORMAL_WINDOW_DEFAULT_BOUNDS.height, Math.round(workArea.height * 0.9))
  const maxWidth = Math.max(OVERLAY_WINDOW_MIN_WIDTH, Math.round(workArea.width * 0.55))
  const maxHeight = Math.max(OVERLAY_WINDOW_MIN_HEIGHT, Math.round(workArea.height * 0.9))
  const width = clampToRange(
    Math.round(useStoredOverlaySize ? preferredBounds.width : referenceWidth * OVERLAY_WIDTH_RATIO),
    OVERLAY_WINDOW_MIN_WIDTH,
    maxWidth,
  )
  const height = clampToRange(
    Math.round(useStoredOverlaySize ? preferredBounds.height : referenceHeight * OVERLAY_HEIGHT_RATIO),
    OVERLAY_WINDOW_MIN_HEIGHT,
    maxHeight,
  )

  return getCenteredOverlayBounds(width, height, currentBounds)
}

function applyWindowMode(mode: WindowMode) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const targetFrameless = shouldUseFramelessWindow(mode)
  if (currentWindowFrameless !== targetFrameless) {
    recreateWindowForMode(mode)
    return
  }
  const wasFullscreen = mainWindow.isFullScreen()
  if (mode !== 'fullscreen' && wasFullscreen) {
    mainWindow.setFullScreen(false)
  }

  if (mode === 'fullscreen') {
    windowState.mode = 'fullscreen'
    mainWindow.setMinimumSize(NORMAL_WINDOW_MIN_WIDTH, NORMAL_WINDOW_MIN_HEIGHT)
    mainWindow.setAlwaysOnTop(false, 'normal')
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    saveWindowState()
    mainWindow.setFullScreen(true)
    return
  }

  const minWidth = mode === 'overlay' ? OVERLAY_WINDOW_MIN_WIDTH : NORMAL_WINDOW_MIN_WIDTH
  const minHeight = mode === 'overlay' ? OVERLAY_WINDOW_MIN_HEIGHT : NORMAL_WINDOW_MIN_HEIGHT
  const rawBounds = getActiveBoundsForMode(mode)
  const currentBounds = mainWindow.getBounds()
  const bounds = mode === 'overlay'
    ? getOverlayBoundsForActivation(currentBounds, rawBounds)
    : sanitizeBounds(rawBounds, NORMAL_WINDOW_DEFAULT_BOUNDS, minWidth, minHeight)
  windowState.mode = mode
  if (mode === 'overlay') {
    windowState.overlayBounds = bounds
  }
  mainWindow.setMinimumSize(minWidth, minHeight)
  mainWindow.setAlwaysOnTop(mode === 'overlay', mode === 'overlay' ? 'floating' : 'normal')
  mainWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  })
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  saveWindowState()
}

function registerWindowStateTracking() {
  if (!mainWindow) return
  mainWindow.on('resize', () => updateStoredBoundsFromWindow())
  mainWindow.on('move', () => updateStoredBoundsFromWindow())
}

function recreateWindowForMode(mode: WindowMode) {
  const previousWindow = mainWindow
  const previousBounds = previousWindow && !previousWindow.isDestroyed()
    ? previousWindow.getBounds()
    : undefined

  if (previousBounds && windowState.mode !== 'fullscreen') {
    const previousKey = windowState.mode === 'overlay' ? 'overlayBounds' : 'normalBounds'
    const previousMinWidth = windowState.mode === 'overlay' ? OVERLAY_WINDOW_MIN_WIDTH : NORMAL_WINDOW_MIN_WIDTH
    const previousMinHeight = windowState.mode === 'overlay' ? OVERLAY_WINDOW_MIN_HEIGHT : NORMAL_WINDOW_MIN_HEIGHT
    windowState[previousKey] = sanitizeBounds(previousBounds, windowState[previousKey], previousMinWidth, previousMinHeight)
  }

  const nextMinWidth = mode === 'overlay' ? OVERLAY_WINDOW_MIN_WIDTH : NORMAL_WINDOW_MIN_WIDTH
  const nextMinHeight = mode === 'overlay' ? OVERLAY_WINDOW_MIN_HEIGHT : NORMAL_WINDOW_MIN_HEIGHT
  const nextBounds = mode === 'overlay'
    ? getOverlayBoundsForActivation(previousBounds, windowState.overlayBounds)
    : sanitizeBounds(previousBounds ?? windowState.normalBounds, NORMAL_WINDOW_DEFAULT_BOUNDS, nextMinWidth, nextMinHeight)

  windowState.mode = mode
  if (mode === 'overlay') {
    windowState.overlayBounds = nextBounds
  } else if (mode === 'normal') {
    windowState.normalBounds = nextBounds
  }
  saveWindowState()

  createWindow(mode)
  const replacementWindow = mainWindow

  if (replacementWindow && !replacementWindow.isDestroyed()) {
    if (mode === 'fullscreen') {
      replacementWindow.setFullScreen(true)
    }
    replacementWindow.show()
    replacementWindow.focus()
  }

  if (previousWindow && !previousWindow.isDestroyed()) {
    previousWindow.removeAllListeners('resize')
    previousWindow.removeAllListeners('move')
    previousWindow.removeAllListeners('closed')
    previousWindow.hide()
    previousWindow.destroy()
  }
}

function toggleMainWindow() {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
  } else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function resolveIconPath(): string {
  // Try common locations, fall back to the repo-level icon.png for dev.
  const candidates = [
    join(__dirname, '..', 'renderer', 'icon.png'),
    join(__dirname, '..', '..', 'icon.png'),
    join(process.cwd(), 'icon.png'),
    join(process.cwd(), '..', '..', 'icon.png'),
  ]
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  return ''
}

function setupTray() {
  try {
    const iconPath = resolveIconPath()
    let image: any
    if (iconPath) {
      image = nativeImage.createFromPath(iconPath)
      if (!image.isEmpty()) {
        // macOS menubar likes ~22x22 template images
        image = image.resize({ width: 22, height: 22 })
      }
    }
    tray = image && !image.isEmpty() ? new Tray(image) : new Tray(nativeImage.createEmpty())
    tray.setToolTip('SyntaxSenpai')
    const menu = Menu.buildFromTemplate([
      { label: 'Show / Hide', click: () => toggleMainWindow() },
      { label: 'New chat', accelerator: 'CmdOrCtrl+Shift+N', click: () => {
        toggleMainWindow()
        mainWindow?.webContents.send('tray:new-chat')
      } },
      { type: 'separator' },
      { label: 'Quit SyntaxSenpai', click: () => app.quit() },
    ])
    tray.setContextMenu(menu)
    tray.on('click', () => toggleMainWindow())
  } catch (err) {
    mainLogger.warn({ err }, 'tray setup failed')
  }
}

function registerGlobalShortcuts() {
  try {
    const registered = globalShortcut.register('CommandOrControl+Shift+Space', () => toggleMainWindow())
    if (!registered) mainLogger.warn('global shortcut not registered (already bound elsewhere?)')
  } catch (err) {
    mainLogger.warn({ err }, 'globalShortcut failed')
  }
}

function createWindow(forcedMode?: WindowMode): void {
  if (!windowState) windowState = loadWindowState()
  const mode = forcedMode
    ?? (windowState.mode === 'overlay'
      ? 'overlay'
      : windowState.mode === 'fullscreen'
        ? 'fullscreen'
        : 'normal')
  const bounds = mode === 'overlay'
    ? getOverlayBoundsForActivation(undefined, getActiveBoundsForMode(mode))
    : getActiveBoundsForMode(mode)
  const createdWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(typeof bounds.x === 'number' ? { x: bounds.x } : {}),
    ...(typeof bounds.y === 'number' ? { y: bounds.y } : {}),
    transparent: shouldUseTransparentWindow(mode),
    backgroundColor: shouldUseTransparentWindow(mode) ? '#00000000' : '#10131c',
    frame: !shouldUseFramelessWindow(mode),
    maximizable: mode !== 'overlay',
    fullscreenable: mode !== 'overlay',
    minWidth: mode === 'overlay' ? OVERLAY_WINDOW_MIN_WIDTH : NORMAL_WINDOW_MIN_WIDTH,
    minHeight: mode === 'overlay' ? OVERLAY_WINDOW_MIN_HEIGHT : NORMAL_WINDOW_MIN_HEIGHT,
    alwaysOnTop: mode === 'overlay',
    fullscreen: mode === 'fullscreen',
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox:false is required — the preload script uses Node.js require()
      // to bridge native APIs (keytar, node:fs) into the context-isolated
      // renderer. The sandbox would block require() in the preload layer.
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  mainWindow = createdWindow
  currentWindowFrameless = shouldUseFramelessWindow(mode)

  if (isDev) {
    createdWindow.loadURL('http://localhost:5173')
    createdWindow.webContents.openDevTools()
  } else {
    createdWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  createdWindow.on('closed', () => {
    if (mainWindow === createdWindow) {
      mainWindow = null
      currentWindowFrameless = false
    }
  })

  registerWindowStateTracking()
}

function writeCrashLog(kind: string, err: any) {
  try {
    const line = `[${new Date().toISOString()}] ${kind}: ${err && err.stack ? err.stack : String(err)}\n`
    const logPath = join(app.getPath('userData'), 'crash.log')
    fs.appendFileSync(logPath, line)
  } catch {
    /* best effort */
  }
}

process.on('uncaughtException', (err: any) => {
  mainLogger.error({ err }, 'uncaughtException')
  writeCrashLog('uncaughtException', err)
})

process.on('unhandledRejection', (reason: any) => {
  mainLogger.error({ reason }, 'unhandledRejection')
  writeCrashLog('unhandledRejection', reason)
})

// Simple clipboard IPC — lets the agent read/write the system clipboard
// without reaching for shell invocations.
ipcMain.handle('clipboard:read', () => {
  try { return { success: true, text: clipboard.readText() } } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})
ipcMain.handle('clipboard:write', (_e: any, text: string) => {
  try { clipboard.writeText(String(text ?? '')); return { success: true } } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('window:getViewState', () => {
  try {
    return {
      success: true,
      mode: mainWindow?.isFullScreen() ? 'fullscreen' : windowState.mode,
      overlayEnabled: windowState.mode === 'overlay',
      fullscreenEnabled: !!mainWindow?.isFullScreen() || windowState.mode === 'fullscreen',
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('window:getOverlayMode', () => {
  try {
    return { success: true, mode: windowState.mode, enabled: windowState.mode === 'overlay' }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('window:setDisplayMode', (_e: any, mode: WindowMode) => {
  try {
    if (!mainWindow) createWindow()
    if (!['normal', 'overlay', 'fullscreen'].includes(mode)) {
      throw new Error(`Unsupported display mode: ${String(mode)}`)
    }
    applyWindowMode(mode)
    return {
      success: true,
      mode: mainWindow?.isFullScreen() ? 'fullscreen' : windowState.mode,
      overlayEnabled: windowState.mode === 'overlay',
      fullscreenEnabled: !!mainWindow?.isFullScreen() || windowState.mode === 'fullscreen',
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('window:setOverlayMode', (_e: any, enabled: boolean) => {
  try {
    if (!mainWindow) createWindow()
    applyWindowMode(enabled ? 'overlay' : 'normal')
    return { success: true, mode: windowState.mode, enabled: windowState.mode === 'overlay' }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

app.whenReady().then(() => {
  windowState = loadWindowState()
  createWindow()

  // Ensure chat DB path is set to userData
  try {
    process.env.CHAT_DB_PATH = join(app.getPath('userData'), 'syntax-senpai.sqlite')
  } catch (err) {
    // fallback to cwd
    process.env.CHAT_DB_PATH = 'syntax-senpai.sqlite'
  }

  // Register IPC handlers after app is ready so they can access app.getPath.
  registerChatIpc()
  registerAgentIpc()
  registerKeystoreIpc()
  registerProviderIpc()
  registerTerminalIpc()
  registerFilesystemIpc()
  registerSpotifyIpc()
  registerExportIpc()
  registerWsIpc()
  registerPluginsIpc()
  registerWaifusIpc()
  registerStrictModeIpc()
  registerLogIpc()
  registerRepositoryIpc()
  registerSkillsIpc()
  registerPendingPluginsIpc()
  registerWechatIpc()
  startWsServer().catch((err) => mainLogger.error({ err }, 'ws-server failed to start'))
  autoResumeWechatBot().catch((err) => mainLogger.warn({ err }, 'wechat auto-resume failed'))

  setupTray()
  registerGlobalShortcuts()
})

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch { /* ignore */ }
})

app.on('window-all-closed', () => {
  // On macOS + Linux with a tray, keep the process alive. On Windows, quit.
  if (process.platform === 'win32') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  } else {
    mainWindow.show()
  }
})

export {}
