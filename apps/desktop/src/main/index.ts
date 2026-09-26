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

const { app, BrowserWindow, ipcMain, clipboard, globalShortcut, Tray, Menu, nativeImage, screen, protocol: earlyProtocol } = electronModule
const { join, resolve, sep } = require('path')
const fs = require('fs')
if (process.env.SYNTAX_SENPAI_DATA_DIR) { fs.mkdirSync(process.env.SYNTAX_SENPAI_DATA_DIR, { recursive: true }); app.setPath('userData', process.env.SYNTAX_SENPAI_DATA_DIR) }

// Register `userdata://` as a standard, fetch-capable, secure scheme BEFORE
// app is ready. Without this, the scheme is treated as opaque — relative URL
// resolution against `userdata://...model3.json` fails, which is what makes
// pixi-live2d-display throw a "Network error" when it tries to fetch the
// .moc3 / textures / motions referenced by the model JSON.
try {
  earlyProtocol.registerSchemesAsPrivileged([
    {
      scheme: 'userdata',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ])
} catch (err) {
  // If this fails, the app still boots — Live2D rendering just won't work.
  console.warn('[desktop] failed to register userdata:// scheme:', err)
}
import { registerChatIpc } from './ipc/chat'
import { registerAgentIpc } from './ipc/agent'
import { registerKeystoreIpc } from './ipc/keystore'
import { registerProviderIpc } from './ipc/provider'
import { registerTerminalIpc } from './ipc/terminal'
import { registerFilesystemIpc } from './ipc/filesystem'
import { registerSearchIpc } from './ipc/search'
import { registerLspIpc } from './ipc/lsp'
import { registerSpotifyIpc } from './ipc/spotify'
import { registerExportIpc } from './ipc/export'
import { registerFullBackupIpc } from './ipc/full-backup'
import { registerWsIpc } from './ipc/ws'
import { registerPluginsIpc } from './ipc/plugins'
import { registerWaifusIpc } from './ipc/waifus'
import { registerPolicyIpc } from './agent/policy'
import { registerRunService } from './agent/run-service'
import { registerLogIpc } from './ipc/log'
import { registerRepositoryIpc } from './ipc/repository'
import { registerSkillsIpc } from './ipc/skills'
import { registerPendingPluginsIpc } from './ipc/pending-plugins'
import { registerTtsIpc } from './ipc/tts'
import { registerWechatIpc, autoResumeBot as autoResumeWechatBot } from './ipc/wechat'
import { registerBrowserIpc, isAllowedBrowserUrl, BROWSER_PARTITION } from './ipc/browser'
import { startWsServer } from './ws-server'
import { mainLogger } from './logger'

const isDev = process.env.NODE_ENV === 'development'

let mainWindow: any = null
let live2dWindow: any = null
let desktopPetWindow: any = null
let desktopPetChatWindow: any = null
let desktopPetModeActive = false
let desktopPetChatReady = false
const pendingDesktopPetCommands: any[] = []
let applicationIsQuitting = false
let pendingLive2DSession: any = null
let pendingLive2DSpeech: any = null
let pendingDesktopPetSession: any = null
let tray: any = null
const NORMAL_WINDOW_MIN_WIDTH = 800
const NORMAL_WINDOW_MIN_HEIGHT = 600
const NORMAL_WINDOW_DEFAULT_BOUNDS = { width: 1200, height: 800 }
const WINDOW_STATE_FILE = 'window-state.json'

type WindowMode = 'normal' | 'fullscreen'
type WindowBounds = { width: number; height: number; x?: number; y?: number }
type WindowState = {
  mode: WindowMode
  normalBounds: WindowBounds
}

const defaultWindowState = (): WindowState => ({
  mode: 'normal',
  normalBounds: { ...NORMAL_WINDOW_DEFAULT_BOUNDS },
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
    const normalizedState: WindowState = {
      // Overlay mode was removed. Normalize old persisted overlay state so
      // upgrades always reopen the regular app window.
      mode: parsed?.mode === 'fullscreen' ? 'fullscreen' : 'normal',
      normalBounds: sanitizeBounds(parsed?.normalBounds, NORMAL_WINDOW_DEFAULT_BOUNDS, NORMAL_WINDOW_MIN_WIDTH, NORMAL_WINDOW_MIN_HEIGHT),
    }
    if (parsed?.mode === 'overlay') {
      try {
        fs.writeFileSync(getWindowStatePath(), JSON.stringify(normalizedState, null, 2), 'utf8')
      } catch (err) {
        mainLogger.warn({ err }, 'legacy overlay window state migration failed')
      }
    }
    return normalizedState
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
  windowState.normalBounds = sanitizeBounds(bounds, windowState.normalBounds, NORMAL_WINDOW_MIN_WIDTH, NORMAL_WINDOW_MIN_HEIGHT)
  saveWindowState()
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function applyWindowMode(mode: WindowMode) {
  if (!mainWindow || mainWindow.isDestroyed()) return
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

  const bounds = sanitizeBounds(windowState.normalBounds, NORMAL_WINDOW_DEFAULT_BOUNDS, NORMAL_WINDOW_MIN_WIDTH, NORMAL_WINDOW_MIN_HEIGHT)
  windowState.mode = mode
  mainWindow.setMinimumSize(NORMAL_WINDOW_MIN_WIDTH, NORMAL_WINDOW_MIN_HEIGHT)
  mainWindow.setAlwaysOnTop(false, 'normal')
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

function toggleMainWindow() {
  if (desktopPetModeActive && desktopPetWindow && !desktopPetWindow.isDestroyed()) {
    desktopPetWindow.show()
    desktopPetWindow.setAlwaysOnTop(true, 'screen-saver')
    if (desktopPetChatWindow && !desktopPetChatWindow.isDestroyed() && desktopPetChatWindow.isVisible()) {
      desktopPetChatWindow.show()
      desktopPetChatWindow.setAlwaysOnTop(true, 'screen-saver')
      desktopPetChatWindow.focus()
    } else {
      desktopPetWindow.focus()
    }
    return
  }
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

function listLive2DDisplays() {
  return screen.getAllDisplays().map((display: any, index: number) => ({
    id: String(display.id),
    label: display.id === screen.getPrimaryDisplay().id ? 'Main display' : `Display ${index + 1}`,
    primary: display.id === screen.getPrimaryDisplay().id,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    },
    scaleFactor: display.scaleFactor,
  }))
}

function sendLive2DEvent(channel: string, payload: any) {
  if (!live2dWindow || live2dWindow.isDestroyed() || live2dWindow.webContents.isLoadingMainFrame()) return
  live2dWindow.webContents.send(channel, payload)
}

function createLive2DWindow(session: any) {
  pendingLive2DSession = session
  const displays = listLive2DDisplays()
  const selected = displays.find((display: any) => display.id === String(session?.displayId))
    || displays.find((display: any) => display.primary)
    || displays[0]
  if (!selected) throw new Error('No display is available for immersive Live2D mode')

  const bounds = selected.bounds
  if (live2dWindow && !live2dWindow.isDestroyed()) {
    if (live2dWindow.isFullScreen()) live2dWindow.setFullScreen(false)
    live2dWindow.setBounds(bounds)
    live2dWindow.show()
    live2dWindow.setFullScreen(true)
    live2dWindow.focus()
    sendLive2DEvent('live2d:session', pendingLive2DSession)
    if (pendingLive2DSpeech) sendLive2DEvent('live2d:speech', pendingLive2DSpeech)
    return selected
  }

  live2dWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    title: 'SyntaxSenpai Live2D',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#071511',
    resizable: false,
    minimizable: true,
    fullscreenable: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  live2dWindow.webContents.on('did-finish-load', () => {
    sendLive2DEvent('live2d:session', pendingLive2DSession)
    if (pendingLive2DSpeech) sendLive2DEvent('live2d:speech', pendingLive2DSpeech)
    live2dWindow?.setFullScreen(true)
  })
  live2dWindow.on('closed', () => {
    live2dWindow = null
    mainWindow?.webContents.send('live2d:window-closed')
  })

  if (isDev) live2dWindow.loadURL('http://localhost:5173/live2d.html')
  else live2dWindow.loadFile(join(__dirname, '../renderer/live2d.html'))
  live2dWindow.show()
  live2dWindow.focus()
  return selected
}

function createWindow(forcedMode?: WindowMode): void {
  if (!windowState) windowState = loadWindowState()
  const mode = forcedMode ?? windowState.mode
  const bounds = windowState.normalBounds
  const createdWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(typeof bounds.x === 'number' ? { x: bounds.x } : {}),
    ...(typeof bounds.y === 'number' ? { y: bounds.y } : {}),
    transparent: false,
    backgroundColor: '#10131c',
    frame: true,
    hasShadow: true,
    maximizable: true,
    fullscreenable: true,
    minWidth: NORMAL_WINDOW_MIN_WIDTH,
    minHeight: NORMAL_WINDOW_MIN_HEIGHT,
    alwaysOnTop: false,
    fullscreen: mode === 'fullscreen',
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox:false is required — the preload script uses Node.js require()
      // to bridge native APIs (keytar, node:fs) into the context-isolated
      // renderer. The sandbox would block require() in the preload layer.
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      // Embedded browser panel uses <webview> tags (see BrowserPanel.vue).
      webviewTag: true
    }
  })
  mainWindow = createdWindow

  // Lock down every <webview> the renderer attaches: sandboxed guest, no
  // node, no preload, http(s) only, and only our persistent browser session.
  createdWindow.webContents.on('will-attach-webview', (event: any, webPreferences: any, params: any) => {
    delete webPreferences.preload
    delete webPreferences.preloadURL
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    const src = String(params.src || '')
    const srcAllowed = src === '' || src === 'about:blank' || isAllowedBrowserUrl(src)
    if (!srcAllowed || params.partition !== BROWSER_PARTITION) {
      event.preventDefault()
    }
  })
  if (isDev) {
    createdWindow.loadURL('http://localhost:5173')
    createdWindow.webContents.openDevTools()
  } else {
    createdWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  createdWindow.on('closed', () => {
    if (mainWindow === createdWindow) {
      mainWindow = null
    }
  })

  registerWindowStateTracking()
}

function restoreMainWindowAfterPet() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

function closeDesktopPetMode() {
  const pet = desktopPetWindow
  const chat = desktopPetChatWindow
  desktopPetWindow = null
  desktopPetChatWindow = null
  desktopPetModeActive = false
  desktopPetChatReady = false
  pendingDesktopPetCommands.length = 0
  if (pet && !pet.isDestroyed()) pet.close()
  if (chat && !chat.isDestroyed()) chat.close()
  if (!applicationIsQuitting) restoreMainWindowAfterPet()
}

function applyDesktopPetWindowState(window: any) {
  if (!window || window.isDestroyed()) return
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
}

function getDesktopPetWindowLayout(workArea: any) {
  const margin = 16
  const gap = 14
  const usableWidth = Math.max(1, workArea.width - margin * 2 - gap)
  const petWidth = Math.round(Math.min(250, Math.max(150, usableWidth * 0.34)))
  const chatWidth = Math.round(Math.min(480, Math.max(240, usableWidth - petWidth)))
  const chatHeight = Math.round(Math.min(450, Math.max(280, workArea.height - margin * 2)))
  const petHeight = Math.round(Math.min(400, Math.max(220, workArea.height - margin * 2)))
  const sideBySide = chatWidth + petWidth + gap + margin * 2 <= workArea.width
  const petX = Math.round(workArea.x + workArea.width - petWidth - margin)
  const chatX = sideBySide
    ? Math.round(petX - chatWidth - gap)
    : Math.round(workArea.x + margin)
  return {
    margin,
    pet: {
      x: petX,
      y: Math.round(workArea.y + Math.max(margin, workArea.height - petHeight - margin)),
      width: petWidth,
      height: petHeight,
    },
    chat: {
      x: chatX,
      y: Math.round(workArea.y + Math.max(margin, workArea.height - chatHeight - margin)),
      width: chatWidth,
      height: chatHeight,
    },
  }
}

function showDesktopPetChatWindow() {
  let chat = desktopPetChatWindow
  if (!chat || chat.isDestroyed()) {
    const display = desktopPetWindow && !desktopPetWindow.isDestroyed()
      ? screen.getDisplayMatching(desktopPetWindow.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay()
    const layout = getDesktopPetWindowLayout(display.workArea)
    const bounds = layout.chat
    chat = new BrowserWindow({
      ...bounds,
      minWidth: Math.min(320, bounds.width),
      minHeight: Math.min(300, bounds.height),
      title: 'SyntaxSenpai Pet Chat',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true,
        webviewTag: false,
      },
    })
    desktopPetChatWindow = chat
    desktopPetChatReady = false
    applyDesktopPetWindowState(chat)
    chat.webContents.once('did-finish-load', () => {
      if (desktopPetChatWindow !== chat || chat.isDestroyed()) return
      chat.show()
      applyDesktopPetWindowState(chat)
      if (desktopPetModeActive && desktopPetWindow && !desktopPetWindow.isDestroyed()) {
        applyDesktopPetWindowState(desktopPetWindow)
        desktopPetWindow.show()
      }
      finishDesktopPetModeStartup()
    })
    chat.webContents.on('did-fail-load', (_event: any, _code: number, _description: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame && desktopPetChatWindow === chat) {
        closeDesktopPetMode()
      }
    })
    chat.on('closed', () => {
      if (desktopPetChatWindow === chat) {
        desktopPetChatWindow = null
        desktopPetChatReady = false
        pendingDesktopPetCommands.length = 0
      }
      if (desktopPetWindow && !desktopPetWindow.isDestroyed()) {
        desktopPetWindow.webContents.send('desktop-pet:chat-visibility', false)
      }
    })
    chat.on('show', () => {
      if (desktopPetWindow && !desktopPetWindow.isDestroyed()) desktopPetWindow.webContents.send('desktop-pet:chat-visibility', true)
    })
    chat.on('hide', () => {
      if (desktopPetWindow && !desktopPetWindow.isDestroyed()) desktopPetWindow.webContents.send('desktop-pet:chat-visibility', false)
    })
    if (isDev) void chat.loadURL('http://localhost:5173/?desktopPetChat=1')
    else void chat.loadFile(join(__dirname, '../renderer/index.html'), { query: { desktopPetChat: '1' } })
  } else {
    chat.show()
    applyDesktopPetWindowState(chat)
  }
  if (desktopPetWindow && !desktopPetWindow.isDestroyed()) applyDesktopPetWindowState(desktopPetWindow)
  return chat
}

function finishDesktopPetModeStartup() {
  const pet = desktopPetWindow
  const chat = desktopPetChatWindow
  if (!desktopPetModeActive || !desktopPetChatReady || !pet || pet.isDestroyed() || !chat || chat.isDestroyed()) return
  if (!pet.webContents.isLoading() && !chat.webContents.isLoading()) {
    pet.show()
    applyDesktopPetWindowState(pet)
    applyDesktopPetWindowState(chat)
    if (mainWindow && !mainWindow.isDestroyed()) {
      updateStoredBoundsFromWindow()
      mainWindow.close()
    }
  }
}

function openDesktopPetMode(session?: any) {
  if (session && typeof session === 'object') pendingDesktopPetSession = session
  if (desktopPetWindow && !desktopPetWindow.isDestroyed()) {
    desktopPetWindow.show()
    applyDesktopPetWindowState(desktopPetWindow)
    const chat = showDesktopPetChatWindow()
    chat.focus()
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) createWindow()

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay()
  const petBounds = getDesktopPetWindowLayout(display.workArea).pet
  const pet = new BrowserWindow({
    ...petBounds,
    minWidth: Math.min(200, petBounds.width),
    minHeight: Math.min(220, petBounds.height),
    title: 'SyntaxSenpai Desktop Pet',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
    },
  })
  desktopPetWindow = pet
  desktopPetModeActive = true
  applyDesktopPetWindowState(pet)

  pet.webContents.once('did-finish-load', () => {
    if (desktopPetWindow !== pet || pet.isDestroyed()) return
    pet.webContents.send('desktop-pet:session', pendingDesktopPetSession)
    finishDesktopPetModeStartup()
  })
  pet.webContents.on('did-fail-load', (_event: any, _code: number, _description: string, _url: string, isMainFrame: boolean) => {
    if (isMainFrame && desktopPetWindow === pet) closeDesktopPetMode()
  })
  pet.on('closed', () => {
    if (desktopPetWindow !== pet) return
    desktopPetWindow = null
    if (desktopPetModeActive) {
      desktopPetModeActive = false
      const chat = desktopPetChatWindow
      desktopPetChatWindow = null
      desktopPetChatReady = false
      pendingDesktopPetCommands.length = 0
      if (chat && !chat.isDestroyed()) chat.close()
      if (!applicationIsQuitting) restoreMainWindowAfterPet()
    }
  })

  if (isDev) void pet.loadURL('http://localhost:5173/desktop-pet.html')
  else void pet.loadFile(join(__dirname, '../renderer/desktop-pet.html'))
  showDesktopPetChatWindow()
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

ipcMain.handle('desktop-pet:open', (_event: any, session?: any) => {
  try {
    openDesktopPetMode(session)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('desktop-pet:close', () => {
  try {
    closeDesktopPetMode()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('desktop-pet:ready', () => ({
  session: pendingDesktopPetSession,
  chatVisible: !!(desktopPetChatWindow && !desktopPetChatWindow.isDestroyed() && desktopPetChatWindow.isVisible()),
}))

ipcMain.handle('desktop-pet:chat-ready', (event: any) => {
  if (!desktopPetChatWindow || desktopPetChatWindow.isDestroyed() || desktopPetChatWindow.webContents !== event.sender) {
    return { success: false }
  }
  desktopPetChatReady = true
  while (pendingDesktopPetCommands.length > 0) {
    desktopPetChatWindow.webContents.send('desktop-pet:command', pendingDesktopPetCommands.shift())
  }
  finishDesktopPetModeStartup()
  return { success: true }
})

ipcMain.handle('desktop-pet:update-session', (_event: any, session: any) => {
  pendingDesktopPetSession = session && typeof session === 'object' ? session : null
  if (desktopPetWindow && !desktopPetWindow.isDestroyed() && !desktopPetWindow.webContents.isLoading()) {
    desktopPetWindow.webContents.send('desktop-pet:session', pendingDesktopPetSession)
  }
  return { success: true }
})

ipcMain.handle('desktop-pet:hide-chat', () => {
  if (desktopPetChatWindow && !desktopPetChatWindow.isDestroyed()) desktopPetChatWindow.hide()
  if (desktopPetWindow && !desktopPetWindow.isDestroyed()) desktopPetWindow.webContents.send('desktop-pet:chat-visibility', false)
  return { success: true }
})

ipcMain.handle('desktop-pet:command', (_event: any, command: any) => {
  if (!desktopPetModeActive || !command || typeof command !== 'object') return { success: false }
  if (command.type === 'return-to-normal') {
    closeDesktopPetMode()
    return { success: true }
  }
  if (command.type === 'toggle-chat') {
    const chat = desktopPetChatWindow
    const visible = !!(chat && !chat.isDestroyed() && chat.isVisible())
    if (visible) {
      chat.hide()
      if (desktopPetWindow && !desktopPetWindow.isDestroyed()) desktopPetWindow.webContents.send('desktop-pet:chat-visibility', false)
      return { success: true, visible: false }
    }
    const nextChat = showDesktopPetChatWindow()
    if (!nextChat.webContents.isLoading()) nextChat.webContents.send('desktop-pet:chat-visibility', true)
    return { success: true, visible: true }
  }
  if (command.type === 'set-opacity') {
    command.value = Math.min(0.95, Math.max(0.15, Number(command.value) || 0.78))
  } else if (command.type === 'set-warthunder') {
    command.enabled = !!command.enabled
  } else if (command.type === 'game') {
    if (!new Set(['tictactoe', 'connect4', 'chess', 'gomoku', 'fate-roulette']).has(command.game)) return { success: false }
  } else {
    return { success: false }
  }
  const chat = showDesktopPetChatWindow()
  const sendCommand = () => {
    if (!desktopPetModeActive || desktopPetChatWindow !== chat || chat.isDestroyed()) return
    if (desktopPetChatReady) chat.webContents.send('desktop-pet:command', command)
    else pendingDesktopPetCommands.push(command)
    applyDesktopPetWindowState(chat)
  }
  if (chat.webContents.isLoading()) chat.webContents.once('did-finish-load', sendCommand)
  else sendCommand()
  return { success: true }
})

ipcMain.handle('window:getViewState', () => {
  try {
    const bounds = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow.getBounds()
      : windowState.normalBounds
    return {
      success: true,
      mode: mainWindow?.isFullScreen() ? 'fullscreen' : windowState.mode,
      fullscreenEnabled: !!mainWindow?.isFullScreen() || windowState.mode === 'fullscreen',
      bounds: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('window:setDisplayMode', (_e: any, mode: WindowMode) => {
  try {
    if (!mainWindow) createWindow()
    if (!['normal', 'fullscreen'].includes(mode)) {
      throw new Error(`Unsupported display mode: ${String(mode)}`)
    }
    applyWindowMode(mode)
    return {
      success: true,
      mode: mainWindow?.isFullScreen() ? 'fullscreen' : windowState.mode,
      fullscreenEnabled: !!mainWindow?.isFullScreen() || windowState.mode === 'fullscreen',
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('window:setResolution', (_e: any, size: { width?: number; height?: number }) => {
  try {
    if (!mainWindow) createWindow()
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Window is not available')

    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false)
      windowState.mode = 'normal'
    }

    const display = screen.getDisplayMatching(mainWindow.getBounds())
    const workArea = display?.workArea ?? display?.bounds ?? {
      x: 0,
      y: 0,
      width: NORMAL_WINDOW_DEFAULT_BOUNDS.width,
      height: NORMAL_WINDOW_DEFAULT_BOUNDS.height,
    }
    const width = clampToRange(Math.round(Number(size?.width) || NORMAL_WINDOW_DEFAULT_BOUNDS.width), NORMAL_WINDOW_MIN_WIDTH, workArea.width)
    const height = clampToRange(Math.round(Number(size?.height) || NORMAL_WINDOW_DEFAULT_BOUNDS.height), NORMAL_WINDOW_MIN_HEIGHT, workArea.height)
    const bounds = {
      width,
      height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
    }

    mainWindow.setBounds(bounds)
    windowState.mode = 'normal'
    windowState.normalBounds = bounds
    saveWindowState()
    mainWindow.show()
    mainWindow.focus()
    return {
      success: true,
      mode: windowState.mode,
      fullscreenEnabled: false,
      bounds,
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('live2d:listDisplays', () => {
  try {
    return { success: true, displays: listLive2DDisplays() }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('live2d:openImmersive', (_e: any, session: any) => {
  try {
    if (!session || typeof session.modelPath !== 'string' || !session.modelPath.trim()) {
      throw new Error('A Live2D model must be assigned before opening immersive mode')
    }
    const display = createLive2DWindow({
      modelPath: session.modelPath,
      displayName: String(session.displayName || 'Live2D'),
      expression: String(session.expression || 'neutral'),
      expressionRevision: Number(session.expressionRevision || 0),
      motionMap: session.motionMap && typeof session.motionMap === 'object' ? session.motionMap : {},
      modelScale: Number.isFinite(Number(session.modelScale)) ? Number(session.modelScale) : 1,
      displayId: session.displayId == null ? undefined : String(session.displayId),
    })
    return { success: true, displayId: display.id, displays: listLive2DDisplays() }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('live2d:closeImmersive', () => {
  try {
    if (live2dWindow && !live2dWindow.isDestroyed()) live2dWindow.close()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('live2d:exitFullscreen', () => {
  try {
    if (live2dWindow && !live2dWindow.isDestroyed() && live2dWindow.isFullScreen()) {
      live2dWindow.setFullScreen(false)
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('live2d:window-ready', () => {
  sendLive2DEvent('live2d:session', pendingLive2DSession)
  if (pendingLive2DSpeech) sendLive2DEvent('live2d:speech', pendingLive2DSpeech)
  return { success: true }
})

ipcMain.handle('live2d:speech', (_e: any, payload: any) => {
  try {
    const text = String(payload?.text || '').trim()
    if (!text) return { success: false, error: 'Speech text is empty' }
    pendingLive2DSpeech = {
      text: text.slice(0, 600),
      expression: String(payload?.expression || 'neutral'),
      createdAt: Date.now(),
    }
    sendLive2DEvent('live2d:speech', pendingLive2DSpeech)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})

app.whenReady().then(() => {
  windowState = loadWindowState()

  // Register a custom protocol so the renderer can load Live2D model files
  // from userData via fetch() regardless of whether the window was loaded
  // from the Vite dev server (http://) or a file:// origin (production).
  // Maps userdata://<relative-path> to <userData>/<relative-path>.
  const { protocol } = electronModule
  const contentTypes: Record<string, string> = {
    '.json': 'application/json; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.moc3': 'application/octet-stream',
    '.motion3.json': 'application/json; charset=utf-8',
    '.exp3.json': 'application/json; charset=utf-8',
    '.physics3.json': 'application/json; charset=utf-8',
    '.cdi3.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
  }
  protocol.handle('userdata', async (request: any) => {
    try {
      // URL parsing is important here: Chromium percent-encodes non-ASCII
      // model filenames before the request reaches the custom protocol.
      // Reading the file directly also avoids net.fetch(file://...) returning
      // ERR_UNEXPECTED for binary assets such as .moc3 and large textures.
      const parsed = new URL(request.url)
      const relPath = decodeURIComponent(`${parsed.host}${parsed.pathname}`).replace(/^\/+/, '')
      const userDataRoot = resolve(app.getPath('userData'))
      const absPath = resolve(userDataRoot, relPath)
      if (absPath === userDataRoot || !absPath.startsWith(`${userDataRoot}${sep}`)) {
        return new Response('Not found', { status: 404 })
      }

      const body = await fs.promises.readFile(absPath)
      const lowerPath = absPath.toLowerCase()
      const contentType = Object.entries(contentTypes)
        .find(([extension]) => lowerPath.endsWith(extension))?.[1]
        ?? 'application/octet-stream'
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

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
  registerSearchIpc()
  registerLspIpc()
  registerSpotifyIpc()
  registerExportIpc()
  registerFullBackupIpc()
  registerWsIpc()
  registerPluginsIpc()
  registerWaifusIpc()
  registerPolicyIpc()
  registerRunService()
  registerLogIpc()
  registerRepositoryIpc()
  registerSkillsIpc()
  registerPendingPluginsIpc()
  registerTtsIpc()
  registerWechatIpc()
  registerBrowserIpc()
  startWsServer().catch((err) => mainLogger.error({ err }, 'ws-server failed to start'))
  autoResumeWechatBot().catch((err) => mainLogger.warn({ err }, 'wechat auto-resume failed'))

  setupTray()
  registerGlobalShortcuts()
})

app.on('before-quit', () => {
  applicationIsQuitting = true
})

app.on('will-quit', () => {
  applicationIsQuitting = true
  try { globalShortcut.unregisterAll() } catch { /* ignore */ }
})

app.on('window-all-closed', () => {
  // On macOS + Linux with a tray, keep the process alive. On Windows, quit.
  if (process.platform === 'win32') {
    app.quit()
  }
})

app.on('activate', () => {
  if (desktopPetModeActive && desktopPetWindow && !desktopPetWindow.isDestroyed()) {
    desktopPetWindow.show()
    desktopPetWindow.setAlwaysOnTop(true, 'screen-saver')
    desktopPetWindow.focus()
    return
  }
  if (mainWindow === null) {
    createWindow()
  } else {
    mainWindow.show()
  }
})

export {}
