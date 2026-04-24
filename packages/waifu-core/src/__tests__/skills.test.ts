import { describe, it, expect } from 'vitest'
import {
  parseSkillFile,
  serializeSkill,
  isValidSkillSlug,
  formatSkillsForPrompt,
} from '../skills.js'

const VALID = `---
name: "Greet user warmly"
description: "Open a conversation with a friendly, in-character greeting."
---

When the user says hi, respond with an enthusiastic in-character greeting and ask how their day is going.`

describe('parseSkillFile', () => {
  it('parses frontmatter + body', () => {
    const skill = parseSkillFile(VALID, 'greet-user')
    expect(skill).not.toBeNull()
    expect(skill!.slug).toBe('greet-user')
    expect(skill!.name).toBe('Greet user warmly')
    expect(skill!.description).toContain('friendly')
    expect(skill!.body).toContain('enthusiastic')
  })

  it('returns null without frontmatter', () => {
    expect(parseSkillFile('just some body', 'x')).toBeNull()
  })

  it('returns null when name or description missing', () => {
    const raw = `---\nname: foo\n---\n\nbody`
    expect(parseSkillFile(raw, 'x')).toBeNull()
  })

  it('strips YAML quote delimiters', () => {
    const raw = `---\nname: 'single quoted'\ndescription: "double quoted"\n---\n\nbody`
    const skill = parseSkillFile(raw, 'x')
    expect(skill?.name).toBe('single quoted')
    expect(skill?.description).toBe('double quoted')
  })

  it('ignores comment lines', () => {
    const raw = `---\n# comment\nname: foo\ndescription: bar\n---\n\nbody`
    const skill = parseSkillFile(raw, 'x')
    expect(skill?.name).toBe('foo')
  })
})

describe('serializeSkill', () => {
  it('round-trips through parse', () => {
    const source = { name: 'test', description: 'desc', body: 'body here' }
    const raw = serializeSkill(source)
    const parsed = parseSkillFile(raw, 'slug')
    expect(parsed?.name).toBe(source.name)
    expect(parsed?.description).toBe(source.description)
    expect(parsed?.body).toBe(source.body)
  })

  it('escapes embedded quotes', () => {
    const raw = serializeSkill({ name: 'has "quotes"', description: 'and "more"', body: 'b' })
    expect(raw).toContain('name: "has \\"quotes\\""')
  })
})

describe('isValidSkillSlug', () => {
  it('accepts slug-safe strings', () => {
    expect(isValidSkillSlug('greet-user')).toBe(true)
    expect(isValidSkillSlug('skill_1')).toBe(true)
    expect(isValidSkillSlug('ABC')).toBe(true)
  })

  it('rejects traversal attempts and odd characters', () => {
    expect(isValidSkillSlug('../etc/passwd')).toBe(false)
    expect(isValidSkillSlug('has space')).toBe(false)
    expect(isValidSkillSlug('has/slash')).toBe(false)
    expect(isValidSkillSlug('')).toBe(false)
    expect(isValidSkillSlug('-leading-hyphen')).toBe(false)
  })

  it('enforces length cap', () => {
    expect(isValidSkillSlug('a'.repeat(65))).toBe(false)
    expect(isValidSkillSlug('a'.repeat(64))).toBe(true)
  })
})

describe('formatSkillsForPrompt', () => {
  it('returns empty string for empty list', () => {
    expect(formatSkillsForPrompt([])).toBe('')
  })

  it('lists skill slugs with descriptions', () => {
    const block = formatSkillsForPrompt([
      { slug: 'one', name: 'One', description: 'First skill' },
      { slug: 'two', name: 'Two', description: 'Second skill' },
    ])
    expect(block).toContain('Available Skills')
    expect(block).toContain('- one: First skill')
    expect(block).toContain('- two: Second skill')
    expect(block).toContain('use_skill')
  })
})
