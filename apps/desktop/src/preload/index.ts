const electronModule = require('electron')
const { contextBridge, ipcRenderer } = electronModule

const listeners = new Map<string, Map<Function, Function>>()
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
    on: (channel: string, func: (...args: any[]) => void) => {
      const wrapped = (_event: any, ...args: any[]) => func(...args)
      if (!listeners.has(channel)) listeners.set(channel, new Map())
      const prior = listeners.get(channel)!.get(func)
      if (prior) ipcRenderer.removeListener(channel, prior)
      listeners.get(channel)!.set(func, wrapped)
      ipcRenderer.on(channel, wrapped)
    },
    once: (channel: string, func: (...args: any[]) => void) => ipcRenderer.once(channel, (_event: any, ...args: any[]) => func(...args)),
    removeListener: (channel: string, func: (...args: any[]) => void) => {
      const wrapped = listeners.get(channel)?.get(func)
      if (wrapped) ipcRenderer.removeListener(channel, wrapped)
      listeners.get(channel)?.delete(func)
    },
  }
})

// Expose system info — wrapped in try/catch so it never crashes the preload
try {
  const os = require('os')
  contextBridge.exposeInMainWorld('systemInfo', {
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromiumVersion: process.versions.chrome,
    homedir: os.homedir(),
    username: os.userInfo().username,
  })
} catch {
  contextBridge.exposeInMainWorld('systemInfo', {
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromiumVersion: process.versions.chrome,
    homedir: '',
    username: '',
  })
}

export {}
