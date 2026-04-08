import React from 'react'
import { motion } from 'framer-motion'

export default function MessageSkeleton() {
  return (
    <motion.div className="skeleton-row" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <div className="skeleton-avatar" />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ marginBottom: 8 }} />
        <div className="skeleton short" />
      </div>
    </motion.div>
  )
}
