import React, { useState, useEffect, useRef } from 'react'
import { builtInWaifus } from '@syntax-senpai/waifu-core'
import { AIChatRuntime } from '@syntax-senpai/ai-core'
import { motion, AnimatePresence } from 'framer-motion'
import Avatar from './components/Avatar'
import ChatBubble from './components/ChatBubble'
import TypingDots from './components/TypingDots'
import MessageSkeleton from './components/MessageSkeleton'

// Desktop Key Manager: prefers native keystore via IPC, falls back to localStorage when unavailable
class SimpleKeyManager {
  private service = 'syntax-senpai-keys'

  private ipc() {
    return (window as any).electron?.ipcRenderer
  }

  async setKey(provider: string, key: string): Promise<void> {
    try {
      const ipc = this.ipc()
      if (ipc) {
        const res = await ipc.invoke('keystore:set', provider, key || '')
        if (res && res.success) return
        // otherwise fall back
      }
    } catch (err) {
      // fall back to localStorage
    }

    const keys = JSON.parse(localStorage.getItem(this.service) || '{}')
    keys[provider] = key
    localStorage.setItem(this.service, JSON.stringify(keys))
  }

  async getKey(provider: string): Promise<string | null> {
    try {
      const ipc = this.ipc()
      if (ipc) {
        const res = await ipc.invoke('keystore:get', provider)
        if (res && res.success) return res.key || null
        // otherwise fall back
      }
    } catch (err) {
      // fall back
    }

    const keys = JSON.parse(localStorage.getItem(this.service) || '{}')
    return keys[provider] || null
  }

  async deleteKey(provider: string): Promise<boolean> {
    try {
      const ipc = this.ipc()
      if (ipc) {
        const res = await ipc.invoke('keystore:delete', provider)
        if (res && res.success) return !!res.deleted
      }
    } catch (err) {
      // ignore
    }
    const keys = JSON.parse(localStorage.getItem(this.service) || '{}')
    if (keys[provider]) {
      delete keys[provider]
      localStorage.setItem(this.service, JSON.stringify(keys))
      return true
    }
    return false
  }
}

