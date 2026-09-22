const TIMESTAMP_TITLE = /\s-\s\d{1,4}[/-]\d{1,4}[/-]\d{2,4}(?:,|\s|$)/

export function needsAutomaticConversationTitle(title: unknown, waifuDisplayName?: string): boolean {
  const normalized = String(title ?? '').trim()
  if (!normalized || /^untitled conversation$/i.test(normalized)) return true
  if (TIMESTAMP_TITLE.test(normalized)) return true

  const displayName = String(waifuDisplayName ?? '').trim()
  return displayName.length > 0
    && normalized.startsWith(`${displayName} - `)
    && /\d/.test(normalized.slice(displayName.length + 3))
}

export function fallbackConversationTitle(message: string): string {
  const normalized = String(message ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .trim()
  const compact = normalized.split(' ').slice(0, 8).join(' ').replace(/[,:;.!?]+$/, '').trim()
  return (compact || 'New conversation').slice(0, 60)
}
