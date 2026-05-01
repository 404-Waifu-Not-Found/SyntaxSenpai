const electronModule = require('electron')
const path = require('path')
const { contextBridge, ipcRenderer } = electronModule

function resolveCubismNativePath() {
  if (process.env.CUBISM_NATIVE_PATH) {
    return process.env.CUBISM_NATIVE_PATH
  }

  const packagedPath = path.resolve(__dirname, 'cubism_native.node')
  const developmentPath = path.resolve(__dirname, '..', '..', 'native', 'build', 'Release', 'cubism_native.node')
  return process.env.NODE_ENV === 'production' ? packagedPath : developmentPath
}

let cubismNative: any = null
function getCubismNative() {
  if (cubismNative !== null) {
    return cubismNative
  }

  const nativePath = resolveCubismNativePath()
  try {
    cubismNative = require(nativePath)
  } catch (error) {
    console.warn('[cubism] failed to load native module', nativePath, error)
    cubismNative = null
  }
  return cubismNative
}

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

contextBridge.exposeInMainWorld('cubism', {
  isAvailable: () => !!getCubismNative(),
  init: () => {
    const module = getCubismNative()
    return module ? module.initCubism() : false
  },
  getVersion: () => {
    const module = getCubismNative()
    return module ? module.getVersion() : null
  },
  loadModelInfo: (modelJsonPath: string) => {
    const module = getCubismNative()
    return module ? module.loadModelInfo(modelJsonPath) : null
  },
  releaseModel: (modelId: number) => {
    const module = getCubismNative()
    return module ? module.releaseModel(modelId) : null
  },
  dispose: () => {
    const module = getCubismNative()
    return module ? module.dispose() : false
  }
})

contextBridge.exposeInMainWorld('l2d', {
  importModel: () => ipcRenderer.invoke('l2d:importModel'),
  listModels: () => ipcRenderer.invoke('l2d:listModels'),
  deleteModel: (modelId: string) => ipcRenderer.invoke('l2d:deleteModel', modelId),
  getModel: (modelId: string) => ipcRenderer.invoke('l2d:getModel', modelId),
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
