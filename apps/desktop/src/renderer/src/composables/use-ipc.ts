function getIpc() {
  return (window as any).electron?.ipcRenderer
}

export function useIpc() {
  async function invoke<T = any>(channel: string, ...args: any[]): Promise<T> {
    const ipc = getIpc()
    if (!ipc) throw new Error('IPC not available')
    return ipc.invoke(channel, ...args)
  }

  function on(channel: string, handler: (...args: any[]) => void) {
    const ipc = getIpc()
    ipc?.on(channel, handler)
    return () => ipc?.removeListener(channel, handler)
  }

  return { invoke, on }
}
