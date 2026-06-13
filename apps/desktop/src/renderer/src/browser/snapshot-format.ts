// Pure formatter: raw snapshot (from the injected script) → compact string
// the model can act on. No DOM, no Electron — unit-testable in node.

import type { RawSnapshot, RawSnapshotElement } from './snapshot-script'

export const MAX_SNAPSHOT_TEXT_CHARS = 14000

function formatElement(el: RawSnapshotElement): string {
  let line = `[${el.ref}] ${el.role}`
  if (el.name) line += ` "${el.name}"`
  if (el.value !== undefined) line += ` value="${el.value}"`
  if (el.checked !== undefined) line += el.checked ? ' (checked)' : ' (unchecked)'
  if (el.disabled) line += ' (disabled)'
  if (el.href) line += ` → ${el.href}`
  if (!el.inViewport) line += ' [offscreen]'
  return line
}

export function formatSnapshot(raw: RawSnapshot | null | undefined): string {
  if (!raw || typeof raw !== 'object') {
    return 'Snapshot failed: page returned no data (it may still be loading — try browser_snapshot again).'
  }

  const lines: string[] = []
  lines.push(`Page: ${raw.title || '(untitled)'} — ${raw.url || 'about:blank'}`)

  const total = (raw.scrollMax || 0) + (raw.viewportH || 0)
  if (raw.scrollMax > 0 && total > 0) {
    const pct = Math.round((raw.scrollY / raw.scrollMax) * 100)
    const viewports = Math.max(1, Math.ceil(total / Math.max(1, raw.viewportH)))
    const current = Math.min(viewports, Math.floor(raw.scrollY / Math.max(1, raw.viewportH)) + 1)
    lines.push(`Scroll: ${pct}% (viewport ${current} of ~${viewports}) — browser_scroll reveals more`)
  } else {
    lines.push('Scroll: page fits in one viewport')
  }

  const elements = Array.isArray(raw.elements) ? raw.elements : []
  if (elements.length > 0) {
    lines.push('', 'Interactive elements (use refs with browser_click / browser_type):')
    for (const el of elements) lines.push(formatElement(el))
    if (raw.truncated) {
      lines.push(`(element list truncated at ${elements.length} — scroll to reveal more)`)
    }
  } else {
    lines.push('', 'No interactive elements detected (page may still be rendering).')
  }

  if (raw.outline) {
    lines.push('', 'Content outline:', raw.outline)
  }

  let out = lines.join('\n')
  if (out.length > MAX_SNAPSHOT_TEXT_CHARS) {
    out = out.slice(0, MAX_SNAPSHOT_TEXT_CHARS) + '\n(snapshot truncated — use browser_read_page for full text)'
  }
  return out
}
