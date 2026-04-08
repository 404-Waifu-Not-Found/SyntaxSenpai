const electronModule = require('electron')
const { contextBridge, ipcRenderer } = electronModule

// Expose IPC bridge FIRST — this is critical, must not be blocked
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
    on: (channel: string, func: (...args: any[]) => void) =>
      ipcRenderer.on(channel, (event: any, ...args: any[]) => func(...args)),
    once: (channel: string, func: (...args: any[]) => void) =>
      ipcRenderer.once(channel, (event: any, ...args: any[]) => func(...args)),
    removeListener: (channel: string, func: (...args: any[]) => void) =>
      ipcRenderer.removeListener(channel, func)
  }
})

// Expose system info — wrapped in try/catch so it never crashes the preload
try {
  const os = require('os')
  contextBridge.exposeInMainWorld('systemInfo', {
    platform: process.platform,
    homedir: os.homedir(),
    username: os.userInfo().username,
  })
} catch {
  contextBridge.exposeInMainWorld('systemInfo', {
    platform: process.platform,
    homedir: '',
    username: '',
  })
}

export {}
