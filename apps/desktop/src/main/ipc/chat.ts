const { ipcMain } = require('electron')
const storage = require('@syntax-senpai/storage')

// Create a platform chat store (desktop)
const store = storage.createChatStore ? storage.createChatStore('desktop') : storage.createChatStore('desktop')

ipcMain.handle('store:createConversation', async (event, waifuId, title) => {
  try {
    const conv = await store.createConversation(waifuId, title)
    return { success: true, conversation: conv }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('store:listConversations', async (event, waifuId) => {
  try {
    const convs = await store.listConversations(waifuId)
    return { success: true, conversations: convs }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('store:addMessage', async (event, conversationId, message) => {
  try {
    await store.addMessage(conversationId, message)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('store:getMessages', async (event, conversationId) => {
  try {
    const msgs = await store.getMessages(conversationId)
    return { success: true, messages: msgs }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('store:deleteConversation', async (event, conversationId) => {
  try {
    await store.deleteConversation(conversationId)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

module.exports = {}
