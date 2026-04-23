import { describe, it, expect } from 'vitest'
import { classifySentiment, EXPRESSION_EMOJI } from '../sentiment.js'

describe('classifySentiment', () => {
  it('returns neutral for empty input', () => {
    expect(classifySentiment('').expression).toBe('neutral')
    expect(classifySentiment('   ').expression).toBe('neutral')
  })

  it('detects happy from thank/love keywords', () => {
    expect(classifySentiment('Thanks so much, that is great!').expression).toBe('happy')
  })

  it('detects excited from amplifier keywords', () => {
    const r = classifySentiment("this is amazing — let's go!")
    expect(r.expression).toBe('excited')
    expect(r.intensity).toBeGreaterThan(0)
  })

  it('detects thinking from hedging phrases', () => {
    expect(classifySentiment('Hmm, let me think...').expression).toBe('thinking')
  })

  it('detects confused from wait-what style questions', () => {
    expect(classifySentiment('Wait what? I do not understand???').expression).toBe('confused')
  })

  it('detects embarrassed from apology words', () => {
    expect(classifySentiment('Sorry, my bad — I messed up').expression).toBe('embarrassed')
  })

  it('detects determined from commitment phrases', () => {
    expect(classifySentiment("Leave it to me, I'll fix it").expression).toBe('determined')
  })

  it('detects sad from failure words', () => {
    expect(classifySentiment('That is unfortunate — the build failed').expression).toBe('sad')
  })

  it('punctuation alone can boost excited', () => {
    const r = classifySentiment('ok!!!')
    expect(r.expression).toBe('excited')
  })

  it('clamps intensity to 1', () => {
    const long = Array(10).fill('amazing fantastic incredible').join(' ')
    expect(classifySentiment(long).intensity).toBeLessThanOrEqual(1)
  })

  it('emoji map covers all expressions', () => {
    for (const expr of ['neutral', 'happy', 'excited', 'thinking', 'confused', 'embarrassed', 'determined', 'sad'] as const) {
      expect(EXPRESSION_EMOJI[expr]).toBeTruthy()
    }
  })
})
