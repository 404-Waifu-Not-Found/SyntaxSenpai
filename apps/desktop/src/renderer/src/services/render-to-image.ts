/**
 * Render Markdown-ish content to a PNG so WeChat receives a readable image
 * for tables, code, and other layouts that WeChat does not render natively.
 *
 * The agent passes plain text + an optional title. We build a styled DOM
 * tree off-screen, hand it to html-to-image, and return a base64 PNG.
 * Nothing in this file touches the user's chat DOM — the off-screen node
 * is its own subtree and is unmounted before we return.
 */

import * as htmlToImage from 'html-to-image'

export interface RenderToImageOptions {
  width?: number
  /** Optional bold-styled heading rendered above the body. */
  title?: string
  /** CSS background colour for the card. WeChat dark/light agnostic — use white. */
  background?: string
}

export interface RenderResult {
  /** PNG bytes, base64-encoded without a data: prefix. */
  base64: string
  width: number
  height: number
}

/**
 * Render `content` (plain text; fenced code blocks rendered as monospace
 * blocks) to a PNG. Returns the base64 body suitable for `wechat:send`.
 */
export async function renderContentToPng(
  content: string,
  opts: RenderToImageOptions = {},
): Promise<RenderResult> {
  const width = Math.max(360, Math.min(1080, opts.width ?? 720))
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-99999px'
  host.style.top = '0'
  host.style.pointerEvents = 'none'
  host.style.zIndex = '-1'

  const card = document.createElement('div')
  card.style.boxSizing = 'border-box'
  card.style.width = `${width}px`
  card.style.padding = '24px 28px'
  card.style.background = opts.background ?? '#ffffff'
  card.style.color = '#0f172a'
  card.style.fontFamily =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
  card.style.fontSize = '16px'
  card.style.lineHeight = '1.55'
  card.style.borderRadius = '0'

  if (opts.title) {
    const h = document.createElement('div')
    h.textContent = opts.title
    h.style.fontSize = '20px'
    h.style.fontWeight = '700'
    h.style.marginBottom = '12px'
    card.appendChild(h)
  }

  const body = document.createElement('div')
  body.style.whiteSpace = 'pre-wrap'
  body.style.wordBreak = 'break-word'
  appendBlocks(body, content)
  card.appendChild(body)

  host.appendChild(card)
  document.body.appendChild(host)
  // Yield one paint so layout settles before capture.
  await new Promise<void>((r) => requestAnimationFrame(() => r()))

  try {
    const dataUrl = await htmlToImage.toPng(card, {
      pixelRatio: 2,
      cacheBust: true,
      width: card.scrollWidth,
      height: card.scrollHeight,
    })
    const rect = card.getBoundingClientRect()
    const base64 = stripDataUrl(dataUrl)
    return { base64, width: Math.round(rect.width), height: Math.round(rect.height) }
  } finally {
    document.body.removeChild(host)
  }
}

/**
 * Append `content` to `parent`, splitting fenced code blocks ```…``` into
 * styled `<pre>` nodes and the rest into `<div>` paragraphs. No real
 * Markdown rendering — WeChat only sees the rasterised result anyway, so
 * we just preserve the most readable visual structure.
 */
function appendBlocks(parent: HTMLElement, content: string) {
  const fenceRe = /```(\w+)?\n([\s\S]*?)```/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(content)) !== null) {
    if (m.index > lastIndex) {
      appendProse(parent, content.slice(lastIndex, m.index))
    }
    const lang = m[1] ?? ''
    const code = m[2]
    appendCode(parent, code, lang)
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < content.length) {
    appendProse(parent, content.slice(lastIndex))
  }
}

function appendProse(parent: HTMLElement, text: string) {
  const trimmed = text.replace(/^\n+|\n+$/g, '')
  if (!trimmed) return
  const div = document.createElement('div')
  div.style.marginTop = parent.childNodes.length === 0 ? '0' : '8px'
  div.textContent = trimmed
  parent.appendChild(div)
}

function appendCode(parent: HTMLElement, code: string, lang: string) {
  const pre = document.createElement('pre')
  pre.style.marginTop = '12px'
  pre.style.marginBottom = '4px'
  pre.style.padding = '12px 14px'
  pre.style.background = '#f1f5f9'
  pre.style.color = '#0f172a'
  pre.style.borderRadius = '8px'
  pre.style.fontFamily =
    "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
  pre.style.fontSize = '14px'
  pre.style.lineHeight = '1.5'
  pre.style.whiteSpace = 'pre'
  pre.style.overflowX = 'auto'
  if (lang) {
    const tag = document.createElement('div')
    tag.textContent = lang
    tag.style.fontSize = '11px'
    tag.style.color = '#64748b'
    tag.style.marginBottom = '6px'
    tag.style.textTransform = 'uppercase'
    tag.style.letterSpacing = '0.04em'
    pre.appendChild(tag)
  }
  const codeEl = document.createElement('code')
  codeEl.textContent = code.replace(/\n$/, '')
  pre.appendChild(codeEl)
  parent.appendChild(pre)
}

function stripDataUrl(url: string): string {
  const comma = url.indexOf(',')
  return comma === -1 ? url : url.slice(comma + 1)
}
