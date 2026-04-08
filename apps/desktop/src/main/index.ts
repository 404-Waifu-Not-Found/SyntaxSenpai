const electronModule = require('electron')

// If require('electron') returned a path string, this process is the npm wrapper
// running under plain Node. Spawn the real Electron binary and pass along args.
if (typeof electronModule === 'string') {
  const cp = require('child_process')
  const bin = electronModule
  const args = process.argv.slice(1) // include the script path and any args
  console.log('DEBUG: detected electron wrapper; spawning real binary:', bin, args)
  const child = cp.spawn(bin, args, { stdio: 'inherit', detached: true })
  // Allow the child to continue if the parent exits
  try { child.unref && child.unref() } catch (e) {}
  // Exit current wrapper process; the spawned Electron will run the app
  process.exit(0)
}

const { app, BrowserWindow, ipcMain, shell } = electronModule
const { join } = require('path')

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

  // Load IPC handlers after app is ready so they can access app.getPath
  require('./ipc/chat')
  require('./ipc/agent')
  require('./ipc/keystore')
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
