import { describe, it, expect } from 'vitest'
import { getVoiceProfile, pickVoice, trimForSpeech } from '../voice.js'

describe('getVoiceProfile', () => {
  it('returns a distinct profile per built-in waifu', () => {
    const aria = getVoiceProfile('aria')
    const rei = getVoiceProfile('rei')
    expect(aria.pitch).not.toBe(rei.pitch)
    expect(rei.rate).toBeLessThan(aria.rate)
  })

  it('falls back to the default profile for unknown ids', () => {
    const p = getVoiceProfile('nobody')
    expect(p.pitch).toBe(1)
    expect(p.rate).toBe(1)
  })
})

describe('pickVoice', () => {
  const voices = [
    { name: 'Samantha', lang: 'en-US' },
    { name: 'Google UK English Female', lang: 'en-GB' },
    { name: 'Thomas', lang: 'fr-FR' },
  ]

  it('returns the first preference match', () => {
    const profile = getVoiceProfile('aria')
    const picked = pickVoice(voices, profile)
    expect(picked?.name).toBe('Google UK English Female')
  })

  it('falls back to locale when no preferences match', () => {
    const picked = pickVoice(voices, {
      ...getVoiceProfile('aria'),
      voiceNamePreferences: ['NonExistentVoice'],
      lang: 'fr-FR',
    })
    expect(picked?.name).toBe('Thomas')
  })

  it('returns null when voice list is empty', () => {
    expect(pickVoice([], getVoiceProfile('aria'))).toBeNull()
  })
})

describe('trimForSpeech', () => {
  it('returns full text when short enough', () => {
    expect(trimForSpeech('hello', 50)).toBe('hello')
  })

  it('cuts at sentence boundaries', () => {
    const input = 'First sentence. Second sentence. Third sentence that is quite long.'
    const out = trimForSpeech(input, 35)
    expect(out.endsWith('.')).toBe(true)
    expect(out.length).toBeLessThan(input.length)
  })

  it('falls back to ellipsis when no boundary is found', () => {
    const input = 'no boundaries here at all just a long run-on'
    const out = trimForSpeech(input, 10)
    expect(out.endsWith('…')).toBe(true)
  })
})
