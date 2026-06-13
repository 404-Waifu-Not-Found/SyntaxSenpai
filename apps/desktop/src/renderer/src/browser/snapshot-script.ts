// Scripts injected into the embedded-browser guest page via
// webview.executeJavaScript(). Each builder returns a self-contained IIFE
// string; results must be JSON-serializable. State lives in
// window.__ssAgent = { gen, refs } — a navigation wipes it, which is exactly
// the staleness semantics we want for element refs.

export const MAX_SNAPSHOT_ELEMENTS = 180
export const MAX_OUTLINE_CHARS = 2000
export const READ_PAGE_CHUNK = 25000

export interface RawSnapshotElement {
  ref: string
  role: string
  name: string
  value?: string
  checked?: boolean
  disabled?: boolean
  inViewport: boolean
  href?: string
}

export interface RawSnapshot {
  url: string
  title: string
  scrollY: number
  scrollMax: number
  viewportH: number
  elements: RawSnapshotElement[]
  outline: string
  truncated: boolean
}

export interface AgentTargetRect {
  x: number
  y: number
  width: number
  height: number
}

// Shared helpers stringified into every action script: ref lookup + result shape.
const HELPERS = `
  function __ssGet(ref) {
    var agent = window.__ssAgent
    if (!agent || !agent.refs || !agent.refs[ref]) return { error: 'stale_ref' }
    var el = agent.refs[ref]
    if (!el.isConnected) return { error: 'stale_ref' }
    return { el: el }
  }
  function __ssHighlight(el) {
    try {
      var prev = el.style.outline
      var prevOffset = el.style.outlineOffset
      el.style.outline = '2px solid #f472b6'
      el.style.outlineOffset = '2px'
      setTimeout(function () { el.style.outline = prev; el.style.outlineOffset = prevOffset }, 500)
    } catch (e) {}
  }
`

export function buildSnapshotScript(): string {
  return `(function () {
  var MAX_ELEMENTS = ${MAX_SNAPSHOT_ELEMENTS}
  var MAX_OUTLINE = ${MAX_OUTLINE_CHARS}

  var gen = (window.__ssAgent && window.__ssAgent.gen ? window.__ssAgent.gen : 0) + 1
  var refs = {}
  window.__ssAgent = { gen: gen, refs: refs }

  function visible(el) {
    if (!el.isConnected) return false
    var rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    var style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
    return true
  }

  function roleOf(el) {
    var aria = el.getAttribute('role')
    var tag = el.tagName.toLowerCase()
    var type = (el.getAttribute('type') || '').toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'summary') return 'button'
    if (el.isContentEditable) return 'textbox'
    if (tag === 'input') {
      if (type === 'password') return 'password'
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') return 'button'
      if (type === 'search') return 'searchbox'
      if (type === 'file') return 'filechooser'
      return 'textbox'
    }
    return aria || 'clickable'
  }

  function nameOf(el) {
    var name = el.getAttribute('aria-label') || ''
    if (!name && el.labels && el.labels.length) name = (el.labels[0].innerText || '').trim()
    if (!name) {
      var txt = (el.innerText || '').replace(/\\s+/g, ' ').trim()
      if (txt) name = txt
    }
    if (!name) name = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || ''
    if (!name && el.tagName === 'INPUT') name = el.value || el.getAttribute('name') || ''
    if (!name && el.tagName === 'A') {
      var img = el.querySelector('img[alt]')
      if (img) name = img.getAttribute('alt') || ''
    }
    name = String(name).replace(/\\s+/g, ' ').trim()
    return name.length > 60 ? name.slice(0, 57) + '...' : name
  }

  var SELECTOR = 'a[href], button, input, select, textarea, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="combobox"], [role="searchbox"], [role="switch"], [role="option"], [onclick]'

  function collect(doc, out) {
    var nodes
    try { nodes = doc.querySelectorAll(SELECTOR) } catch (e) { return }
    for (var i = 0; i < nodes.length && out.length < MAX_ELEMENTS + 1; i++) {
      var el = nodes[i]
      if (!visible(el)) continue
      out.push(el)
    }
  }

  var candidates = []
  collect(document, candidates)
  // Same-origin iframes, one level deep.
  var iframes = document.querySelectorAll('iframe')
  for (var f = 0; f < iframes.length && candidates.length < MAX_ELEMENTS + 1; f++) {
    try {
      var idoc = iframes[f].contentDocument
      if (idoc) collect(idoc, candidates)
    } catch (e) { /* cross-origin */ }
  }

  var truncated = candidates.length > MAX_ELEMENTS
  if (truncated) candidates = candidates.slice(0, MAX_ELEMENTS)

  var vh = window.innerHeight
  var elements = []
  for (var j = 0; j < candidates.length; j++) {
    var el = candidates[j]
    var ref = 'e' + (j + 1)
    refs[ref] = el
    var rect = el.getBoundingClientRect()
    var role = roleOf(el)
    var item = {
      ref: ref,
      role: role,
      name: nameOf(el),
      inViewport: rect.bottom > 0 && rect.top < vh,
    }
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && role !== 'password') {
      if (el.type === 'checkbox' || el.type === 'radio') item.checked = !!el.checked
      else if (el.value) item.value = String(el.value).slice(0, 60)
    }
    if (el.disabled) item.disabled = true
    if (el.tagName === 'A' && el.href) {
      try { item.href = new URL(el.href).host } catch (e) {}
    }
    elements.push(item)
  }

  var outline = ''
  try {
    var blocks = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td, blockquote, pre, [role="heading"]')
    var seen = 0
    for (var b = 0; b < blocks.length && outline.length < MAX_OUTLINE; b++) {
      var node = blocks[b]
      if (!visible(node)) continue
      var text = (node.innerText || '').replace(/\\s+/g, ' ').trim()
      if (!text) continue
      var tag = node.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        outline += '\\n' + '#'.repeat(Number(tag[1])) + ' ' + text.slice(0, 120)
      } else {
        if (text.length < 25) continue
        // Skip blocks nested inside an already-captured larger block.
        if (seen > 0 && b > 0 && blocks[b - 1].contains(node)) continue
        outline += '\\n' + text.slice(0, 140)
      }
      seen++
    }
  } catch (e) {}
  if (outline.length >= MAX_OUTLINE) outline = outline.slice(0, MAX_OUTLINE) + '…'

  var scrollMax = Math.max(0, (document.documentElement.scrollHeight || 0) - vh)
  return {
    url: location.href,
    title: document.title,
    scrollY: window.scrollY,
    scrollMax: scrollMax,
    viewportH: vh,
    elements: elements,
    outline: outline.trim(),
    truncated: truncated,
  }
})()`
}

