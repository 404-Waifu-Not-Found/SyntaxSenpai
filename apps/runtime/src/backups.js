const fs = require('node:fs')
const path = require('node:path')

const DATA_FILES = ['chats.json', 'memory.json']

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    return {
      __parseError: error instanceof Error ? error.message : String(error)
    }
  }
}

function timestampName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

class BackupManager {
  constructor(config) {
    this.dataDir = config.dataDir
    this.backupDir = config.backupDir
    this.backupMaxFiles = config.backupMaxFiles
    this.backupRetentionDays = config.backupRetentionDays

    ensureDir(this.dataDir)
    ensureDir(this.backupDir)
  }

  getTrackedFiles() {
    return DATA_FILES.map((name) => ({
      name,
      path: path.join(this.dataDir, name)
    }))
  }

  listBackups() {
    ensureDir(this.backupDir)
    return fs.readdirSync(this.backupDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((fileName) => {
        const filePath = path.join(this.backupDir, fileName)
        const stat = fs.statSync(filePath)
        return {
          fileName,
          path: filePath,
          sizeBytes: stat.size,
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString()
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  exportBackup(reason = 'manual') {
    const payload = {
      createdAt: new Date().toISOString(),
      reason,
      files: {}
    }

    for (const file of this.getTrackedFiles()) {
      payload.files[file.name] = safeReadJson(file.path)
    }

    const fileName = `backup-${timestampName()}.json`
    const filePath = path.join(this.backupDir, fileName)
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
    this.pruneBackups()

    return {
      fileName,
      path: filePath
    }
  }

  restoreBackup(fileName) {
    const filePath = path.join(this.backupDir, fileName)
    if (!fs.existsSync(filePath)) {
      throw new Error(`Backup not found: ${fileName}`)
    }

    const backup = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!backup || typeof backup !== 'object' || !backup.files) {
      throw new Error(`Invalid backup payload: ${fileName}`)
    }

    for (const file of this.getTrackedFiles()) {
      const content = backup.files[file.name]
      if (content === undefined) continue
      fs.writeFileSync(file.path, JSON.stringify(content, null, 2), 'utf8')
    }

    return {
      restoredFrom: fileName,
      restoredAt: new Date().toISOString()
    }
  }

  pruneBackups() {
    const backups = this.listBackups()
    const retentionCutoffMs = Date.now() - (this.backupRetentionDays * 24 * 60 * 60 * 1000)

    for (const backup of backups.slice(this.backupMaxFiles)) {
      fs.rmSync(backup.path, { force: true })
    }

    for (const backup of this.listBackups()) {
      const updatedAtMs = Date.parse(backup.updatedAt)
      if (Number.isFinite(updatedAtMs) && updatedAtMs < retentionCutoffMs) {
        fs.rmSync(backup.path, { force: true })
      }
    }
  }
}

module.exports = {
  BackupManager
}
