import { describe, it, expect } from 'vitest'
import { loadCustomWaifus, validateWaifu } from '../custom-loader.js'

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-waifu',
    name: 'test',
    displayName: 'Test-chan',
    backstory: 'Test backstory',
    personalityTraits: {
      warmth: 50,
      formality: 50,
      enthusiasm: 50,
      teasing: 50,
      verbosity: 50,
      humor: 50,
    },
    communicationStyle: { greetingPrefix: 'Hi' },
    systemPromptTemplate: 'You are {{displayName}}',
    ...overrides,
  }
}

describe('validateWaifu', () => {
  it('accepts a minimal valid waifu', () => {
    const result = validateWaifu(validRaw())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.waifu.isBuiltIn).toBe(false)
      expect(typeof result.waifu.createdAt).toBe('string')
    }
  })

  it('rejects non-objects', () => {
    expect(validateWaifu(null).ok).toBe(false)
    expect(validateWaifu([]).ok).toBe(false)
    expect(validateWaifu('str').ok).toBe(false)
  })

  it('rejects missing required fields', () => {
    const raw: any = validRaw()
    delete raw.backstory
    const result = validateWaifu(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/backstory/)
  })

  it('rejects trait values out of range', () => {
    const result = validateWaifu(validRaw({
      personalityTraits: { warmth: 999, formality: 50, enthusiasm: 50, teasing: 50, verbosity: 50, humor: 50 },
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/warmth/)
  })

  it('rejects non-slug ids', () => {
    const result = validateWaifu(validRaw({ id: 'weird id with spaces' }))
    expect(result.ok).toBe(false)
  })
})

describe('loadCustomWaifus', () => {
  function makeFs(files: Record<string, string>) {
    return {
      existsSync: (p: string) => p === '/custom' || p in files,
      // Entries are bare file names; loader will join them with the directory.
      readdirSync: () =>
        Object.keys(files).map((full) => {
          const base = full.split('/').pop() || full
          return { name: base, isFile: () => true }
        }),
      readFileSync: (p: string) => files[p] ?? '',
    }
  }
  const path = {
    join: (...parts: string[]) => parts.filter(Boolean).join('/'),
    basename: (p: string, _ext?: string) => p.split('/').pop() || '',
  }

  it('loads every valid waifu in the directory', () => {
    const fs = makeFs({
      '/custom/one.json': JSON.stringify(validRaw({ id: 'one' })),
      '/custom/two.json': JSON.stringify(validRaw({ id: 'two' })),
    })
    const result = loadCustomWaifus({ directory: '/custom', fs, path })
    expect(result.waifus.map((w) => w.id).sort()).toEqual(['one', 'two'])
    expect(result.errors).toEqual([])
  })

  it('skips invalid JSON with an error entry and warning', () => {
    const logged: any[] = []
    const logger = { warn: (obj: unknown, msg?: string) => logged.push({ obj, msg }) }
    const fs = makeFs({
      '/custom/bad.json': '{ not json',
      '/custom/good.json': JSON.stringify(validRaw({ id: 'good' })),
    })
    const result = loadCustomWaifus({ directory: '/custom', fs, path, logger })
    expect(result.waifus.map((w) => w.id)).toEqual(['good'])
    expect(result.errors).toHaveLength(1)
    expect(logged.length).toBeGreaterThan(0)
  })

  it('skips files that fail schema validation', () => {
    const fs = makeFs({
      '/custom/missing.json': JSON.stringify({ id: 'no-fields' }),
      '/custom/ok.json': JSON.stringify(validRaw({ id: 'ok' })),
    })
    const result = loadCustomWaifus({ directory: '/custom', fs, path })
    expect(result.waifus.map((w) => w.id)).toEqual(['ok'])
    expect(result.errors[0].file).toBe('missing.json')
  })

  it('returns empty for missing directory', () => {
    const fs = {
      existsSync: () => false,
      readdirSync: () => [],
      readFileSync: () => '',
    }
    const result = loadCustomWaifus({ directory: '/nope', fs, path })
    expect(result.waifus).toEqual([])
    expect(result.errors).toEqual([])
  })
})
