import React, { useState, useEffect, useRef } from 'react'
import { builtInWaifus } from '@syntax-senpai/waifu-core'
import { AIChatRuntime } from '@syntax-senpai/ai-core'

// Simple localStorage-based key manager for desktop
class SimpleKeyManager {
  private service = 'syntax-senpai-keys'

  async setKey(provider: string, key: string): Promise<void> {
    const keys = JSON.parse(localStorage.getItem(this.service) || '{}')
    keys[provider] = key
    localStorage.setItem(this.service, JSON.stringify(keys))
  }

  async getKey(provider: string): Promise<string | null> {
    const keys = JSON.parse(localStorage.getItem(this.service) || '{}')
    return keys[provider] || null
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
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  // Handle setup
  const handleSetup = async (apiKeyValue: string) => {
    try {
      const keyManager = new SimpleKeyManager()
      await keyManager.setKey(selectedProvider, apiKeyValue)

      localStorage.setItem(
        'syntax-senpai-setup',
        JSON.stringify({
          waifuId: selectedWaifuId,
          provider: selectedProvider,
          hasSetup: true,
        })
      )

      setApiKeyState(apiKeyValue)
      setIsSetup(true)
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
    setInputValue('')
    setIsLoading(true)

    try {
      const keyManager = new SimpleKeyManager()
      const key = await keyManager.getKey(selectedProvider)

      if (!key) throw new Error(`No API key for ${selectedProvider}`)

      const runtime = new AIChatRuntime({
        provider: { type: selectedProvider as any, apiKey: key } as any,
        model: selectedProvider === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-20241022',
        systemPrompt: `You are ${selectedWaifu.displayName}. ${selectedWaifu.backstory}`,
      })

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
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '❌ ' + (err instanceof Error ? err.message : 'Error'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const runAgent = async () => {
    if (!agentCommand.trim() || isAgentRunning) return
    const confirmed = confirm('Execute this command on your machine? This will run shell commands with your user permissions. Continue?')
    if (!confirmed) return

    setIsAgentRunning(true)
    setAgentOutput('')
    try {
      const res = await (window as any).electron?.ipcRenderer?.invoke('agent:exec', { command: agentCommand })
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
              onClick={() => handleSetup(apiKey)}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded font-semibold"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Agent Modal
  if (showAgent) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-3xl w-full">
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
          <button
            onClick={() => setShowSettings(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg"
          >
            Get Started
          </button>
        </div>
      </div>
    )
  }

  // Main Chat Interface
  return (
    <div className="flex h-screen w-screen bg-gradient-to-br from-neutral-950 to-neutral-900 text-white overflow-hidden">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col p-4">
          <h1 className="text-xl font-bold text-indigo-400 mb-6">SyntaxSenpai</h1>
          <div className="bg-neutral-800 rounded-lg p-3 mb-6">
            <p className="text-xs text-neutral-400">Waifu</p>
            <p className="text-sm font-semibold">{selectedWaifu.displayName}</p>
          </div>
          <div className="bg-neutral-800 rounded-lg p-3 mb-6">
            <p className="text-xs text-neutral-400">Messages</p>
            <p className="text-sm font-semibold">{messages.length}</p>
          </div>
          <button onClick={() => setShowAgent(true)} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-semibold transition mb-3">
            🤖 Agent
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-semibold transition mb-3"
          >
            ⚙️ Settings
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setSidebarOpen(false)}
            className="w-full bg-neutral-800 hover:bg-neutral-700 text-white py-2 rounded-lg text-sm"
          >
            ← Collapse
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {!sidebarOpen && (
          <div className="flex items-center gap-3 bg-neutral-900 border-b border-neutral-800 px-4 py-3">
            <button onClick={() => setSidebarOpen(true)} className="hover:bg-neutral-800 p-2 rounded">☰</button>
            <h1 className="text-lg font-bold">{selectedWaifu.displayName}</h1>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-neutral-400">
              <div className="text-4xl mb-4">💬</div>
              <h3 className="text-lg font-semibold text-white mb-2">Chat with {selectedWaifu.displayName}</h3>
              <p className="text-sm">Start a conversation!</p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs lg:max-w-md rounded-lg px-4 py-3 ${
                msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-neutral-800 text-neutral-100 border border-neutral-700'
              }`}>
                <p className="break-words text-sm">{msg.content}</p>
                <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-indigo-200' : 'text-neutral-500'}`}>{msg.timestamp}</p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-neutral-800 rounded-lg px-4 py-3 border border-neutral-700">
                <div className="flex gap-2">
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-neutral-800 p-4 bg-neutral-900">
          <div className="flex gap-3">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage(inputValue)
                }
              }}
              placeholder="Say something..."
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-white placeholder-neutral-500 resize-none focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              style={{ maxHeight: '100px' }}
            />
            <button
              onClick={() => handleSendMessage(inputValue)}
              disabled={!inputValue.trim() || isLoading}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2 min-w-fit"
            >
              {isLoading ? <>⚙️ Sending</> : <>➤ Send</>}
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">Press Enter to send, Shift+Enter for newline</p>
        </div>
      </div>
    </div>
  )
}
