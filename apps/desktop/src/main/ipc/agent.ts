const { ipcMain } = require('electron')
const executor = require('../agent/executor')

ipcMain.handle('agent:exec', async (event, payload) => {
  return await executor.runCommand(payload)
})

ipcMain.handle('agent:readFile', async (event, filePath) => {
  return await executor.readFile(filePath)
})

ipcMain.handle('agent:writeFile', async (event, filePath, content) => {
  return await executor.writeFile(filePath, content)
})

ipcMain.handle('agent:openExternal', async (event, url) => {
  return await executor.openExternal(url)
})

module.exports = {}
