import React from 'react'

type AvatarProps = {
  name?: string
  src?: string
  size?: number
  className?: string
}

export default function Avatar({ name, src, size = 40, className = '' }: AvatarProps) {
  const initials = (name || 'A').toString().trim().split(/\s+/).map(s => s[0] || '').slice(0, 2).join('').toUpperCase()
  const style: React.CSSProperties = { width: size, height: size }

  return (
    <div className={`avatar ${className}`} style={style}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
      ) : (
        <span style={{ fontWeight: 700 }}>{initials}</span>
      )}
    </div>
  )
}
