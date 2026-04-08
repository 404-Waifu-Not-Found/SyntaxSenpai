import React, { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type Props = {
  id?: string
  role?: 'user' | 'assistant'
  content: React.ReactNode
  timestamp?: string
  recent?: boolean
  showCopy?: boolean
}

export default function ChatBubble({ role = 'assistant', content, timestamp, recent = false, showCopy = true }: Props) {
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const handleCopy = async () => {
    try {
      // Prefer explicit text if available, otherwise use the rendered text content
      const text = typeof content === 'string' ? content : (containerRef.current?.innerText || '')
      if (!text) return
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch (e) {
      // ignore
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 300 }}
      className={`msg-bubble ${role === 'user' ? 'user' : ''} ${recent ? 'recent' : ''} max-w-xs lg:max-w-md px-4 py-3 rounded-xl`}
    >
      <div style={{ position: 'relative' }} ref={containerRef}>
        <div className="break-words text-sm" style={{ whiteSpace: 'pre-wrap', paddingRight: '48px' }}>{content}</div>
        {showCopy !== false && (
          <>
            <button onClick={handleCopy} aria-label="Copy message" className="absolute top-2 right-2 text-xs bg-neutral-800 hover:bg-neutral-700 px-2 py-1 rounded opacity-90">{copied ? 'Copied' : 'Copy'}</button>
            <AnimatePresence>
              {copied && (
                <motion.span className="copy-toast" initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1.02 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} transition={{ duration: 0.45 }}>
                  Copied
                </motion.span>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {timestamp ? <p className={`text-xs mt-1 ${role === 'user' ? 'text-indigo-200' : 'text-neutral-500'}`}>{timestamp}</p> : null}
    </motion.div>
  )
}
