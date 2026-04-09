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

const { app, BrowserWindow, ipcMain, shell } = electronModule
const { join } = require('path')
import { registerChatIpc } from './ipc/chat'
import { registerAgentIpc } from './ipc/agent'
import { registerKeystoreIpc } from './ipc/keystore'
import { registerProviderIpc } from './ipc/provider'
import { registerTerminalIpc } from './ipc/terminal'
import { registerSpotifyIpc } from './ipc/spotify'
import { registerExportIpc } from './ipc/export'

const isDev = process.env.NODE_ENV === 'development'

let mainWindow: any = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
  registerSpotifyIpc()
  registerExportIpc()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

export {}
