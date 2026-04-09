const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { BackupManager } = require('../src/backups')

test('BackupManager exports and restores tracked files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-senpai-backup-'))
  const dataDir = path.join(root, 'data')
  const backupDir = path.join(root, 'backups')
  fs.mkdirSync(dataDir, { recursive: true })
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

  fs.writeFileSync(path.join(dataDir, 'memory.json'), JSON.stringify({ memory: { b: 99 } }))
  const restored = manager.restoreBackup(exported.fileName)

  assert.equal(restored.restoredFrom, exported.fileName)
  const memory = JSON.parse(fs.readFileSync(path.join(dataDir, 'memory.json'), 'utf8'))
  assert.deepEqual(memory, { memory: { b: 2 } })
})
