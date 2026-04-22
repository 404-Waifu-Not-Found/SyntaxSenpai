const { ipcMain } = require('electron')
const fs = require('fs').promises
const path = require('path')
import type { IpcMainInvokeEvent } from 'electron'
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

  ipcMain.handle('store:createConversation', async (_event: IpcMainInvokeEvent, waifuId: string, title: string) => {
    try {
      const conv = await store.createConversation(waifuId, title)
      return { success: true, conversation: conv }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:listConversations', async (_event: IpcMainInvokeEvent, waifuId: string) => {
    try {
      const convs = await store.listConversations(waifuId)
      return { success: true, conversations: convs }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:addMessage', async (_event: IpcMainInvokeEvent, conversationId: string, message: any) => {
    try {
      await store.addMessage(conversationId, message)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:getMessages', async (_event: IpcMainInvokeEvent, conversationId: string) => {
    try {
      const msgs = await store.getMessages(conversationId)
      return { success: true, messages: msgs }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:clearMessages', async (_event: IpcMainInvokeEvent, conversationId: string) => {
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

  ipcMain.handle('store:deleteMessage', async (_event: IpcMainInvokeEvent, conversationId: string, messageId: string) => {
    try {
      if (typeof (store as any).deleteMessage === 'function') {
        await (store as any).deleteMessage(conversationId, messageId)
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:deleteConversation', async (_event: IpcMainInvokeEvent, conversationId: string) => {
    try {
      await store.deleteConversation(conversationId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:updateConversation', async (_event: IpcMainInvokeEvent, id: string, updates: any) => {
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

  ipcMain.handle('store:getConversation', async (_event: IpcMainInvokeEvent, id: string) => {
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

  ipcMain.handle('store:toggleFavorite', async (_event: IpcMainInvokeEvent, id: string) => {
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

  ipcMain.handle('memory:set', async (_event: IpcMainInvokeEvent, key: string, value: string, category?: string) => {
    try {
      await memoryStore.setMemory(key, value, category)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('memory:get', async (_event: IpcMainInvokeEvent, key: string) => {
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

  ipcMain.handle('memory:getByCategory', async (_event: IpcMainInvokeEvent, category: string) => {
    try {
      const entries = await memoryStore.getMemoriesByCategory(category)
      return { success: true, entries }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('memory:delete', async (_event: IpcMainInvokeEvent, key: string) => {
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

  ipcMain.handle('store:searchConversations', async (_event: IpcMainInvokeEvent, query: string) => {
    try {
      const convs = await store.listConversations()
      if (!query || query.trim().length < 2) {
        return { success: true, conversationIds: convs.map((c: any) => c.id) }
      }
      const q = query.toLowerCase()
      const matchingIds: string[] = []
      for (const conv of convs) {
        if ((conv.title || '').toLowerCase().includes(q)) {
          matchingIds.push(conv.id)
          continue
        }
        const messages = await store.getMessages(conv.id)
        const hasMatch = messages.some((m: any) => {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
          return content.toLowerCase().includes(q)
        })
        if (hasMatch) matchingIds.push(conv.id)
      }
      return { success: true, conversationIds: matchingIds }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('store:replaceSnapshot', async (_event: IpcMainInvokeEvent, payload: any) => {
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
