const path = require('node:path')

function resolveNumber(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function loadConfig() {
  const dataDir = process.env.SYNTAX_SENPAI_DATA_DIR || path.join(process.cwd(), 'data')
  const pluginDir = process.env.SYNTAX_SENPAI_PLUGIN_DIR || path.join(process.cwd(), 'plugins')
  const backupDir = process.env.SYNTAX_SENPAI_BACKUP_DIR || path.join(dataDir, 'backups')

  return {
    host: process.env.HOST || '0.0.0.0',
    port: resolveNumber(process.env.PORT, 8787),
    dataDir,
    pluginDir,
    backupDir,
    backupMaxFiles: resolveNumber(process.env.BACKUP_MAX_FILES, 20),
    backupRetentionDays: resolveNumber(process.env.BACKUP_RETENTION_DAYS, 14),
    serviceName: process.env.SERVICE_NAME || 'syntax-senpai-runtime',
    version: process.env.APP_VERSION || '0.0.1'
  }
}

module.exports = {
  loadConfig
}
