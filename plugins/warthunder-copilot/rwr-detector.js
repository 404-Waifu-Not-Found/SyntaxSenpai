'use strict'

/** Debounce visual changes and retain an alert until the display returns near its quiet baseline. */
function updateRwrAlert(previous, signalPixels, baselineSignalPixels, thresholdDelta = 8) {
  if (!Number.isFinite(signalPixels) || !Number.isFinite(baselineSignalPixels)) {
    return { aboveFrames: 0, active: false, raised: false }
  }
  const parsedDelta = Number(thresholdDelta)
  const delta = Number.isFinite(parsedDelta) ? Math.max(1, parsedDelta) : 8
  const aboveFrames = signalPixels >= baselineSignalPixels + delta ? previous.aboveFrames + 1 : 0
  const active = previous.active
    ? signalPixels >= baselineSignalPixels + Math.max(1, Math.floor(delta / 2))
    : aboveFrames >= 2
  return { aboveFrames, active, raised: active && !previous.active }
}

module.exports = { updateRwrAlert }
