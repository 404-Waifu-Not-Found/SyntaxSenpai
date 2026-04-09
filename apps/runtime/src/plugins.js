const fs = require('node:fs')
const path = require('node:path')

function loadPluginManifests(pluginDir) {
  if (!fs.existsSync(pluginDir)) return []

  const manifests = []
  for (const entry of fs.readdirSync(pluginDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = path.join(pluginDir, entry.name, 'plugin.json')
    if (!fs.existsSync(manifestPath)) continue

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      manifests.push({
        ...manifest,
        directory: path.join(pluginDir, entry.name)
      })
    } catch (error) {
      manifests.push({
        name: entry.name,
        version: '0.0.0',
        enabled: false,
        directory: path.join(pluginDir, entry.name),
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return manifests
}

module.exports = {
  loadPluginManifests
}
