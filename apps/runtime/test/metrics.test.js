const test = require('node:test')
const assert = require('node:assert/strict')

const { RuntimeMetrics } = require('../src/metrics')

test('RuntimeMetrics renders request and AI metrics in Prometheus format', () => {
  const metrics = new RuntimeMetrics({
    serviceName: 'syntax-senpai-runtime',
    version: 'test'
  })

  metrics.observeRequest('GET', 'healthz', 200, 12)
  metrics.observeAiRequest('openai', 'gpt-4.1', 'success', 450)
  metrics.observeBackup('export', 'success')
  metrics.setPluginCount(3)
  metrics.setBackupFileCount(2)

  const rendered = metrics.render()
  assert.match(rendered, /syntax_senpai_http_requests_total\{method="GET",route="healthz",status_code="200"\} 1/)
  assert.match(rendered, /syntax_senpai_ai_request_duration_ms_count\{provider="openai",model="gpt-4.1",status="success"\} 1/)
  assert.match(rendered, /syntax_senpai_plugins_loaded 3/)
  assert.match(rendered, /syntax_senpai_backup_files 2/)
})
