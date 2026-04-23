const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { BackupManager } = require('../src/backups')

function setupDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-senpai-backup-'))
  const dataDir = path.join(root, 'data')
  const backupDir = path.join(root, 'backups')
  fs.mkdirSync(dataDir, { recursive: true })
  return { root, dataDir, backupDir }
}

test('BackupManager exports and restores tracked files', () => {
  const { dataDir, backupDir } = setupDirs()
  fs.writeFileSync(path.join(dataDir, 'chats.json'), JSON.stringify({ conversations: { a: 1 } }))
  fs.writeFileSync(path.join(dataDir, 'memory.json'), JSON.stringify({ memory: { b: 2 } }))

  const manager = new BackupManager({
    dataDir,
    backupDir,
    backupMaxFiles: 5,
    backupRetentionDays: 30
  })

  const exported = manager.exportBackup('test')
  assert.ok(exported.fileName.endsWith('.json'))
  assert.equal(exported.schemaVersion, 1)

  // Verify on-disk shape is the versioned envelope
  const raw = JSON.parse(fs.readFileSync(path.join(backupDir, exported.fileName), 'utf8'))
  assert.equal(raw.schemaVersion, 1)
  assert.equal(raw.reason, 'test')
  assert.ok(raw.data && raw.data.files)

  fs.writeFileSync(path.join(dataDir, 'memory.json'), JSON.stringify({ memory: { b: 99 } }))
  const restored = manager.restoreBackup(exported.fileName)

  assert.equal(restored.restoredFrom, exported.fileName)
  assert.equal(restored.schemaVersion, 1)
  const memory = JSON.parse(fs.readFileSync(path.join(dataDir, 'memory.json'), 'utf8'))
  assert.deepEqual(memory, { memory: { b: 2 } })
})

test('BackupManager restores legacy unversioned backups', () => {
  const { dataDir, backupDir } = setupDirs()
  fs.mkdirSync(backupDir, { recursive: true })
  const legacy = {
    createdAt: new Date().toISOString(),
    reason: 'legacy',
    files: {
      'chats.json': { conversations: { legacy: true } },
      'memory.json': { memory: {} }
    }
  }
  const legacyPath = path.join(backupDir, 'backup-legacy.json')
  fs.writeFileSync(legacyPath, JSON.stringify(legacy))

  const manager = new BackupManager({
    dataDir,
    backupDir,
    backupMaxFiles: 5,
    backupRetentionDays: 30
  })

  const restored = manager.restoreBackup('backup-legacy.json')
  assert.equal(restored.schemaVersion, null)
  const chats = JSON.parse(fs.readFileSync(path.join(dataDir, 'chats.json'), 'utf8'))
  assert.deepEqual(chats, { conversations: { legacy: true } })
})

test('BackupManager refuses newer schemaVersion', () => {
  const { dataDir, backupDir } = setupDirs()
  fs.mkdirSync(backupDir, { recursive: true })
  const future = {
    schemaVersion: 999,
    app: 'SyntaxSenpai-Runtime',
    exportedAt: new Date().toISOString(),
    data: { files: {} }
  }
  fs.writeFileSync(path.join(backupDir, 'backup-future.json'), JSON.stringify(future))

  const manager = new BackupManager({
    dataDir,
    backupDir,
    backupMaxFiles: 5,
    backupRetentionDays: 30
  })

  assert.throws(() => manager.restoreBackup('backup-future.json'), /schemaVersion 999/)
})
