import { describe, it, expect } from 'vitest'
import { getTier, detectMilestone, describeMilestone, AFFECTION_TIERS } from '../milestones.js'

describe('getTier', () => {
  it('returns stranger for 0', () => {
    expect(getTier(0).id).toBe('stranger')
  })

  it('returns devoted for 100', () => {
    expect(getTier(100).id).toBe('devoted')
  })

  it('clamps out-of-range values', () => {
    expect(getTier(-5).id).toBe('stranger')
    expect(getTier(200).id).toBe('devoted')
  })

  it('respects exact tier boundaries', () => {
    expect(getTier(19).id).toBe('stranger')
    expect(getTier(20).id).toBe('acquaintance')
    expect(getTier(39).id).toBe('acquaintance')
    expect(getTier(40).id).toBe('friend')
    expect(getTier(60).id).toBe('close')
    expect(getTier(80).id).toBe('devoted')
  })
})

describe('detectMilestone', () => {
  it('returns null for within-tier changes', () => {
    expect(detectMilestone('aria', 25, 30)).toBeNull()
    expect(detectMilestone('aria', 40, 40)).toBeNull()
  })

  it('detects upward tier crossings', () => {
    const event = detectMilestone('aria', 38, 45)
    expect(event).not.toBeNull()
    expect(event!.from.id).toBe('acquaintance')
    expect(event!.to.id).toBe('friend')
    expect(event!.direction).toBe('up')
    expect(event!.waifuId).toBe('aria')
  })

  it('detects downward tier crossings', () => {
    const event = detectMilestone('aria', 62, 55)
    expect(event).not.toBeNull()
    expect(event!.from.id).toBe('close')
    expect(event!.to.id).toBe('friend')
    expect(event!.direction).toBe('down')
  })

  it('includes an ISO timestamp', () => {
    const event = detectMilestone('aria', 10, 25)!
    expect(new Date(event.timestamp).toString()).not.toBe('Invalid Date')
  })
})

describe('describeMilestone', () => {
  it('formats up crossings with an arrow', () => {
    const event = detectMilestone('aria', 38, 45)!
    expect(describeMilestone('Aria', event)).toBe('Aria: Acquaintance → Friend')
  })

  it('formats down crossings differently', () => {
    const event = detectMilestone('aria', 62, 55)!
    expect(describeMilestone('Aria', event)).toContain('↘')
  })
})

describe('AFFECTION_TIERS', () => {
  it('covers 0-100 with no gaps', () => {
    const sorted = [...AFFECTION_TIERS].sort((a, b) => a.min - b.min)
    expect(sorted[0].min).toBe(0)
    expect(sorted[sorted.length - 1].max).toBe(100)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max + 1)
    }
  })

  it('each tier has a non-empty sidecar', () => {
    for (const tier of AFFECTION_TIERS) {
      expect(tier.sidecar.length).toBeGreaterThan(10)
    }
  })
})
