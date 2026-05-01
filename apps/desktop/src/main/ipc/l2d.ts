const electronModule = require('electron')
const fs = require('fs').promises
const fsSync = require('fs')
const path = require('path')

const { ipcMain, dialog, app } = electronModule

let registered = false

function getModelsDir() {
  return path.join(app.getPath('userData'), 'models')
}

async function ensureModelsDir() {
  const dir = getModelsDir()
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {}
  return dir
}

async function isValidCubismModel(dirPath: string) {
  try {
    const files = await fs.readdir(dirPath)
    const hasModelJson = files.some(f => f.endsWith('.model3.json'))
    const hasMoc = files.some(f => f.endsWith('.moc3'))
    return hasModelJson || hasMoc
  } catch {
    return false
  }
}

async function findModelJson(dirPath: string) {
  try {
    const files = await fs.readdir(dirPath)
    const modelJson = files.find(f => f.endsWith('.model3.json'))
    return modelJson ? path.join(dirPath, modelJson) : null
  } catch {
    return null
  }
}

async function parseModelJson(filePath: string) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function copyModelDir(srcDir: string, modelName: string) {
  const modelsDir = await ensureModelsDir()
  const destDir = path.join(modelsDir, modelName)

  try {
    await fs.mkdir(destDir, { recursive: true })

    async function copyDir(src: string, dest: string) {
      const files = await fs.readdir(src, { withFileTypes: true })
      for (const file of files) {
        const srcPath = path.join(src, file.name)
        const destPath = path.join(dest, file.name)
        if (file.isDirectory()) {
          await fs.mkdir(destPath, { recursive: true })
          await copyDir(srcPath, destPath)
        } else {
          await fs.copyFile(srcPath, destPath)
        }
      }
    }

    await copyDir(srcDir, destDir)
    return destDir
  } catch (err) {
    throw new Error(`Failed to copy model directory: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function registerL2dIpc() {
  if (registered) return
  registered = true

  ipcMain.handle('l2d:importModel', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import Live2D Cubism Model',
        buttonLabel: 'Select Model',
        properties: ['openDirectory'],
      })

      if (result.canceled || !result.filePaths?.[0]) {
        return { success: false, canceled: true }
      }

      const selectedPath = result.filePaths[0]

      // Validate model directory
      const isValid = await isValidCubismModel(selectedPath)
      if (!isValid) {
        return {
          success: false,
          error: 'Selected directory does not contain a valid Cubism model (missing .model3.json or .moc3)',
        }
      }

      // Find the model.json file
      const modelJsonPath = await findModelJson(selectedPath)
      if (!modelJsonPath) {
        return { success: false, error: 'No .model3.json file found in selected directory' }
      }

      // Parse model metadata
      const modelData = await parseModelJson(modelJsonPath)
      if (!modelData) {
        return { success: false, error: 'Failed to parse model.json file' }
      }

      // Get model name from directory basename
      const modelName = path.basename(selectedPath)

      // Copy model to app's models directory
      const destDir = await copyModelDir(selectedPath, modelName)
      const modelJsonInDest = path.join(destDir, path.basename(modelJsonPath))

      // Create model metadata entry
      const modelId = Buffer.from(modelName).toString('base64')

      return {
        success: true,
        model: {
          id: modelId,
          name: modelName,
          path: destDir,
          modelJsonPath: modelJsonInDest,
          importedAt: new Date().toISOString(),
          metadata: modelData,
        },
      }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('l2d:listModels', async () => {
    try {
      const modelsDir = getModelsDir()

      // Ensure directory exists
      if (!fsSync.existsSync(modelsDir)) {
        return { success: true, models: [] }
      }

      const entries = await fs.readdir(modelsDir, { withFileTypes: true })
      const models = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const modelPath = path.join(modelsDir, entry.name)
        const isValid = await isValidCubismModel(modelPath)
        if (!isValid) continue

        const modelJsonPath = await findModelJson(modelPath)
        const modelData = modelJsonPath ? await parseModelJson(modelJsonPath) : null

        models.push({
          id: Buffer.from(entry.name).toString('base64'),
          name: entry.name,
          path: modelPath,
          modelJsonPath,
          metadata: modelData,
        })
      }

      return { success: true, models }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('l2d:deleteModel', async (_event: any, modelId: string) => {
    try {
      const modelName = Buffer.from(modelId, 'base64').toString('utf-8')
      const modelsDir = getModelsDir()
      const modelPath = path.join(modelsDir, modelName)

      // Safety check: ensure path is within models directory
      const normalized = path.normalize(modelPath)
      const normalizedModelsDir = path.normalize(modelsDir)
      if (!normalized.startsWith(normalizedModelsDir)) {
        return { success: false, error: 'Invalid model path' }
      }

      await fs.rm(modelPath, { recursive: true, force: true })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('l2d:getModel', async (_event: any, modelId: string) => {
    try {
      const modelName = Buffer.from(modelId, 'base64').toString('utf-8')
      const modelsDir = getModelsDir()
      const modelPath = path.join(modelsDir, modelName)

      // Safety check
      const normalized = path.normalize(modelPath)
      const normalizedModelsDir = path.normalize(modelsDir)
      if (!normalized.startsWith(normalizedModelsDir)) {
        return { success: false, error: 'Invalid model path' }
      }

      const isValid = await isValidCubismModel(modelPath)
      if (!isValid) {
        return { success: false, error: 'Model not found or invalid' }
      }

      const modelJsonPath = await findModelJson(modelPath)
      const modelData = modelJsonPath ? await parseModelJson(modelJsonPath) : null

      return {
        success: true,
        model: {
          id: modelId,
          name: modelName,
          path: modelPath,
          modelJsonPath,
          metadata: modelData,
        },
      }
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

module.exports = { registerL2dIpc }

export {}
