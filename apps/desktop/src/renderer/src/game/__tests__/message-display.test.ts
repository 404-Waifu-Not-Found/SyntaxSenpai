import { describe, expect, it } from 'vitest'
import { summarizeGameEvent } from '../message-display'

describe('summarizeGameEvent', () => {
  it('hides the serialized board payload behind a short chess move summary', () => {
    const prompt = '[Minigame event] The user just played e2e4 in chess. The authoritative state is {"board":{"fen":"a very long position"}}.'
    expect(summarizeGameEvent(prompt)).toBe('Played e2e4 in Chess. The updated board was shared with your agent.')
  })

  it('keeps ordinary game-originated text intact', () => {
    expect(summarizeGameEvent('The user restarted the match.')).toBe('The user restarted the match.')
  })
})
