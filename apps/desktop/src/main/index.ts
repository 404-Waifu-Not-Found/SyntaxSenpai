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

const { app, BrowserWindow, ipcMain, shell, clipboard, globalShortcut, Tray, Menu, nativeImage } = electronModule
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
import { startWsServer } from './ws-server'
import { mainLogger } from './logger'

const isDev = process.env.NODE_ENV === 'development'

let mainWindow: any = null
let tray: any = null

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
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

app.whenReady().then(() => {
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
  startWsServer().catch((err) => mainLogger.error({ err }, 'ws-server failed to start'))

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
