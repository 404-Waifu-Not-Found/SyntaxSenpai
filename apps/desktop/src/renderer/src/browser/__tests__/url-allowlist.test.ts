import { describe, it, expect } from 'vitest'
import { isAllowedBrowserUrl } from '../controller'

describe('isAllowedBrowserUrl', () => {
  it('allows http and https URLs', () => {
    expect(isAllowedBrowserUrl('https://example.com')).toBe(true)
    expect(isAllowedBrowserUrl('http://example.com/path?q=1')).toBe(true)
  })

  it('blocks non-web schemes', () => {
    expect(isAllowedBrowserUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedBrowserUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedBrowserUrl('data:text/html,<script>1</script>')).toBe(false)
    expect(isAllowedBrowserUrl('chrome://settings')).toBe(false)
    expect(isAllowedBrowserUrl('about:blank')).toBe(false)
  })

  it('blocks malformed and empty input', () => {
    expect(isAllowedBrowserUrl('')).toBe(false)
    expect(isAllowedBrowserUrl('not a url')).toBe(false)
    expect(isAllowedBrowserUrl('example.com')).toBe(false)
  })
})
