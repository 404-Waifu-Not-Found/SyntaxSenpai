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

// Translate natural language to shell command using OpenAI (safe, JSON-only output preferred)
ipcMain.handle('agent:translate', async (event, { text, shellType = 'bash' } = {}) => {
  const settings = loadSettings();
  const provider = settings.apiProvider || 'local';
  const apiKey = settings.apiKey || '';
  const trimmed = (text || '').trim();
  if (provider !== 'openai' || !apiKey) {
    // simple heuristics fallback
    if (/^open\s+(https?:\/\/|\/|file:\/)/i.test(trimmed)) {
      const arg = trimmed.replace(/^open\s+/i, '');
      return { command: `open "${arg}"`, explanation: 'Open URL or path' };
    }
    if (/\b(list|ls|show)\b.*\b(files|dir|directory)\b/i.test(trimmed)) {
      return { command: 'ls -la', explanation: 'List files in the current directory' };
    }
    return { command: `echo "${trimmed.replace(/"/g, '\\"')}"`, explanation: 'Fallback echo (no API key or provider)' };
  }

  try {
    const systemPrompt = `You are an assistant that must translate user instructions into a single safe shell command for macOS (bash/zsh). Respond ONLY with a JSON object like {"command":"...","explanation":"..."} and nothing else. Use full paths when reasonable. Do NOT include destructive commands (rm -rf, sudo that modifies system, dd, etc.). If the instruction could be destructive, return {"command":"echo \"(refused)\"","explanation":"Refused for safety"}.`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Translate to a ${shellType} command: ${trimmed}` }
    ];

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.0, max_tokens: 200 })
    });

    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : '';
    // extract JSON blob
    const m = content.match(/{[\s\S]*}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        return { command: parsed.command || '', explanation: parsed.explanation || '', raw: content };
      } catch (e) {
        // fall through
      }
    }
    // fallback: return whole content as command
    return { command: content.trim(), explanation: '', raw: content };
  } catch (e) {
    return { error: String(e) };
  }
});

// Agent AI: run a chat completion using configured provider (OpenAI)
ipcMain.handle('agent:ai', async (event, { prompt, waifu = null, recentMessages = [] } = {}) => {
  const settings = loadSettings();
  const provider = settings.apiProvider || 'local';
  const apiKey = settings.apiKey || '';
  if (provider !== 'openai' || !apiKey) {
    // simple fallback
    const name = waifu && (waifu.displayName || waifu.name) ? (waifu.displayName || waifu.name) : 'Agent';
    return { reply: `${name}: ${prompt}` };
  }

  try {
    const systemPrompt = waifu && waifu.systemPromptTemplate ? waifu.systemPromptTemplate.replace('{{displayName}}', waifu.displayName || waifu.name || 'Assistant') : 'You are a helpful assistant.';
    const messages = [ { role: 'system', content: systemPrompt } ];
    for (const m of recentMessages || []) messages.push({ role: m.role, content: m.content });
    messages.push({ role: 'user', content: prompt });

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.2, max_tokens: 800 })
    });
    const data = await resp.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : '';
    return { reply: content, raw: data };
  } catch (e) {
    return { error: String(e) };
  }
});
