import { describe, expect, test } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { runAgentTurn } from '../../../packages/ai-core/src/agent-run'
import { screenshotPoint } from '../src/main/agent/computer-service'
import type { ComputerObservation, ToolCall } from '../../../packages/ai-core/src'

const codingTasks = [
  'add-search-filter', 'fix-null-profile', 'rename-api-field', 'add-pagination', 'repair-crlf-parser',
  'add-unit-test', 'fix-race-condition', 'update-vue-store', 'add-ipc-handler', 'stream-command-output',
  'reject-stale-write', 'track-untracked-file', 'handle-binary-diff', 'cancel-process-tree', 'compact-context',
  'replay-run-events', 'migrate-policy-setting', 'add-provider-capability', 'serialize-unicode-path', 'refresh-stale-check'
]

type Trial = {
  suite: 'coding' | 'computer'
  task: string
  trial: number
  passed: boolean
  durationMs: number
  modelRoundTrips: number
  inputTokens: number
  outputTokens: number
  subagentCostUsd: number
}

const tokenEstimate = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4)
const median = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

async function codingTrial(task: string, trial: number): Promise<Trial> {
  let round = 0
  let reads = 0
  let edited = false
  let checked = false
  let inputTokens = 0
  let outputTokens = 0
  const history: any[] = [{ role: 'user', content: `Complete coding task ${task}` }]
  const started = performance.now()
  const result = await runAgentTurn({
    model: 'deterministic-evaluation',
    history,
    systemPrompt: 'Inspect, edit, verify, and report with complete tool exchanges.',
    tools: [{ name: 'read_file' }, { name: 'write_file' }, { name: 'terminal' }] as any,
    maxIterations: 4,
    describeExecution: call => call.name === 'read_file'
      ? { access: 'read', resources: [`file:${String(call.arguments.path)}`], lane: 'tool' }
      : call.name === 'terminal'
        ? { access: 'write', resources: ['workspace'], lane: 'process' }
        : { access: 'write', resources: [`file:${String(call.arguments.path)}`], lane: 'tool' },
    callProvider: async request => {
      inputTokens += tokenEstimate({ messages: request.messages, tools: request.tools, systemPrompt: request.systemPrompt })
      let response: any
      if (round === 0) response = { id: `${task}-inspect`, content: '', toolCalls: [
        { id: `${task}-read-source`, name: 'read_file', arguments: { path: `src/${task}.ts` } },
        { id: `${task}-read-test`, name: 'read_file', arguments: { path: `test/${task}.test.ts` } }
      ] }
      else if (round === 1) response = { id: `${task}-edit`, content: '', toolCalls: [{ id: `${task}-write`, name: 'write_file', arguments: { path: `src/${task}.ts`, content: `trial-${trial}` } }] }
      else if (round === 2) response = { id: `${task}-verify`, content: '', toolCalls: [{ id: `${task}-check`, name: 'terminal', arguments: { command: `test ${task}` } }] }
      else response = { id: `${task}-final`, content: checked ? 'PASS' : 'INCOMPLETE', toolCalls: [] }
      round++
      outputTokens += tokenEstimate(response)
      return response
    },
    executeTool: async (call: ToolCall) => {
      if (call.name === 'read_file') {
        await new Promise(resolve => setTimeout(resolve, 1))
        reads++
        return JSON.stringify({ path: call.arguments.path, hash: `${task}-${trial}` })
      }
      if (call.name === 'write_file') {
        if (reads !== 2) throw new Error('edit started before independent inspection completed')
        edited = true
        return JSON.stringify({ written: call.arguments.path, hash: `${task}-${trial}-edited` })
      }
      if (call.name === 'terminal') {
        if (!edited) throw new Error('verification started before edit')
        checked = true
        return JSON.stringify({ exitCode: 0, checkedRevision: `${task}-${trial}-edited` })
      }
      throw new Error(`unexpected tool ${call.name}`)
    }
  })
  const calls = history.flatMap(message => message.toolCalls || [])
  const results = new Set(history.filter(message => message.role === 'tool').map(message => message.toolCallId))
  const completeProtocol = calls.every((call: ToolCall) => results.has(call.id))
  return {
    suite: 'coding', task, trial, passed: result.finalContent === 'PASS' && checked && completeProtocol,
    durationMs: Number((performance.now() - started).toFixed(3)), modelRoundTrips: result.iterations,
    inputTokens, outputTokens, subagentCostUsd: 0
  }
}

