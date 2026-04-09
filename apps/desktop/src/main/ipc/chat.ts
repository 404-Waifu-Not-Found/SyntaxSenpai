const { ipcMain } = require('electron')
import * as storage from '@syntax-senpai/storage'

let registered = false

export function registerChatIpc() {
  if (registered) return
  registered = true

  // Create a platform chat store (desktop) using CHAT_DB_PATH if provided.
  const dbPath = process.env.CHAT_DB_PATH || undefined
  const store = storage.createChatStore('desktop', dbPath) as any
  const memoryStore = storage.createMemoryStore(dbPath)

  ipcMain.handle('store:createConversation', async (event: any, waifuId: string, title: string) => {
    try {
      const conv = await store.createConversation(waifuId, title)
      return { success: true, conversation: conv }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:listConversations', async (event: any, waifuId: string) => {
    try {
      const convs = await store.listConversations(waifuId)
      return { success: true, conversations: convs }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:addMessage', async (event: any, conversationId: string, message: any) => {
    try {
      await store.addMessage(conversationId, message)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:getMessages', async (event: any, conversationId: string) => {
    try {
      const msgs = await store.getMessages(conversationId)
      return { success: true, messages: msgs }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:deleteConversation', async (event: any, conversationId: string) => {
    try {
      await store.deleteConversation(conversationId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:updateConversation', async (event: any, id: string, updates: any) => {
    try {
      if (typeof store.updateConversation === 'function') {
        await store.updateConversation(id, updates)
        return { success: true }
      }
      return { success: false, error: 'updateConversation not supported by store' }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:getConversation', async (event: any, id: string) => {
    try {
      if (typeof store.getConversation === 'function') {
        const conv = await store.getConversation(id)
        return { success: true, conversation: conv }
      }
      return { success: false, error: 'getConversation not supported by store' }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:toggleFavorite', async (event: any, id: string) => {
    try {
      if (typeof store.toggleFavorite === 'function') {
        const favorited = await store.toggleFavorite(id)
        return { success: true, favorited }
      }
      return { success: false, error: 'toggleFavorite not supported by store' }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── AI Memory IPC handlers ──

  ipcMain.handle('memory:set', async (event: any, key: string, value: string, category?: string) => {
    try {
      await memoryStore.setMemory(key, value, category)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('memory:get', async (event: any, key: string) => {
    try {
      const entry = await memoryStore.getMemory(key)
      return { success: true, entry }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('memory:getAll', async () => {
    try {
      const entries = await memoryStore.getAllMemories()
      return { success: true, entries }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('memory:getByCategory', async (event: any, category: string) => {
    try {
      const entries = await memoryStore.getMemoriesByCategory(category)
      return { success: true, entries }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('memory:delete', async (event: any, key: string) => {
    try {
      await memoryStore.deleteMemory(key)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('memory:clear', async () => {
    try {
      await memoryStore.clearAllMemories()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

module.exports = { registerChatIpc }

export {}