// Dark theme is default

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export default function App() {
  // State
  const [isSetup, setIsSetup] = useState(false)
  const [selectedWaifuId, setSelectedWaifuId] = useState(builtInWaifus[0]?.id || 'aria')
  const [selectedProvider, setSelectedProvider] = useState('anthropic')
  const [apiKey, setApiKeyState] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showAgent, setShowAgent] = useState(false)
  const [agentCommand, setAgentCommand] = useState('')
  const [agentOutput, setAgentOutput] = useState('')
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [agentAllowed, setAgentAllowed] = useState<boolean>(() => localStorage.getItem('syntax-senpai-agent-permission') === 'true')
  const [showAgentLogs, setShowAgentLogs] = useState(false)
  const [agentLog, setAgentLog] = useState<string>('')
  const [showAuditModal, setShowAuditModal] = useState(false)
  const [auditEntries, setAuditEntries] = useState<any[]>([])
  const [auditRaw, setAuditRaw] = useState<string>('')
  // Allowlist
  const [showAllowlistModal, setShowAllowlistModal] = useState(false)
  const [allowlist, setAllowlist] = useState<string[]>([])
  const [newAllow, setNewAllow] = useState('')
  const [conversations, setConversations] = useState<any[]>([])
  const [convSearch, setConvSearch] = useState('')
  const [selectedConversationTitle, setSelectedConversationTitle] = useState<string>('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [recentMessageId, setRecentMessageId] = useState<string | null>(null)
  const [showCircle, setShowCircle] = useState(false)
  const [sentFeedback, setSentFeedback] = useState(false)

  // Highlight and clear recent message (used for pop animation)
  useEffect(() => {
    if (!recentMessageId) return
    const t = setTimeout(() => setRecentMessageId(null), 1100)
    return () => clearTimeout(t)
  }, [recentMessageId])

  // Auto-resize chat input when content changes
  useEffect(() => {
    const adjustInputHeight = () => {
      const el = inputRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
    adjustInputHeight()
  }, [inputValue])

  // Focus input on '/' when not typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(document.activeElement.tagName) === -1) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = messagesEndRef.current
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  // Animation variants for message list (stagger + item animations)
  const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
  const itemVariants = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } }

  const selectedWaifu = builtInWaifus.find((w) => w.id === selectedWaifuId) || builtInWaifus[0]

  // Load setup from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('syntax-senpai-setup')
    if (saved) {
      const { waifuId, provider, hasSetup } = JSON.parse(saved)
      if (hasSetup) {
        setSelectedWaifuId(waifuId)
        setSelectedProvider(provider)
        setIsSetup(true)
      }
    }
  }, [])

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Global keyboard shortcuts (Press / or Cmd/Ctrl+K to focus input)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = (document.activeElement && (document.activeElement as HTMLElement).tagName || '').toLowerCase()
      if (e.key === '/' && active !== 'input' && active !== 'textarea') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Create conversation helper + conversation list management
  async function createConversation(): Promise<string | null> {
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke(
        'store:createConversation',
        selectedWaifuId,
        `${selectedWaifu?.displayName || 'Conversation'} - ${new Date().toLocaleString()}`
      )
      if (res && res.success && res.conversation && res.conversation.id) {
        setConversationId(res.conversation.id)
        localStorage.setItem(`syntax-senpai-conv:${selectedWaifuId}`, res.conversation.id)
        // refresh conversation list
        try { await loadConversations() } catch (e) {}
        return res.conversation.id
      }
    } catch (err) {
      console.warn('createConversation failed:', err)
    }
    return null
  }

  async function loadConversations() {
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('store:listConversations', selectedWaifuId)
      if (res && res.success) setConversations(res.conversations || [])
    } catch (err) {
      console.warn('Failed to load conversations', err)
    }
  }

  async function selectConversationById(id: string) {
    try {
      setConversationId(id)
      const res = await (window as any).electron?.ipcRenderer?.invoke('store:getMessages', id)
      if (res && res.success) setMessages(res.messages || [])
      const conv = conversations.find((c: any) => c.id === id)
      if (conv) setSelectedConversationTitle(conv.title)
    } catch (err) {
      console.warn('Failed to select conversation', err)
    }
  }

  async function deleteConversationById(id: string) {
    if (!confirm('Delete this conversation? This cannot be undone.')) return
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('store:deleteConversation', id)
      if (res && res.success) {
        await loadConversations()
        if (conversationId === id) {
          setConversationId(null)
          setMessages([])
        }
      }
    } catch (err) {
      console.warn('Failed to delete conversation', err)
    }
  }

  // Rename a conversation
  async function renameConversationById(id: string) {
    try {
      const conv = conversations.find((c) => c.id === id)
      const current = conv?.title || 'Conversation'
      const newTitle = prompt('Rename conversation', current)
      if (!newTitle || newTitle.trim() === '' || newTitle === current) return
      const res = await (window as any).electron?.ipcRenderer?.invoke('store:updateConversation', id, { title: newTitle })
      if (res && res.success) {
        await loadConversations()
        if (conversationId === id) setSelectedConversationTitle(newTitle)
      } else {
        alert('Rename failed: ' + (res?.error || 'Unknown'))
      }
    } catch (err) {
      alert('Rename failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // Export conversation (messages + metadata)
  async function exportConversationById(id: string) {
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('store:getMessages', id)
      if (!(res && res.success)) { alert('Failed to export: ' + (res?.error || 'Unknown')); return }
      const conv = conversations.find((c) => c.id === id)
      const payload = { conversation: conv || null, messages: res.messages || [] }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(conv?.title || 'conversation').replace(/[^a-z0-9-_]/gi, '_')}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  useEffect(() => {
    if (isSetup) loadConversations().catch(() => {})
  }, [isSetup, selectedWaifuId])

  // Handle setup
  const handleSetup = async (apiKeyValue: string) => {
    try {
      const keyManager = new SimpleKeyManager()
      if (apiKeyValue && apiKeyValue.length > 0) {
        await keyManager.setKey(selectedProvider, apiKeyValue)
        setApiKeyState(apiKeyValue)
      } else {
        // Allow demo mode by clearing stored key for this provider
        await keyManager.setKey(selectedProvider, '')
        setApiKeyState('')
      }

      localStorage.setItem(
        'syntax-senpai-setup',
        JSON.stringify({
          waifuId: selectedWaifuId,
          provider: selectedProvider,
          hasSetup: true,
          demo: !apiKeyValue
        })
      )

      setIsSetup(true)
      // create a conversation for this waifu
      try {
        await createConversation()
      } catch (e) {
        // non-fatal
      }
      setShowSettings(false)
    } catch (err) {
      console.error('Setup failed:', err)
      alert('Setup failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  // Send message
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMsg])
    setRecentMessageId(userMsg.id)
    setInputValue('')
    setIsLoading(true)
    setShowCircle(true)

    try {
      // Ensure a conversation exists and persist the user message
      let convId = conversationId
      if (!convId) {
        convId = await createConversation()
        if (convId) setConversationId(convId)
      }
      if (convId) {
        try {
          await (window as any).electron?.ipcRenderer?.invoke('store:addMessage', convId, userMsg)
        } catch (err) {
          console.warn('Failed to persist user message', err)
        }
      }

      const keyManager = new SimpleKeyManager()
      const key = await keyManager.getKey(selectedProvider)

      // If no API key, use a lightweight mock stream so the app is usable in demo mode
      let runtime: any
      if (!key || key === '') {
        runtime = {
          async *streamMessage({ text: userText, history }: any) {
            const persona = selectedWaifu?.displayName || 'Assistant'
            const reply = `${persona}: ${userText.split('').reverse().join('')}`
            for (let i = 0; i < reply.length; i += 16) {
              await new Promise((r) => setTimeout(r, 30))
              yield { type: 'text_delta', delta: reply.slice(i, i + 16) }
            }
          }
        }
      } else {
        runtime = new AIChatRuntime({
          provider: { type: selectedProvider as any, apiKey: key } as any,
          model: selectedProvider === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-20241022',
          systemPrompt: `You are ${selectedWaifu.displayName}. ${selectedWaifu.backstory}`,
        })
      }

      const aiMessages = messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }))

      let assistantContent = ''
      const assistantId = `assistant-${Date.now()}`
      let added = false

      for await (const chunk of runtime.streamMessage({ text, history: aiMessages })) {
        if (chunk.type === 'text_delta' && chunk.delta) {
          assistantContent += chunk.delta

          if (!added) {
            setMessages((prev) => [...prev, {
              id: assistantId,
              role: 'assistant',
              content: assistantContent,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }])
            added = true
            setRecentMessageId(assistantId)
          } else {
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              if (last?.id === assistantId) {
                return [...prev.slice(0, -1), { ...last, content: assistantContent }]
              }
              return prev
            })
          }
        }
      }

      // Persist assistant's final message
      if (assistantContent) {
        const assistantMsg: Message = {
          id: assistantId,
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }
        try {
          if (!convId) convId = await createConversation()
          if (convId) {
            await (window as any).electron?.ipcRenderer?.invoke('store:addMessage', convId, assistantMsg)
          }
        } catch (err) {
          console.warn('Failed to persist assistant message', err)
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '❌ ' + (err instanceof Error ? err.message : 'Error'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }])
    } finally {
      setIsLoading(false)
      // keep expansion visible briefly so animation is seen
      setTimeout(() => setShowCircle(false), 1100)
      // show a brief sent feedback on the send button
      setSentFeedback(true)
      setTimeout(() => setSentFeedback(false), 900)
    }
  }

  const runAgent = async () => {
    if (!agentCommand.trim() || isAgentRunning) return
    if (!agentAllowed) {
      const open = confirm('Agent commands are currently disabled. Open settings to enable them?')
      if (open) {
        setShowSettings(true)
      }
      return
    }
    const confirmed = confirm('Execute this command on your machine? This will run shell commands with your user permissions. Continue?')
    if (!confirmed) return

    setIsAgentRunning(true)
    setAgentOutput('')
    try {
      const parseCmd = (s: string) => {
        const tokens = (s.match(/(?:[^\\s"']+|"[^"]*"|'[^']*')+/g) || []).map((t: string) => t.replace(/^['"]|['"]$/g, ''))
        return tokens
      }
      const parts = parseCmd(agentCommand)
      if (!parts || parts.length === 0) {
        setAgentOutput('Error: empty command')
        setIsAgentRunning(false)
        return
      }
      const cmd = parts[0]
      const cmdArgs = parts.slice(1)
      const res = await (window as any).electron?.ipcRenderer?.invoke('agent:exec', { command: cmd, args: cmdArgs })
      if (res && res.success) {
        setAgentOutput(`Exit: ${res.code}\n\nSTDOUT:\n${res.stdout || ''}\n\nSTDERR:\n${res.stderr || ''}`)
      } else {
        setAgentOutput('Error: ' + (res?.error || 'Unknown error'))
      }
    } catch (err) {
      setAgentOutput('Error: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsAgentRunning(false)
    }
  }

  const loadAgentLog = async () => {
    setShowAgentLogs(true)
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('agent:getLog')
      if (res && res.success) setAgentLog(res.content || '')
      else setAgentLog('No logs available')
    } catch (err) {
      setAgentLog('Error reading log: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const loadAgentAudit = async () => {
    setShowAuditModal(true)
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('agent:getAudit')
      if (res && res.success) {
        const raw = res.content || ''
        setAuditRaw(raw)
        const lines = raw.split('\n').filter((l: string) => l.trim())
        const entries = lines.map((l: string) => {
          try { return JSON.parse(l) } catch (e) { return { raw: l } }
        })
        setAuditEntries(entries)
      } else {
        setAuditRaw('')
        setAuditEntries([])
      }
    } catch (err) {
      setAuditRaw('Error reading audit: ' + (err instanceof Error ? err.message : String(err)))
      setAuditEntries([])
    }
  }

  const clearAudit = async () => {
    if (!confirm('Clear audit trail? This cannot be undone.')) return
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('agent:clearAudit')
      if (res && res.success) {
        setAuditRaw('')
        setAuditEntries([])
        alert('Audit cleared')
      } else {
        alert('Failed to clear audit: ' + (res?.error || 'Unknown'))
      }
    } catch (err) {
      alert('Failed to clear audit: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const exportAudit = () => {
    if (!auditRaw) { alert('No audit to export'); return }
    try {
      const blob = new Blob([auditRaw], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'agent-audit.jsonl'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // Allowlist functions
  const loadAllowlist = async () => {
    setShowAllowlistModal(true)
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('agent:getAllowlist')
      if (res && res.success) setAllowlist(Array.isArray(res.allowlist) ? res.allowlist : [])
      else setAllowlist([])
    } catch (err) {
      setAllowlist([])
    }
  }

  const addAllow = async () => {
    if (!newAllow.trim()) return
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('agent:addAllow', newAllow.trim())
      if (res && res.success) {
        setNewAllow('')
        await loadAllowlist()
      } else {
        alert('Failed to add: ' + (res?.error || 'Unknown'))
      }
    } catch (err) {
      alert('Failed to add: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const removeAllow = async (cmd: string) => {
    if (!confirm('Remove command from allowlist?')) return
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('agent:removeAllow', cmd)
      if (res && res.success) await loadAllowlist()
      else alert('Failed to remove: ' + (res?.error || 'Unknown'))
    } catch (err) {
      alert('Failed to remove: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const exportAllowlist = () => {
    if (!allowlist || allowlist.length === 0) { alert('No allowlist to export'); return }
    try {
      const blob = new Blob([JSON.stringify(allowlist, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'agent-allowlist.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // Settings Modal
  if (showSettings) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-md w-full">
          <h2 className="text-xl font-bold text-white mb-4">Settings</h2>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-white mb-2">Waifu</label>
            <select
              value={selectedWaifuId}
              onChange={(e) => setSelectedWaifuId(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
            >
              {builtInWaifus.map((w) => (
                <option key={w.id} value={w.id}>{w.displayName}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-white mb-2">Provider</label>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="mistral">Mistral</option>
              <option value="groq">Groq</option>
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-white mb-2">Agent Permissions</label>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center">
                <input type="checkbox" checked={agentAllowed} onChange={(e) => setAgentAllowed(e.target.checked)} className="mr-2" />
                <span className="text-sm text-neutral-300">Allow running agent commands</span>
              </label>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => { loadAgentLog().catch(()=>{}); }} className="bg-neutral-700 hover:bg-neutral-600 text-white py-1 px-3 rounded text-sm">Raw Logs</button>
                <button onClick={() => { loadAgentAudit().catch(()=>{}); }} className="bg-neutral-700 hover:bg-neutral-600 text-white py-1 px-3 rounded text-sm">Audit Trail</button>
                <button onClick={() => { loadAllowlist().catch(()=>{}); }} className="bg-neutral-700 hover:bg-neutral-600 text-white py-1 px-3 rounded text-sm">Allowlist</button>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-white mb-2">API Key</label>
            <input
              type="password"
              placeholder="sk-..."
              defaultValue={apiKey}
              onChange={(e) => setApiKeyState(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowSettings(false)}
              className="flex-1 bg-neutral-700 hover:bg-neutral-600 text-white py-2 rounded font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                handleSetup(apiKey)
                localStorage.setItem('syntax-senpai-agent-permission', agentAllowed ? 'true' : 'false')
                setShowSettings(false)
              }}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded font-semibold"
            >
              Save
            </button>
            <button
              onClick={() => { 
                // demo mode: no API key required
                localStorage.setItem('syntax-senpai-setup', JSON.stringify({ waifuId: selectedWaifuId, provider: selectedProvider, hasSetup: true, demo: true }))
                setIsSetup(true)
                setShowSettings(false)
              }}
              className="flex-1 bg-neutral-600 hover:bg-neutral-500 text-white py-2 rounded font-semibold"
            >
              Continue without API
            </button>
          </div>
        </div>

        {/* Agent Logs Modal */}
        {showAgentLogs && (
          <div className="fixed inset-0 flex items-center justify-center z-60">
            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-2xl w-full">
              <h3 className="text-lg font-semibold text-white mb-2">Agent Logs</h3>
              <div className="bg-neutral-800 p-3 rounded max-h-80 overflow-auto mb-4">
                <pre className="whitespace-pre-wrap text-sm text-neutral-200">{agentLog || 'No logs yet'}</pre>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowAgentLogs(false); setAgentLog('') }} className="bg-neutral-700 hover:bg-neutral-600 text-white py-2 px-4 rounded">Close</button>
                <button onClick={() => { setAgentLog(''); }} className="bg-neutral-700 hover:bg-neutral-600 text-white py-2 px-4 rounded">Clear View</button>
              </div>
            </div>
          </div>
        )}

        {/* Audit Trail Modal */}
        {showAuditModal && (
          <div className="fixed inset-0 flex items-center justify-center z-60 anim-overlayShow">
            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-3xl w-full anim-contentShow">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Agent Audit Trail</h3>
                <div className="flex gap-2">
                  <button onClick={() => exportAudit()} className="bg-indigo-600 hover:bg-indigo-700 text-white py-1 px-3 rounded text-sm">Export</button>
                  <button onClick={() => { clearAudit().catch(()=>{}) }} className="bg-red-600 hover:bg-red-700 text-white py-1 px-3 rounded text-sm">Clear</button>
                </div>
              </div>
              <div className="bg-neutral-800 p-3 rounded max-h-96 overflow-auto mb-4">
                {auditEntries.length === 0 && <pre className="whitespace-pre-wrap text-sm text-neutral-200">{auditRaw || 'No audit entries'}</pre>}
                {auditEntries.length > 0 && (
                  <ul className="space-y-3 text-sm">
                    {auditEntries.map((a:any, idx:number) => (
                      <li key={idx} className="bg-neutral-900 p-3 rounded border border-neutral-700">
                        <div className="text-xs text-neutral-400 mb-1">{a.timestamp || a.timestamp}</div>
                        <div className="font-mono text-sm text-neutral-200 break-words">{a.command}</div>
                        <div className="text-xs text-neutral-400 mt-1">{a.allowed ? 'Allowed' : 'Denied'} • {a.success ? `Success (code ${a.code})` : (a.error || '')}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowAuditModal(false); setAuditRaw(''); setAuditEntries([]) }} className="bg-neutral-700 hover:bg-neutral-600 text-white py-2 px-4 rounded">Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Allowlist Modal */}
        {showAllowlistModal && (
          <div className="fixed inset-0 flex items-center justify-center z-60 anim-overlayShow">
            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-lg w-full anim-contentShow">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Agent Allowlist</h3>
                <div className="flex gap-2">
                  <button onClick={() => exportAllowlist()} className="bg-indigo-600 hover:bg-indigo-700 text-white py-1 px-3 rounded text-sm">Export</button>
                  <button onClick={async () => { if(!confirm('Clear allowlist?')) return; const res = await (window as any).electron?.ipcRenderer?.invoke('agent:setAllowlist', []); if (res && res.success) { setAllowlist([]); alert('Allowlist cleared') } else { alert('Failed to clear allowlist: ' + (res?.error || 'Unknown')) } }} className="bg-red-600 hover:bg-red-700 text-white py-1 px-3 rounded text-sm">Clear</button>
                </div>
              </div>
              <div className="bg-neutral-800 p-3 rounded max-h-72 overflow-auto mb-4">
                <ul className="space-y-2 text-sm">
                  {allowlist.length === 0 && <div className="text-neutral-400">No allowed commands</div>}
                  {allowlist.map((cmd:string, idx:number) => (
                    <li key={idx} className="flex items-center justify-between bg-neutral-900 p-2 rounded border border-neutral-700">
                      <div className="font-mono text-sm text-neutral-200">{cmd}</div>
                      <div className="flex gap-2">
                        <button onClick={()=>removeAllow(cmd)} className="text-xs text-red-400 hover:text-red-300 px-2">Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-2">
                <input value={newAllow} onChange={(e)=>setNewAllow(e.target.value)} placeholder="command (e.g., ls)" className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white text-sm" />
                <button onClick={() => addAllow()} className="bg-green-600 hover:bg-green-700 text-white py-2 px-3 rounded text-sm">Add</button>
                <button onClick={() => { setShowAllowlistModal(false); setNewAllow(''); }} className="bg-neutral-700 hover:bg-neutral-600 text-white py-2 px-3 rounded text-sm">Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Agent Modal
  if (showAgent) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 anim-overlayShow">
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-3xl w-full anim-contentShow">
          <h2 className="text-xl font-bold text-white mb-4">Agent</h2>
          <p className="text-sm text-neutral-400 mb-4">Run commands on this machine. Use with caution.</p>
          <div className="mb-4 flex gap-2">
            <input value={agentCommand} onChange={(e) => setAgentCommand(e.target.value)} placeholder="ls -la" className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white" />
            <button onClick={runAgent} disabled={!agentCommand.trim() || isAgentRunning} className="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded">
              {isAgentRunning ? 'Running...' : 'Run'}
            </button>
            <button onClick={() => { setAgentOutput(''); setAgentCommand('') }} className="bg-neutral-700 hover:bg-neutral-600 text-white py-2 px-4 rounded">Clear</button>
            <button onClick={() => setShowAgent(false)} className="bg-neutral-700 hover:bg-neutral-600 text-white py-2 px-4 rounded">Close</button>
          </div>
          <div className="bg-neutral-800 rounded p-3 max-h-80 overflow-auto">
            <pre className="whitespace-pre-wrap text-sm text-neutral-200">{agentOutput || 'No output yet'}</pre>
          </div>
        </div>
      </div>
    )
  }

  // Setup Screen
  if (!isSetup) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-gradient-to-br from-neutral-950 to-neutral-900">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">✨</div>
          <h1 className="text-4xl font-bold text-white mb-3">SyntaxSenpai</h1>
          <p className="text-neutral-400 mb-8">Your AI companion that codes with you</p>
          <div className="space-y-3">
            <button
              onClick={() => setShowSettings(true)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg"
            >
              Get Started
            </button>
            <button
              onClick={() => { localStorage.setItem('syntax-senpai-setup', JSON.stringify({ waifuId: selectedWaifuId, provider: selectedProvider, hasSetup: true, demo: true })); setIsSetup(true) }}
              className="w-full bg-neutral-700 hover:bg-neutral-600 text-white font-bold py-3 rounded-lg"
            >
              Try Demo Mode (no API)
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Main Chat Interface
  return (
    <div className="relative flex h-screen w-screen bg-gradient-to-br from-neutral-950 to-neutral-900 text-white overflow-hidden">
      {/* Ambient animated gradient */}
      <motion.div className="absolute inset-0 pointer-events-none -z-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 10% 10%, rgba(99,102,241,0.12), transparent 8%), radial-gradient(circle at 90% 90%, rgba(236,72,153,0.08), transparent 18%)', filter: 'blur(40px)', transform: 'scale(1.02)' }} />
      </motion.div>

      {/* AIRI-inspired circle expansion background */}
      <motion.div className="circle-expansion-transition pointer-events-none -z-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }} style={{ '--circle-expansion-duration': '0.6s', '--circle-expansion-delay': '0s', '--circle-expansion-color-1': 'rgba(99,102,241,0.06)', '--circle-expansion-color-2': 'rgba(236,72,153,0.04)', '--circle-expansion-color-3': 'rgba(99,102,241,0.03)', '--circle-expansion-color-4': 'rgba(236,72,153,0.015)' } as any}>
        <div />
        <div />
        <div />
        <div />
      </motion.div>

      {showCircle && (
        <div className="circle-expansion-transition pointer-events-none -z-10 animate-on-send" style={{ '--circle-expansion-duration': '0.6s', '--circle-expansion-delay': '0s', '--circle-expansion-color-1': 'rgba(99,102,241,0.12)', '--circle-expansion-color-2': 'rgba(236,72,153,0.10)', '--circle-expansion-color-3': 'rgba(99,102,241,0.06)', '--circle-expansion-color-4': 'rgba(236,72,153,0.03)' } as any}>
          <div />
          <div />
          <div />
          <div />
        </div>
      )}

      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -24, opacity: 0 }} transition={{ duration: 0.18 }} className="w-72 bg-neutral-900 border-r border-neutral-800 flex flex-col p-4">
            <h1 className="text-xl font-bold text-indigo-400 mb-4">SyntaxSenpai</h1>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1">
                <p className="text-xs text-neutral-400">Waifu</p>
                <p className="text-sm font-semibold">{selectedWaifu.displayName}</p>
              </div>
              <button onClick={() => createConversation()} className="bg-neutral-800 hover:bg-neutral-700 text-white px-3 py-1 rounded text-sm">New</button>
            </div>
            <div className="mb-3">
              <input value={convSearch} onChange={(e) => setConvSearch(e.target.value)} placeholder="Search conversations" className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white text-sm" />
            </div>
            <div className="flex-1 overflow-auto">
              {conversations.length === 0 && <p className="text-xs text-neutral-500">No conversations yet</p>}
              <ul className="space-y-2 mt-2">
                {conversations.filter(c => !convSearch || (c.title || '').toLowerCase().includes(convSearch.toLowerCase())).map((c:any) => (
                  <motion.li key={c.id} layout whileHover={{ y: -3 }} whileTap={{ scale: 0.995 }} className={`conversation-item ${conversationId === c.id ? 'active' : ''}`}>
                    <button onClick={() => selectConversationById(c.id)} className="flex items-center gap-3 w-full text-left">
                      <Avatar name={c.title || selectedWaifu?.displayName} />
                      <div className="flex-1">
                        <div className="title">{c.title}</div>
                        <div className="meta">{new Date(c.updatedAt).toLocaleString()}</div>
                      </div>
                      {c.unreadCount ? <div className="unread-badge">{c.unreadCount}</div> : null}
                    </button>
                    <div className="flex gap-2 ml-2 items-center">
                      <button onClick={() => renameConversationById(c.id)} title="Rename" className="text-xs text-yellow-400 hover:text-yellow-300 px-2">✎</button>
                      <button onClick={() => exportConversationById(c.id)} title="Export" className="text-xs text-blue-300 hover:text-blue-200 px-2">⤓</button>
                      <button onClick={() => deleteConversationById(c.id)} className="text-xs text-red-400 hover:text-red-300 px-2">✕</button>
                    </div>
                  </motion.li>
                ))}
              </ul>
            </div>
            <div className="mt-3">
              <button onClick={() => setShowAgent(true)} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-semibold transition mb-2">🤖 Agent</button>
              <button onClick={() => setShowSettings(true)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-semibold transition">⚙️ Settings</button>
            </div>
            <div className="mt-3">
              <button onClick={() => setSidebarOpen(false)} className="w-full bg-neutral-800 hover:bg-neutral-700 text-white py-2 rounded-lg text-sm">← Collapse</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Sticky header with quick actions */}
        <div className="sticky top-0 z-20 px-6 py-3 bg-neutral-900/40 backdrop-blur-sm border-b border-neutral-800 flex items-center justify-between glass-card ambient-subtle">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded hover:bg-neutral-800">{sidebarOpen ? '←' : '☰'}</button>
            <div>
              <div className="text-lg font-bold">{selectedWaifu.displayName}</div>
              <div className="text-xs text-neutral-400">{selectedWaifu?.backstory?.slice(0, 60)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <motion.button whileHover={{ scale: 1.05 }} onClick={() => setShowSettings(true)} className="p-2 rounded bg-neutral-800 hover:bg-neutral-700">⚙️</motion.button>
            <motion.button whileHover={{ scale: 1.05 }} onClick={() => setShowAgent(true)} className="p-2 rounded bg-neutral-800 hover:bg-neutral-700">🤖</motion.button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-neutral-400">
              <div className="text-4xl mb-4">💬</div>
              <h3 className="text-lg font-semibold text-white mb-2">Chat with {selectedWaifu.displayName}</h3>
              <p className="text-sm">Start a conversation!</p>
            </div>
          )}
          <AnimatePresence initial={false}>
            <motion.ul variants={listVariants} initial="hidden" animate="show" className="space-y-4 w-full">
              {messages.map((msg) => (
                <motion.li key={msg.id} variants={itemVariants} exit="exit" layout className={`flex ${msg.role === 'user' ? 'justify-end items-end' : 'justify-start items-start'}`}>
                  {msg.role !== 'user' && (
                    <div className="mr-3 flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center text-xs font-semibold">{selectedWaifu?.displayName?.[0] || 'A'}</div>
                    </div>
                  )}
                  <ChatBubble id={msg.id} role={msg.role} content={msg.content} timestamp={msg.timestamp} recent={msg.id === recentMessageId} />
                  {msg.role === 'user' && (
                    <div className="ml-3 flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-indigo-700 flex items-center justify-center text-xs font-semibold">U</div>
                    </div>
                  )}
                </motion.li>
              ))}
            </motion.ul>
          </AnimatePresence>
          {isLoading && (
            <div role="status" aria-live="polite" className="flex flex-col gap-2">
              <MessageSkeleton />
              <div className="flex justify-start">
                <ChatBubble role="assistant" content={<TypingDots />} showCopy={false} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

{/* Input */}
        <div className="border-t border-neutral-800 p-4 glass-card">
          <div className="flex gap-3">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value) }}
              onInput={() => { const el = inputRef.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage(inputValue)
                }
              }}
              placeholder="Say something... (Press / to focus)"
              disabled={isLoading}
              rows={1}
              aria-label="Chat input"
              className="chat-input flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-white placeholder-neutral-500 resize-none focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              style={{ maxHeight: '100px' }}
            />
            <motion.button
              onClick={() => handleSendMessage(inputValue)}
              whileTap={{ scale: 0.97 }}
              animate={{ scale: isLoading ? 0.98 : 1 }}
              disabled={!inputValue.trim() || isLoading}
              className={`btn-micro bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2 min-w-fit ${(isLoading || sentFeedback) ? 'sending' : ''}` }
            >
              {isLoading ? <>⚙️ Sending</> : (sentFeedback ? <>✓ Sent</> : <>➤ Send</>)}
            </motion.button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">Press Enter to send, Shift+Enter for newline</p>
        </div>
      </div>
    </div>
  )
}