type ComputerScenario = {
  name: string
  observation: ComputerObservation
  action: ToolCall
  expected?: { x: number; y: number; toX?: number; toY?: number }
  expectedError?: RegExp
}

const observation = (overrides: Partial<ComputerObservation> = {}): ComputerObservation => ({
  id: 'observation', timestamp: Date.now(), appId: 'fixture', appName: 'Fixture', windowId: 'window',
  bounds: { x: 0, y: 0, width: 1000, height: 600 }, imageWidth: 2000, imageHeight: 1200,
  elements: [{ id: 'button', role: 'AXButton', label: 'Run', bounds: { x: 40, y: 50, width: 100, height: 40 } }],
  apps: [{ id: 'fixture', name: 'Fixture', pid: 0 }], displays: [], ...overrides
})

const computerTasks: ComputerScenario[] = [
  { name: 'accessibility-click', observation: observation(), action: { id: 'a', name: 'computer_click', arguments: { observation_id: 'observation', element_id: 'button' } }, expected: { x: 90, y: 70 } },
  { name: 'retina-coordinate-click', observation: observation(), action: { id: 'a', name: 'computer_click', arguments: { observation_id: 'observation', x: 1000, y: 600 } }, expected: { x: 500, y: 300 } },
  { name: 'resized-screenshot-click', observation: observation({ imageWidth: 1000, imageHeight: 600 }), action: { id: 'a', name: 'computer_click', arguments: { observation_id: 'observation', x: 250, y: 150 } }, expected: { x: 250, y: 150 } },
  { name: 'cropped-capture-click', observation: observation({ bounds: { x: 200, y: 100, width: 400, height: 300 }, imageWidth: 800, imageHeight: 600 }), action: { id: 'a', name: 'computer_click', arguments: { observation_id: 'observation', x: 400, y: 300 } }, expected: { x: 400, y: 250 } },
  { name: 'negative-display-click', observation: observation({ bounds: { x: -1280, y: 0, width: 1280, height: 720 }, imageWidth: 1280, imageHeight: 720 }), action: { id: 'a', name: 'computer_click', arguments: { observation_id: 'observation', x: 100, y: 200 } }, expected: { x: -1180, y: 200 } },
  { name: 'scaled-drag', observation: observation(), action: { id: 'a', name: 'computer_drag', arguments: { observation_id: 'observation', x: 200, y: 100, to_x: 1800, to_y: 1100 } }, expected: { x: 100, y: 50, toX: 900, toY: 550 } },
  { name: 'out-of-bounds-rejected', observation: observation(), action: { id: 'a', name: 'computer_click', arguments: { observation_id: 'observation', x: 2000, y: 10 } }, expectedError: /outside/ },
  { name: 'missing-element-rejected', observation: observation(), action: { id: 'a', name: 'computer_click', arguments: { observation_id: 'observation', element_id: 'missing' } }, expectedError: /not discovered/ },
  { name: 'stale-observation-rejected', observation: observation({ timestamp: Date.now() - 31000 }), action: { id: 'a', name: 'computer_click', arguments: { observation_id: 'observation', element_id: 'button' } }, expectedError: /stale/ },
  { name: 'focus-change-rejected', observation: observation(), action: { id: 'a', name: 'computer_focus', arguments: { observation_id: 'observation', app_id: 'missing' } }, expectedError: /not discovered/ }
]

