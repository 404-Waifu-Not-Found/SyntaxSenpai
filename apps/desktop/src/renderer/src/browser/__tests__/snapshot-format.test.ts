import { describe, it, expect } from 'vitest'
import { formatSnapshot, MAX_SNAPSHOT_TEXT_CHARS } from '../snapshot-format'
import type { RawSnapshot } from '../snapshot-script'

function makeSnapshot(overrides: Partial<RawSnapshot> = {}): RawSnapshot {
  return {
    url: 'https://example.com/page',
    title: 'Example Page',
    scrollY: 0,
    scrollMax: 0,
    viewportH: 900,
    elements: [],
    outline: '',
    truncated: false,
    ...overrides,
  }
}

describe('formatSnapshot', () => {
  it('handles null/undefined raw data', () => {
    expect(formatSnapshot(null)).toContain('Snapshot failed')
    expect(formatSnapshot(undefined)).toContain('Snapshot failed')
  })

  it('renders page header, single-viewport scroll note, and empty-element note', () => {
    const out = formatSnapshot(makeSnapshot())
    expect(out).toContain('Page: Example Page — https://example.com/page')
    expect(out).toContain('fits in one viewport')
    expect(out).toContain('No interactive elements')
  })

  it('renders element refs with role, name, value, state flags, and href host', () => {
    const out = formatSnapshot(makeSnapshot({
      elements: [
        { ref: 'e1', role: 'searchbox', name: 'Search Wikipedia', value: 'cats', inViewport: true },
        { ref: 'e2', role: 'button', name: 'Go', disabled: true, inViewport: true },
        { ref: 'e3', role: 'link', name: 'English', href: 'en.wikipedia.org', inViewport: false },
        { ref: 'e4', role: 'checkbox', name: 'Remember me', checked: true, inViewport: true },
      ],
    }))
    expect(out).toContain('[e1] searchbox "Search Wikipedia" value="cats"')
    expect(out).toContain('[e2] button "Go" (disabled)')
    expect(out).toContain('[e3] link "English" → en.wikipedia.org [offscreen]')
    expect(out).toContain('[e4] checkbox "Remember me" (checked)')
  })

  it('reports scroll percentage and viewport position on long pages', () => {
    const out = formatSnapshot(makeSnapshot({ scrollY: 1800, scrollMax: 3600, viewportH: 900 }))
    expect(out).toContain('50%')
    expect(out).toContain('viewport 3 of ~5')
  })

  it('notes element-list truncation', () => {
    const out = formatSnapshot(makeSnapshot({
      elements: [{ ref: 'e1', role: 'link', name: 'x', inViewport: true }],
      truncated: true,
    }))
    expect(out).toContain('truncated at 1')
  })

  it('includes the content outline when present', () => {
    const out = formatSnapshot(makeSnapshot({ outline: '# Heading\nSome paragraph text.' }))
    expect(out).toContain('Content outline:')
    expect(out).toContain('# Heading')
  })

  it('hard-caps total output size', () => {
    const elements = Array.from({ length: 180 }, (_, i) => ({
      ref: `e${i + 1}`,
      role: 'link',
      name: 'long name '.repeat(20),
      inViewport: true,
    }))
    const out = formatSnapshot(makeSnapshot({ elements, outline: 'x'.repeat(5000) }))
    expect(out.length).toBeLessThanOrEqual(MAX_SNAPSHOT_TEXT_CHARS + 100)
    expect(out).toContain('snapshot truncated')
  })
})
