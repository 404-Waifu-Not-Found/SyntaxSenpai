const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { allowSystemControl: false, openDevTools: false, apiProvider: 'local', apiKey: '' };
  }
}

function saveSettings(s) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings', e);
  }
}

let mainWindow;
function createWindow() {
  const settings = loadSettings();
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Only open devtools if explicitly enabled in settings or env
  if (settings.openDevTools || process.env.SS_OPEN_DEVTOOLS === '1') {
    try { mainWindow.webContents.openDevTools(); } catch (e) {}
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Settings handlers
ipcMain.handle('settings:get', async () => {
  return loadSettings();
});

ipcMain.handle('settings:set', async (event, newSettings) => {
  const current = loadSettings();
  const merged = Object.assign({}, current, newSettings);
  saveSettings(merged);
  // apply devtools change immediately
  try {
    const wins = BrowserWindow.getAllWindows();
    wins.forEach(w => {
      if (merged.openDevTools) w.webContents.openDevTools(); else w.webContents.closeDevTools();
    });
  } catch (e) {}
  return merged;
});

// Agent: execute a shell command (requires allowSystemControl in settings)
ipcMain.handle('agent:exec', async (event, { command, timeout = 600000 }) => {
  const settings = loadSettings();
  if (!settings.allowSystemControl) {
    const resp = await dialog.showMessageBox({
      type: 'warning',
      message: 'System control is disabled. Enable it in Settings to run commands.',
      buttons: ['Open Settings', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    });
    if (resp.response === 0) {
      return { error: 'System control disabled', action: 'open-settings' };
    }
    return { error: 'System control disabled' };
  }

  return new Promise((resolve) => {
    const child = exec(command, { timeout, shell: true }, (err, stdout, stderr) => {
      const exitCode = err && err.code ? err.code : 0;
      resolve({ stdout: stdout || '', stderr: stderr || '', exitCode, error: err ? String(err) : null });
    });

    // stream stdout/stderr to renderer in real time
    child.stdout && child.stdout.on('data', chunk => {
      try { mainWindow && mainWindow.webContents.send('agent:stream', { type: 'stdout', data: String(chunk) }); } catch (e) {}
    });
    child.stderr && child.stderr.on('data', chunk => {
      try { mainWindow && mainWindow.webContents.send('agent:stream', { type: 'stderr', data: String(chunk) }); } catch (e) {}
    });
  });
});

ipcMain.handle('agent:list', async (event, { dir }) => {
  const target = dir || app.getPath('home');
  try {
    const files = fs.readdirSync(target);
    return { files };
  } catch (e) { return { error: String(e) }; }
});

ipcMain.handle('agent:readFile', async (event, { path: filePath, encoding = 'utf8' }) => {
  try {
    const content = fs.readFileSync(filePath, encoding);
    return { content };
  } catch (e) { return { error: String(e) }; }
});

ipcMain.handle('agent:openPath', async (event, { path: pth }) => {
  try {
    const result = await shell.openPath(pth);
    return { result };
  } catch (e) { return { error: String(e) }; }
});
