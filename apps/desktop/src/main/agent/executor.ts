const { spawn } = require('child_process')
const fs = require('fs').promises
const path = require('path')
const { shell } = require('electron')

// Run a shell command and capture output
function runCommand({ command, args = [], cwd = undefined, env = process.env } = {}) {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { shell: true, cwd, env })
      let stdout = ''
      let stderr = ''
      if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      child.on('close', (code) => resolve({ success: true, code, stdout, stderr }))
      child.on('error', (err) => resolve({ success: false, error: err.message }))
    } catch (err) {
      resolve({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}

async function readFile(filePath) {
  try {
    const content = await fs.readFile(path.resolve(filePath), 'utf-8')
    return { success: true, content }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function writeFile(filePath, content) {
  try {
    await fs.writeFile(path.resolve(filePath), content, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function openExternal(url) {
  try {
    await shell.openExternal(url)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

module.exports = { runCommand, readFile, writeFile, openExternal }
