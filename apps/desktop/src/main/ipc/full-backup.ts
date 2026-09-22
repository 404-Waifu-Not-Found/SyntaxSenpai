import { wrapExport, unwrapExport } from '@syntax-senpai/storage'
import { getChatBackupData, replaceChatBackupSnapshot } from './chat'
import { exportStoredApiKeys, importStoredApiKeys } from './keystore'

const electronModule = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const { app, ipcMain } = electronModule

type BackupFile = {
  path: string
  data: string
}

type ClientBackupState = {
  localStorage?: Record<string, string>
  selectedWaifuId?: string | null
  selectedProvider?: string | null
  selectedModel?: string | null
  providerModels?: Record<string, unknown>
}

let registered = false

function userDataPath(...parts: string[]): string {
  return path.join(app.getPath('userData'), ...parts)
}

function walkFiles(root: string): BackupFile[] {
  if (!fs.existsSync(root)) return []
  const files: BackupFile[] = []
  const queue = [root]
  while (queue.length) {
    const current = queue.shift()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) queue.push(absolute)
      else if (entry.isFile()) {
        files.push({
          path: path.relative(root, absolute).replace(/\\/g, '/'),
          data: fs.readFileSync(absolute).toString('base64'),
        })
      }
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function writeFilesAtomically(root: string, files: unknown, label: string): number {
  if (!Array.isArray(files)) return 0
  const staging = `${root}.importing-${process.pid}-${Date.now()}`
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })

  let written = 0
  try {
    for (const candidate of files) {
      const entry = candidate as Partial<BackupFile>
      if (typeof entry.path !== 'string' || typeof entry.data !== 'string') continue
      if (!isSafeRelativePath(entry.path)) throw new Error(`Invalid ${label} path: ${entry.path}`)
      const destination = path.resolve(staging, entry.path)
      if (destination !== staging && !destination.startsWith(`${staging}${path.sep}`)) {
        throw new Error(`Invalid ${label} path: ${entry.path}`)
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, Buffer.from(entry.data, 'base64'))
      written += 1
    }

    fs.rmSync(root, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(root), { recursive: true })
    fs.renameSync(staging, root)
    return written
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.isAbsolute(value)) return false
  const normalised = path.posix.normalize(value.replace(/\\/g, '/'))
  return normalised !== '..' && !normalised.startsWith('../') && !normalised.includes('\0')
}

function collectFullBackup(client: ClientBackupState = {}) {
  const data = {
    settings: {
      localStorage: client.localStorage ?? {},
      selectedWaifuId: client.selectedWaifuId ?? null,
      selectedProvider: client.selectedProvider ?? null,
      selectedModel: client.selectedModel ?? null,
      providerModels: client.providerModels ?? {},
    },
    chats: null,
    skills: walkFiles(userDataPath('skills')),
    waifus: walkFiles(userDataPath('waifus')),
    live2d: {
      models: walkFiles(userDataPath('live2d-models')),
      sdk: walkFiles(userDataPath('live2d-sdk')),
    },
    providers: {
      apiKeys: {},
    },
  }
  return data
}

async function buildFullBackup(client: ClientBackupState = {}) {
  const data = {
    ...(collectFullBackup(client) as any),
    chats: await getChatBackupData(),
    providers: {
      apiKeys: await exportStoredApiKeys(),
    },
  }
  return wrapExport(data, {
    extras: {
      exportKind: 'full-backup',
      backupVersion: 1,
      security: {
        apiKeysIncluded: true,
        warning: 'This backup contains API keys. Store it like a password and delete it when no longer needed.',
      },
    },
  })
}

async function restoreFullBackup(raw: unknown) {
  const envelope = unwrapExport<any>(raw)
  if (envelope.exportKind !== 'full-backup' || envelope.backupVersion !== 1) {
    throw new Error('This file is not a supported SyntaxSenpai full backup.')
  }
  const data = envelope.data || {}

  await replaceChatBackupSnapshot(data.chats || {})
  const skills = writeFilesAtomically(userDataPath('skills'), data.skills, 'skill')
  const waifus = writeFilesAtomically(userDataPath('waifus'), data.waifus, 'waifu')
  const live2dModels = writeFilesAtomically(userDataPath('live2d-models'), data.live2d?.models, 'Live2D model')
  const live2dSdk = writeFilesAtomically(userDataPath('live2d-sdk'), data.live2d?.sdk, 'Live2D SDK')
  const keys = await importStoredApiKeys(data.providers?.apiKeys)

  return {
    success: true,
    settings: data.settings || {},
    imported: {
      conversations: Array.isArray(data.chats?.conversations) ? data.chats.conversations.length : 0,
      skills,
      waifus,
      live2dFiles: live2dModels + live2dSdk,
      apiKeys: keys.imported,
    },
    skippedApiKeys: keys.skipped,
  }
}

export function registerFullBackupIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('backup:collectFull', async (_event: any, client: ClientBackupState) => {
    try {
      return { success: true, payload: await buildFullBackup(client || {}) }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('backup:restoreFull', async (_event: any, payload: unknown) => {
    try {
      return await restoreFullBackup(payload)
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })
}

module.exports = { registerFullBackupIpc }

export {}
