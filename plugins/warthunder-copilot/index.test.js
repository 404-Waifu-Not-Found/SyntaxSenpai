'use strict'

const { it } = require('node:test')
const assert = require('node:assert/strict')

it('accepts samples only for the configured crop and publishes one event per rising alert', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({ ok: false })
  const registered = new Map()
  require('./index').activate({ registerTool: (tool) => registered.set(tool.definition.name, tool) })
  const call = async (name, input) => (await registered.get(`warthunder_copilot_${name}`).execute(input)).data
  const region = { x: 0.5, y: 0.5, width: 0.2, height: 0.2 }
  const sample = { sourceId: 'window:1:0', region, signalPixels: 20 }
  try {
    const invalid = await call('rwr_calibrate', { sourceId: sample.sourceId, region, baselineSignalPixels: -1 })
    assert.ok(invalid.error)
    assert.equal((await call('rwr_calibrate', { sourceId: sample.sourceId, region, baselineSignalPixels: 10 })).baselineSignalPixels, 10)
    assert.equal((await call('rwr_sample', sample)).accepted, false)
    await call('control', { enabled: true, rwr: { enabled: true } })
    assert.equal((await call('rwr_sample', { ...sample, sourceId: 'window:2:0' })).accepted, false)
    assert.equal((await call('rwr_sample', { ...sample, region: { ...region, x: 0.4 } })).accepted, false)
    assert.equal((await call('rwr_sample', sample)).raised, false)
    assert.equal((await call('rwr_sample', sample)).raised, true)
    assert.equal((await call('rwr_sample', sample)).raised, false)
    assert.equal((await call('status', {})).derivedEvents.filter((event) => event.type === 'rwr').length, 1)
    await call('rwr_sample', { ...sample, signalPixels: 13 })
    await call('rwr_sample', sample)
    assert.equal((await call('rwr_sample', sample)).raised, true)
    const events = (await call('status', {})).derivedEvents.filter((event) => event.type === 'rwr')
    assert.equal(events.length, 2)
    assert.notEqual(events[0].id, events[1].id)
    await call('rwr_sample', { ...sample, error: 'Capture stopped' })
    const status = await call('status', {})
    assert.equal(status.rwr.ready, false)
    assert.equal(status.rwr.active, false)
    assert.equal(status.rwr.error, 'Capture stopped')
    await call('control', { enabled: false })
    assert.equal((await call('rwr_sample', sample)).accepted, false)
  } finally {
    await call('control', { enabled: false })
    await new Promise((resolve) => setImmediate(resolve))
    global.fetch = originalFetch
  }
})
