'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { updateRwrAlert } = require('./rwr-detector')

describe('RWR visual alert transitions', () => {
  it('requires two consecutive samples above the quiet baseline', () => {
    let state = updateRwrAlert({ aboveFrames: 0, active: false }, 20, 10, 8)
    assert.equal(state.active, false)
    state = updateRwrAlert(state, 17, 10, 8)
    assert.equal(state.aboveFrames, 0)
    state = updateRwrAlert(state, 20, 10, 8)
    state = updateRwrAlert(state, 20, 10, 8)
    assert.equal(state.active, true)
    assert.equal(state.raised, true)
  })

  it('does not repeat the alert while the contact remains and uses a lower release threshold', () => {
    let state = { aboveFrames: 2, active: true }
    state = updateRwrAlert(state, 20, 10, 8)
    assert.equal(state.raised, false)
    state = updateRwrAlert(state, 15, 10, 8)
    assert.equal(state.active, true)
    state = updateRwrAlert(state, 13, 10, 8)
    assert.equal(state.active, false)
    state = updateRwrAlert(state, 20, 10, 8)
    state = updateRwrAlert(state, 20, 10, 8)
    assert.equal(state.raised, true)
  })

  it('clears the alert for an invalid sample or missing baseline', () => {
    const state = { aboveFrames: 2, active: true }
    assert.equal(updateRwrAlert(state, Number.NaN, 10).active, false)
    assert.equal(updateRwrAlert(state, 20, null).active, false)
  })
})
