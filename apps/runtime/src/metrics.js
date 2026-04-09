const os = require('node:os')

const REQUEST_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000]
const AI_BUCKETS_MS = [100, 250, 500, 1000, 2500, 5000, 10000, 30000]

function labelKey(labels) {
  return JSON.stringify(Object.keys(labels).sort().map((key) => [key, labels[key]]))
}

function formatLabels(labels) {
  const entries = Object.entries(labels)
  if (!entries.length) return ''
  const inner = entries
    .map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
  return `{${inner}}`
}

class CounterMetric {
  constructor(name, help) {
    this.name = name
    this.help = help
    this.values = new Map()
  }

  inc(labels = {}, value = 1) {
    const key = labelKey(labels)
    const current = this.values.get(key)
    if (current) {
      current.value += value
      return
    }
    this.values.set(key, { labels, value })
  }

  render() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${value}`)
    }
    return lines.join('\n')
  }
}

class GaugeMetric {
  constructor(name, help, getter) {
    this.name = name
    this.help = help
    this.getter = getter
  }

  render() {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      `${this.name} ${this.getter()}`
    ].join('\n')
  }
}

class HistogramMetric {
  constructor(name, help, buckets) {
    this.name = name
    this.help = help
    this.buckets = buckets
    this.values = new Map()
  }

  observe(labels = {}, value) {
    const key = labelKey(labels)
    let current = this.values.get(key)
    if (!current) {
      current = {
        labels,
        sum: 0,
        count: 0,
        buckets: this.buckets.map(() => 0)
      }
      this.values.set(key, current)
    }

    current.sum += value
    current.count += 1

    for (let index = 0; index < this.buckets.length; index += 1) {
      if (value <= this.buckets[index]) {
        current.buckets[index] += 1
      }
    }
  }

  render() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`]

    for (const { labels, sum, count, buckets } of this.values.values()) {
      for (let index = 0; index < this.buckets.length; index += 1) {
        lines.push(`${this.name}_bucket${formatLabels({ ...labels, le: this.buckets[index] })} ${buckets[index]}`)
      }
      lines.push(`${this.name}_bucket${formatLabels({ ...labels, le: '+Inf' })} ${count}`)
      lines.push(`${this.name}_sum${formatLabels(labels)} ${sum}`)
      lines.push(`${this.name}_count${formatLabels(labels)} ${count}`)
    }

    return lines.join('\n')
  }
}

class RuntimeMetrics {
  constructor({ serviceName, version }) {
    this.serviceName = serviceName
    this.version = version
    this.startedAt = Date.now()
    this.requestCounter = new CounterMetric(
      'syntax_senpai_http_requests_total',
      'Total HTTP requests processed by the runtime service'
    )
    this.backupCounter = new CounterMetric(
      'syntax_senpai_backup_operations_total',
      'Total backup operations executed by type and status'
    )
    this.requestDuration = new HistogramMetric(
      'syntax_senpai_http_request_duration_ms',
      'HTTP request latency in milliseconds',
      REQUEST_BUCKETS_MS
    )
    this.aiRequestDuration = new HistogramMetric(
      'syntax_senpai_ai_request_duration_ms',
      'AI request latency in milliseconds',
      AI_BUCKETS_MS
    )
    this.cpuSample = {
      wallTimeMs: Date.now(),
      cpuUsageMicros: process.cpuUsage()
    }
    this.loadedPlugins = 0
    this.backupFileCount = 0
  }

  observeRequest(method, route, statusCode, durationMs) {
    const labels = { method, route, status_code: String(statusCode) }
    this.requestCounter.inc(labels)
    this.requestDuration.observe({ method, route }, durationMs)
  }

  observeAiRequest(provider, model, status, durationMs) {
    this.aiRequestDuration.observe({ provider, model, status }, durationMs)
  }

  observeBackup(type, status) {
    this.backupCounter.inc({ type, status })
  }

  setPluginCount(value) {
    this.loadedPlugins = value
  }

  setBackupFileCount(value) {
    this.backupFileCount = value
  }

  sampleCpuPercent() {
    const nextWallTimeMs = Date.now()
    const nextCpuUsageMicros = process.cpuUsage()
    const wallDeltaMs = Math.max(nextWallTimeMs - this.cpuSample.wallTimeMs, 1)
    const cpuDeltaMicros =
      (nextCpuUsageMicros.user - this.cpuSample.cpuUsageMicros.user) +
      (nextCpuUsageMicros.system - this.cpuSample.cpuUsageMicros.system)

    this.cpuSample = {
      wallTimeMs: nextWallTimeMs,
      cpuUsageMicros: nextCpuUsageMicros
    }

    return (cpuDeltaMicros / (wallDeltaMs * 1000 * Math.max(os.cpus().length, 1))) * 100
  }

  render() {
    const memoryUsage = process.memoryUsage()
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const lines = [
      this.requestCounter.render(),
      this.backupCounter.render(),
      this.requestDuration.render(),
      this.aiRequestDuration.render(),
      new GaugeMetric(
        'syntax_senpai_process_cpu_percent',
        'CPU usage percentage for the runtime process',
        () => this.sampleCpuPercent().toFixed(4)
      ).render(),
      new GaugeMetric(
        'syntax_senpai_process_resident_memory_bytes',
        'Resident memory usage for the runtime process in bytes',
        () => memoryUsage.rss
      ).render(),
      new GaugeMetric(
        'syntax_senpai_process_heap_used_bytes',
        'V8 heap usage in bytes',
        () => memoryUsage.heapUsed
      ).render(),
      new GaugeMetric(
        'syntax_senpai_system_memory_usage_percent',
        'Host memory usage percentage',
        () => (((totalMemory - freeMemory) / totalMemory) * 100).toFixed(4)
      ).render(),
      new GaugeMetric(
        'syntax_senpai_plugins_loaded',
        'Number of loaded runtime plugins',
        () => this.loadedPlugins
      ).render(),
      new GaugeMetric(
        'syntax_senpai_backup_files',
        'Number of retained backup files',
        () => this.backupFileCount
      ).render(),
      new GaugeMetric(
        'syntax_senpai_uptime_seconds',
        'Process uptime in seconds',
        () => ((Date.now() - this.startedAt) / 1000).toFixed(2)
      ).render(),
      [
        '# HELP syntax_senpai_build_info Build information for the runtime service',
        '# TYPE syntax_senpai_build_info gauge',
        `syntax_senpai_build_info${formatLabels({ service: this.serviceName, version: this.version })} 1`
      ].join('\n')
    ]

    return `${lines.filter(Boolean).join('\n')}\n`
  }
}

module.exports = {
  RuntimeMetrics
}
