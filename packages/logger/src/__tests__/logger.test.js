import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, generateRequestId } from '../index.js'

describe('createLogger', () => {
  let stdoutSpy
  let stderrSpy

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  function readAll(spy) {
    return spy.mock.calls.map((c) => String(c[0])).join('')
  }

  it('emits JSON records at the right level', () => {
    const log = createLogger({ name: 'test', level: 'info', format: 'json' })
    log.debug('skipped')
    log.info('hello', undefined)
    log.warn({ userId: 'u1' }, 'careful')
    log.error({ err: new Error('boom') }, 'oops')

    const out = readAll(stdoutSpy).trim().split('\n').filter(Boolean)
    const err = readAll(stderrSpy).trim().split('\n').filter(Boolean)
    expect(out).toHaveLength(1)
    expect(err).toHaveLength(2)

    const info = JSON.parse(out[0])
    expect(info.level).toBe('info')
    expect(info.msg).toBe('hello')
    expect(info.name).toBe('test')

    const warn = JSON.parse(err[0])
    expect(warn.userId).toBe('u1')
    expect(warn.msg).toBe('careful')

    const error = JSON.parse(err[1])
    expect(error.err.message).toBe('boom')
    expect(typeof error.err.stack).toBe('string')
  })

  it('respects level threshold', () => {
    const log = createLogger({ level: 'warn', format: 'json' })
    log.info('nope')
    log.debug('nope')
    log.warn('yep')
    expect(readAll(stdoutSpy)).toBe('')
    expect(readAll(stderrSpy).trim().split('\n').filter(Boolean)).toHaveLength(1)
  })

  it('child() merges bindings', () => {
    const root = createLogger({ level: 'info', format: 'json', bindings: { service: 'runtime' } })
    const child = root.child({ requestId: 'r1' })
    child.info('ping')
    const line = JSON.parse(readAll(stdoutSpy).trim())
    expect(line.service).toBe('runtime')
    expect(line.requestId).toBe('r1')
  })

  it('handles circular references without throwing', () => {
    const log = createLogger({ level: 'info', format: 'json' })
    const a = {}
    a.self = a
    expect(() => log.info({ data: a }, 'loop')).not.toThrow()
    const line = JSON.parse(readAll(stdoutSpy).trim())
    expect(line.data.self).toBe('[Circular]')
  })

  it('pretty format produces human output', () => {
    const log = createLogger({ level: 'info', format: 'pretty' })
    log.info('pretty works')
    const line = readAll(stdoutSpy).trim()
    expect(line).toMatch(/INFO/)
    expect(line).toMatch(/pretty works/)
  })
})

describe('generateRequestId', () => {
  it('returns unique-ish ids', () => {
    const a = generateRequestId()
    const b = generateRequestId()
    expect(a).not.toBe(b)
    expect(a).toMatch(/[a-z0-9]+-[a-z0-9]+/)
  })
})
