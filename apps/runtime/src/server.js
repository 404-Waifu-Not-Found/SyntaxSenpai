const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { performance } = require('node:perf_hooks')

const { createLogger, generateRequestId } = require('@syntax-senpai/logger')
const { loadConfig } = require('./config')
const { RuntimeMetrics } = require('./metrics')
const { BackupManager } = require('./backups')
const { loadPluginManifests } = require('./plugins')

const config = loadConfig()

const logger = createLogger({
  name: config.serviceName,
  bindings: { service: config.serviceName, version: config.version }
})

fs.mkdirSync(config.dataDir, { recursive: true })
fs.mkdirSync(config.backupDir, { recursive: true })
fs.mkdirSync(config.pluginDir, { recursive: true })

const metrics = new RuntimeMetrics({
  serviceName: config.serviceName,
  version: config.version
})
const backups = new BackupManager(config)

function jsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload, null, 2))
}

function textResponse(response, statusCode, content, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, { 'content-type': contentType })
  response.end(content)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk.toString('utf8')
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'))
      }
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function requireAuth(request, response, log) {
  const expectedToken = config.authToken
  if (!expectedToken) return true
  const auth = request.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (token !== expectedToken) {
    log.warn({ reason: 'bad_token' }, 'auth rejected')
    jsonResponse(response, 401, { error: 'Unauthorized' })
    return false
  }
  return true
}

function getRoute(pathname, method) {
  if (pathname === '/healthz' && method === 'GET') return 'healthz'
  if (pathname === '/readyz' && method === 'GET') return 'readyz'
  if (pathname === '/metrics' && method === 'GET') return 'metrics'
  if (pathname === '/api/v1/backups' && method === 'GET') return 'backup.list'
  if (pathname === '/api/v1/backups/export' && method === 'POST') return 'backup.export'
  if (pathname === '/api/v1/backups/restore' && method === 'POST') return 'backup.restore'
  if (pathname === '/api/v1/plugins' && method === 'GET') return 'plugins.list'
  if (pathname === '/api/v1/telemetry/ai' && method === 'POST') return 'telemetry.ai'
  return 'not_found'
}

function readiness() {
  const checks = []

  try {
    fs.accessSync(config.dataDir, fs.constants.R_OK | fs.constants.W_OK)
    checks.push({ name: 'data_dir', status: 'ok' })
  } catch (error) {
    checks.push({ name: 'data_dir', status: 'error', error: error.message })
  }

  try {
    fs.accessSync(config.backupDir, fs.constants.R_OK | fs.constants.W_OK)
    checks.push({ name: 'backup_dir', status: 'ok' })
  } catch (error) {
    checks.push({ name: 'backup_dir', status: 'error', error: error.message })
  }

  const plugins = loadPluginManifests(config.pluginDir)
  metrics.setPluginCount(plugins.filter((plugin) => plugin.enabled !== false && !plugin.error).length)
  metrics.setBackupFileCount(backups.listBackups().length)

  return {
    ready: checks.every((check) => check.status === 'ok'),
    checks
  }
}

async function handler(request, response) {
  const startedAt = performance.now()
  const method = request.method || 'GET'
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const route = getRoute(url.pathname, method)
  const requestId = request.headers['x-request-id'] || generateRequestId()
  const log = logger.child({ requestId, route, method, path: url.pathname })
  let statusCode = 200

  response.setHeader('x-request-id', requestId)

  try {
    if (route === 'healthz') {
      jsonResponse(response, 200, {
        status: 'ok',
        service: config.serviceName,
        version: config.version,
        uptimeSeconds: process.uptime()
      })
      return
    }

    if (route === 'readyz') {
      const state = readiness()
      statusCode = state.ready ? 200 : 503
      jsonResponse(response, statusCode, state)
      return
    }

    if (route === 'metrics') {
      const state = readiness()
      statusCode = state.ready ? 200 : 503
      textResponse(response, statusCode, metrics.render(), 'text/plain; version=0.0.4; charset=utf-8')
      return
    }

    if (route === 'plugins.list') {
      const plugins = loadPluginManifests(config.pluginDir)
      metrics.setPluginCount(plugins.filter((plugin) => plugin.enabled !== false && !plugin.error).length)
      jsonResponse(response, 200, { plugins })
      return
    }

    if (url.pathname.startsWith('/api/v1/') && !requireAuth(request, response, log)) {
      statusCode = 401
      return
    }

    if (route === 'backup.list') {
      const items = backups.listBackups()
      metrics.setBackupFileCount(items.length)
      jsonResponse(response, 200, { backups: items })
      return
    }

    if (route === 'backup.export') {
      const body = await readBody(request)
      const parsed = body ? JSON.parse(body) : {}
      const backup = backups.exportBackup(parsed.reason || 'manual')
      metrics.observeBackup('export', 'success')
      metrics.setBackupFileCount(backups.listBackups().length)
      log.info({ file: backup && backup.fileName }, 'backup exported')
      jsonResponse(response, 201, { backup })
      return
    }

    if (route === 'backup.restore') {
      const body = await readBody(request)
      const parsed = body ? JSON.parse(body) : {}
      if (!parsed.fileName) {
        statusCode = 400
        jsonResponse(response, statusCode, { error: 'fileName is required' })
        metrics.observeBackup('restore', 'error')
        log.warn('backup restore missing fileName')
        return
      }

      const restored = backups.restoreBackup(parsed.fileName)
      metrics.observeBackup('restore', 'success')
      log.info({ file: parsed.fileName }, 'backup restored')
      jsonResponse(response, 200, restored)
      return
    }

    if (route === 'telemetry.ai') {
      const body = await readBody(request)
      const parsed = body ? JSON.parse(body) : {}
      if (typeof parsed.durationMs !== 'number') {
        statusCode = 400
        jsonResponse(response, statusCode, { error: 'durationMs must be a number' })
        return
      }

      metrics.observeAiRequest(
        parsed.provider || 'unknown',
        parsed.model || 'unknown',
        parsed.status || 'success',
        parsed.durationMs
      )
      jsonResponse(response, 202, { accepted: true })
      return
    }

    statusCode = 404
    jsonResponse(response, statusCode, { error: `Route not found: ${method} ${url.pathname}` })
  } catch (error) {
    statusCode = 500
    log.error({ err: error }, 'request handler threw')
    jsonResponse(response, statusCode, {
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    const durationMs = performance.now() - startedAt
    metrics.observeRequest(method, route, statusCode, durationMs)
    log.info({ statusCode, durationMs: Math.round(durationMs) }, 'request handled')
  }
}

const server = http.createServer((request, response) => {
  handler(request, response)
})

server.listen(config.port, config.host, () => {
  logger.info(
    {
      host: config.host,
      port: config.port,
      dataDir: path.resolve(config.dataDir),
      pluginDir: path.resolve(config.pluginDir)
    },
    'runtime listening'
  )
})
