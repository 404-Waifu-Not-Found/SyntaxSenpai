const electronModule = require('electron')
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

app.on('ready', createWindow)

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

// IPC handlers for agent actions
const { spawn } = require('child_process')
const fs = require('fs').promises
const pathModule = require('path')

ipcMain.handle('agent:exec', async (event, { command, args = [], cwd = undefined } = {}) => {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { shell: true, cwd, env: process.env })
      let stdout = ''
      let stderr = ''
      child.stdout && child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      child.stderr && child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      child.on('close', (code) => {
        resolve({ success: true, code, stdout, stderr })
      })
      child.on('error', (err) => {
        resolve({ success: false, error: err.message })
      })
    } catch (err) {
      resolve({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
})

ipcMain.handle('agent:readFile', async (event, filePath) => {
  try {
    const content = await fs.readFile(pathModule.resolve(filePath), 'utf-8')
    return { success: true, content }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('agent:writeFile', async (event, filePath, content) => {
  try {
    await fs.writeFile(pathModule.resolve(filePath), content, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('agent:openExternal', async (event, url) => {
  try {
    await shell.openExternal(url)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})
