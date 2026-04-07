const electronModule = require('electron')
const { contextBridge, ipcRenderer } = electronModule

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, data: any) => ipcRenderer.send(channel, data),
    invoke: (channel: string, data: any) => ipcRenderer.invoke(channel, data),
    on: (channel: string, func: (...args: any[]) => void) =>
      ipcRenderer.on(channel, (event, ...args) => func(...args)),
    once: (channel: string, func: (...args: any[]) => void) =>
      ipcRenderer.once(channel, (event, ...args) => func(...args)),
    removeListener: (channel: string, func: (...args: any[]) => void) =>
      ipcRenderer.removeListener(channel, func)
  }
})
