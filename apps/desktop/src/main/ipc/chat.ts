const { ipcMain } = require('electron')
const fs = require('fs').promises
const path = require('path')
import * as storage from '@syntax-senpai/storage'

let registered = false

function resolveDataPaths() {
  const dbPath = process.env.CHAT_DB_PATH || 'syntax-senpai.sqlite'
  return {
    dbPath,
    chatPath: dbPath.replace(/\.sqlite$/, '') + '.json',
    memoryPath: dbPath.replace(/\.sqlite$/, '') + '-memory.json',
  }
}

export function registerChatIpc() {
  if (registered) return
  registered = true

  // Create a platform chat store (desktop) using CHAT_DB_PATH if provided.
  const dbPath = process.env.CHAT_DB_PATH || undefined
  let store = storage.createChatStore('desktop', dbPath) as any
  let memoryStore = storage.createMemoryStore(dbPath)

  function resetStores() {
    store = storage.createChatStore('desktop', dbPath) as any
    memoryStore = storage.createMemoryStore(dbPath)
  }

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

  ipcMain.handle('store:clearMessages', async (event: any, conversationId: string) => {
    try {
      await store.deleteMessages(conversationId)
      if (typeof store.updateConversation === 'function') {
        await store.updateConversation(conversationId, { messageCount: 0 })
      }
      return { success: true }
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

  ipcMain.handle('store:replaceSnapshot', async (_event: any, payload: any) => {
    try {
      const { chatPath, memoryPath } = resolveDataPaths()
      const conversations = Array.isArray(payload?.conversations) ? payload.conversations : []
      const memories = Array.isArray(payload?.memories) ? payload.memories : []

      const chatData = {
        conversations: {} as Record<string, any>,
        messages: {} as Record<string, any[]>,
        relationships: {},
      }

      for (const conversation of conversations) {
        if (!conversation?.id) continue
        const messages = Array.isArray(conversation.messages) ? conversation.messages : []
        const { messages: _messages, ...conversationRecord } = conversation
        chatData.conversations[conversation.id] = {
          ...conversationRecord,
          messageCount: typeof conversationRecord.messageCount === 'number'
            ? conversationRecord.messageCount
            : messages.length,
        }
        chatData.messages[conversation.id] = messages.map((message: any) => ({
          ...message,
          createdAt: message.createdAt || message.timestamp || new Date().toISOString(),
        }))
      }

      const memoryData = memories.reduce((acc: Record<string, any>, entry: any) => {
        if (!entry?.key) return acc
        acc[entry.key] = {
          ...entry,
          category: entry.category || 'general',
          createdAt: entry.createdAt || new Date().toISOString(),
          updatedAt: entry.updatedAt || new Date().toISOString(),
        }
        return acc
      }, {})

      await fs.mkdir(path.dirname(chatPath), { recursive: true })
      await fs.writeFile(chatPath, JSON.stringify(chatData, null, 2), 'utf-8')
      await fs.writeFile(memoryPath, JSON.stringify(memoryData, null, 2), 'utf-8')
      resetStores()

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

module.exports = { registerChatIpc }

export {}