async function computerTrial(scenario: ComputerScenario, trial: number): Promise<Trial> {
  let round = 0
  let inputTokens = 0
  let outputTokens = 0
  let toolOutcome = ''
  const history: any[] = [{ role: 'user', content: `Perform and verify ${scenario.name}` }]
  const started = performance.now()
  const result = await runAgentTurn({
    model: 'deterministic-evaluation', history, systemPrompt: 'Observe, act once, then verify.',
    tools: [{ name: scenario.action.name }] as any, maxIterations: 2,
    callProvider: async request => {
      inputTokens += tokenEstimate({ messages: request.messages, tools: request.tools, systemPrompt: request.systemPrompt })
      const response = round++ === 0
        ? { id: `${scenario.name}-action`, content: '', toolCalls: [{ ...scenario.action, id: `${scenario.action.id}-${trial}` }] }
        : { id: `${scenario.name}-final`, content: scenario.expectedError ? (scenario.expectedError.test(toolOutcome) ? 'PASS' : 'INCOMPLETE') : (toolOutcome === 'verified' ? 'PASS' : 'INCOMPLETE'), toolCalls: [] }
      outputTokens += tokenEstimate(response)
      return response
    },
    executeTool: async call => {
      try {
        const current = scenario.observation
        const args = call.arguments as { app_id?: string; element_id?: string; x?: number; y?: number; to_x?: number; to_y?: number }
        const point = (x: number | undefined, y: number | undefined) => {
          if (x === undefined || y === undefined) throw new Error('Coordinates were not provided')
          return screenshotPoint(current, x, y)
        }
        if (Date.now() - current.timestamp > 30000) throw new Error('Observation is stale')
        if (args.app_id && !current.apps?.some(app => app.id === args.app_id)) throw new Error('Application was not discovered')
        let start: { x: number; y: number }
        if (args.element_id) {
          const element = current.elements.find(item => item.id === args.element_id)
          if (!element?.bounds) throw new Error('Element was not discovered')
          start = { x: element.bounds.x + element.bounds.width / 2, y: element.bounds.y + element.bounds.height / 2 }
        } else start = point(args.x, args.y)
        const end = call.name === 'computer_drag' ? point(args.to_x, args.to_y) : undefined
        const expected = scenario.expected!
        if (start.x !== expected.x || start.y !== expected.y || end?.x !== expected.toX || end?.y !== expected.toY) throw new Error('Coordinate transform mismatch')
        toolOutcome = 'verified'
        return toolOutcome
      } catch (error) {
        toolOutcome = error instanceof Error ? error.message : String(error)
        throw error
      }
    }
  })
  return {
    suite: 'computer', task: scenario.name, trial, passed: result.finalContent === 'PASS',
    durationMs: Number((performance.now() - started).toFixed(3)), modelRoundTrips: result.iterations,
    inputTokens, outputTokens, subagentCostUsd: 0
  }
}

describe('deterministic agent evaluation', () => {
  test('runs 20 coding and 10 computer-use tasks three times', async () => {
    const trials: Trial[] = []
    for (let trial = 1; trial <= 3; trial++) {
      for (const task of codingTasks) trials.push(await codingTrial(task, trial))
      for (const task of computerTasks) trials.push(await computerTrial(task, trial))
    }
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      methodology: 'Deterministic provider and tool fixtures exercise the shared AgentRun protocol, scheduling, verification order, complete tool-result pairs, and computer coordinate/staleness rules. This is reproducible regression evidence, not a live-model quality benchmark.',
      totals: {
        trials: trials.length,
        passed: trials.filter(item => item.passed).length,
        failed: trials.filter(item => !item.passed).length,
        medianCompletionMs: Number(median(trials.map(item => item.durationMs)).toFixed(3)),
        modelRoundTrips: trials.reduce((sum, item) => sum + item.modelRoundTrips, 0),
        inputTokens: trials.reduce((sum, item) => sum + item.inputTokens, 0),
        outputTokens: trials.reduce((sum, item) => sum + item.outputTokens, 0),
        subagentCostUsd: 0
      },
      optimizationTargets: { baselineAvailable: false, completionTimeReductionTargetPercent: 25, inputTokenReductionTargetPercent: 20 },
      trials
    }
    const reportDirectory = path.resolve('e2e/reports')
    mkdirSync(reportDirectory, { recursive: true })
    writeFileSync(path.join(reportDirectory, 'agent-runtime-deterministic.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(`EVALUATION ${JSON.stringify(report.totals)}`)
    expect(report.totals.trials).toBe(90)
    expect(report.totals.failed).toBe(0)
  }, 30_000)
})
