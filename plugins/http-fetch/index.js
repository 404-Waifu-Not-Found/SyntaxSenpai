/**
 * http-fetch plugin — generic GET/POST tool.
 *
 * Safety: rejects non-http(s) URLs and refuses hosts that resolve to
 * private/loopback addresses unless ALLOW_PRIVATE_HOSTS=1 is set.
 * Body and headers sizes are capped to keep tool responses manageable.
 */

'use strict'

const MAX_BODY_BYTES = 256 * 1024
const MAX_HEADERS = 16

function isPrivateHostname(hostname) {
  if (!hostname) return true
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true
  if (/^169\.254\./.test(h)) return true
  if (/^fe80:/i.test(h)) return true
  return false
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {}
  const out = {}
  let count = 0
  for (const [k, v] of Object.entries(headers)) {
    if (count >= MAX_HEADERS) break
    if (typeof k !== 'string' || typeof v !== 'string') continue
    out[k] = v
    count++
  }
  return out
}

module.exports = {
  activate({ registerTool }) {
    registerTool({
      definition: {
        name: 'http_fetch',
        description:
          'Make an HTTP GET or POST request to a public URL. Returns status, headers, and up to 256 KB of body text.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Absolute http(s) URL' },
            method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method (default GET)' },
            headers: { type: 'object', additionalProperties: { type: 'string' } },
            body: { type: 'string', description: 'Request body (POST only)' },
            timeoutMs: { type: 'number', description: 'Abort timeout in ms (default 15000)' }
          },
          required: ['url']
        }
      },
      requiresPermission: 'networkAccess',
      async execute(input) {
        const url = String(input?.url || '')
        const method = (input?.method || 'GET').toUpperCase()
        const timeoutMs = Math.min(Math.max(Number(input?.timeoutMs) || 15000, 500), 60000)

        let parsed
        try {
          parsed = new URL(url)
        } catch {
          return { success: false, error: `Invalid URL: ${url}` }
        }
        if (!/^https?:$/.test(parsed.protocol)) {
          return { success: false, error: `Only http/https URLs are allowed, got ${parsed.protocol}` }
        }
        if (isPrivateHostname(parsed.hostname) && process.env.ALLOW_PRIVATE_HOSTS !== '1') {
          return {
            success: false,
            error: `Refusing to call private host ${parsed.hostname}. Set ALLOW_PRIVATE_HOSTS=1 to override.`
          }
        }
        if (method !== 'GET' && method !== 'POST') {
          return { success: false, error: `Method not allowed: ${method}` }
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const response = await fetch(url, {
            method,
            headers: sanitizeHeaders(input?.headers),
            body: method === 'POST' ? input?.body ?? '' : undefined,
            signal: controller.signal
          })

          const headers = {}
          response.headers.forEach((value, key) => {
            headers[key] = value
          })

          const reader = response.body && response.body.getReader ? response.body.getReader() : null
          let bodyBytes = new Uint8Array()
          if (reader) {
            const chunks = []
            let received = 0
            while (received < MAX_BODY_BYTES) {
              const { done, value } = await reader.read()
              if (done) break
              if (!value) continue
              const slice = value.slice(0, Math.max(0, MAX_BODY_BYTES - received))
              chunks.push(slice)
              received += slice.length
              if (received >= MAX_BODY_BYTES) break
            }
            bodyBytes = new Uint8Array(received)
            let offset = 0
            for (const c of chunks) {
              bodyBytes.set(c, offset)
              offset += c.length
            }
            if (reader.cancel) await reader.cancel().catch(() => {})
          } else {
            const text = await response.text()
            bodyBytes = new TextEncoder().encode(text.slice(0, MAX_BODY_BYTES))
          }

          const text = new TextDecoder('utf-8', { fatal: false }).decode(bodyBytes)
          const truncated = bodyBytes.length >= MAX_BODY_BYTES

          return {
            success: true,
            data: {
              status: response.status,
              ok: response.ok,
              headers,
              body: text,
              truncated
            },
            displayText: `${method} ${url} → ${response.status}${truncated ? ' (truncated)' : ''}`
          }
        } catch (err) {
          const message = err && err.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : String(err && err.message || err)
          return { success: false, error: message }
        } finally {
          clearTimeout(timer)
        }
      }
    })
  }
}