export function buildClickScript(ref: string): string {
  return `(function () {
  ${HELPERS}
  var found = __ssGet(${JSON.stringify(ref)})
  if (found.error) return found
  var el = found.el
  try { el.scrollIntoView({ block: 'center', inline: 'center' }) } catch (e) {}
  __ssHighlight(el)
  try {
    var rect = el.getBoundingClientRect()
    var opts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    el.dispatchEvent(new MouseEvent('mousedown', opts))
    el.dispatchEvent(new PointerEvent('pointerup', opts))
    el.dispatchEvent(new MouseEvent('mouseup', opts))
    el.click()
  } catch (e) {
    return { error: 'click_failed', message: String(e && e.message || e) }
  }
  return { ok: true, role: el.tagName.toLowerCase() }
})()`
}

export function buildTargetRectScript(ref: string): string {
  return `(async function () {
  ${HELPERS}
  var found = __ssGet(${JSON.stringify(ref)})
  if (found.error) return found
  var el = found.el
  try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }) } catch (e) {}
  await new Promise(function (resolve) { setTimeout(resolve, 260) })
  var rect = el.getBoundingClientRect()
  return {
    ok: true,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  }
})()`
}

export function buildTypeScript(ref: string, text: string, clear: boolean): string {
  return `(function () {
  ${HELPERS}
  var found = __ssGet(${JSON.stringify(ref)})
  if (found.error) return found
  var el = found.el
  var text = ${JSON.stringify(text)}
  var clear = ${JSON.stringify(clear)}
  var tag = el.tagName
  var type = (el.getAttribute('type') || '').toLowerCase()
  if (tag === 'INPUT' && type === 'password') return { error: 'password_field' }
  try { el.scrollIntoView({ block: 'center' }) } catch (e) {}
  __ssHighlight(el)
  try { el.focus() } catch (e) {}
  try {
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      var proto = tag === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      var next = clear ? text : (el.value || '') + text
      setter.call(el, next)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    } else if (el.isContentEditable) {
      if (clear) el.textContent = ''
      el.textContent = (el.textContent || '') + text
      el.dispatchEvent(new InputEvent('input', { bubbles: true }))
    } else {
      return { error: 'not_typable' }
    }
  } catch (e) {
    return { error: 'type_failed', message: String(e && e.message || e) }
  }
  return { ok: true }
})()`
}

export function buildScrollScript(direction: 'up' | 'down', pages: number, ref?: string): string {
  return `(function () {
  ${HELPERS}
  var ref = ${JSON.stringify(ref || '')}
  if (ref) {
    var found = __ssGet(ref)
    if (found.error) return found
    try { found.el.scrollIntoView({ block: 'center' }) } catch (e) {}
  } else {
    var delta = ${JSON.stringify(direction === 'up' ? -1 : 1)} * ${JSON.stringify(Math.max(0.1, pages))} * window.innerHeight * 0.9
    window.scrollBy({ top: delta, behavior: 'instant' })
  }
  var vh = window.innerHeight
  return {
    ok: true,
    scrollY: window.scrollY,
    scrollMax: Math.max(0, (document.documentElement.scrollHeight || 0) - vh),
  }
})()`
}

export function buildReadScript(offset: number): string {
  return `(function () {
  var offset = ${JSON.stringify(Math.max(0, offset))}
  var CHUNK = ${READ_PAGE_CHUNK}
  var root = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]')
  var text = ''
  if (root) {
    text = root.innerText || ''
  } else {
    var clone = document.body ? document.body.cloneNode(true) : null
    if (clone) {
      var junk = clone.querySelectorAll('script, style, noscript, nav, header, footer, aside, [role="navigation"], [role="banner"], [aria-hidden="true"]')
      for (var i = 0; i < junk.length; i++) junk[i].remove()
      var holder = document.createElement('div')
      holder.style.position = 'fixed'
      holder.style.left = '-99999px'
      holder.style.top = '0'
      holder.appendChild(clone)
      document.documentElement.appendChild(holder)
      text = clone.innerText || ''
      holder.remove()
    }
  }
  text = text.replace(/\\n{3,}/g, '\\n\\n').trim()
  return {
    ok: true,
    title: document.title,
    url: location.href,
    total: text.length,
    offset: offset,
    text: text.slice(offset, offset + CHUNK),
  }
})()`
}
