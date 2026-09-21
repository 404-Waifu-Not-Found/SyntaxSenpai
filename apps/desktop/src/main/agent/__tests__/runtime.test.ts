import { describe, it, expect } from 'vitest'
import { ResourceScheduler, conflicts, migrateExecutionPolicy, runAgentTurn, compactWorkingContext } from '@syntax-senpai/ai-core'
import { screenshotPoint } from '../computer-service'
import { executionMetadata } from '../tool-host'
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
describe('execution contracts', () => {
  it('migrates every legacy mode to direct; preserves subsequent Auto decide', () => {
    for (const value of [undefined, 'ask', 'auto', 'full', { agentMode: 'auto' }, { version: 1, autoDecideActions: true }]) expect(migrateExecutionPolicy(value).autoDecideActions).toBe(false)
    expect(migrateExecutionPolicy({ version: 2, autoDecideActions: true }).autoDecideActions).toBe(true)
  })
  it('locks arbitrary shells exclusively and permits independent file reads', () => {
    const shell = executionMetadata({ id: 's', name: 'terminal', arguments: { command: 'anything' } }, '/repo')
    expect(conflicts(shell, executionMetadata({ id: 'f', name: 'write_file', arguments: { path: 'x' } }, '/repo'))).toBe(true)
    expect(conflicts(shell, executionMetadata({ id: 'f', name: 'write_file', arguments: { path: 'x' } }, '/other'))).toBe(false)
  })
  it('fills available worker slots without waiting for the whole batch', async () => {
    const scheduler = new ResourceScheduler(2); const order: string[] = []
    await Promise.all([60, 5, 5].map((ms, i) => scheduler.schedule({ access: 'read', resources: [String(i)] }, async () => { order.push('start' + i); await delay(ms); order.push('end' + i) })))
    expect(order.indexOf('start2')).toBeLessThan(order.indexOf('end0'))
  })
  it('serializes conflicting writes and lets unrelated work proceed', async () => {
    const scheduler = new ResourceScheduler(8); const order: string[] = []
    await Promise.all(['/a','/a','/b'].map((r, i) => scheduler.schedule({ access: 'write', resources: [r] }, async () => { order.push('start' + i); await delay(10); order.push('end' + i) })))
    expect(order.indexOf('start1')).toBeGreaterThan(order.indexOf('end0'))
    expect(order.indexOf('start2')).toBeLessThan(order.indexOf('end0'))
  })
  it('preserves failed, successful and cancelled tool/result pairs', async () => {
    const controller = new AbortController(), history: any[] = []; let round = 0
    await runAgentTurn({ model: 'fixture', history, tools: [], systemPrompt: '', maxIterations: 2, abortSignal: controller.signal,
      callProvider: async () => ++round === 1 ? { toolCalls: [{ id:'1', name:'read_file', arguments:{} }, { id:'2', name:'write_file', arguments:{} }, { id:'3', name:'stop_response', arguments:{} }] } : { content:'done' },
      executeTool: async tc => { if (tc.id === '1') throw Error('fixture failure'); controller.abort(); return 'saved' }, handleSideEffect: () => { throw Error('should not run') } })
    expect(history.filter(m => m.role === 'tool').map(m => m.toolCallId)).toEqual(['1','2','3'])
    expect(history.find(m => m.toolCallId === '1').content).toContain('fixture failure')
    expect(history.find(m => m.toolCallId === '3').content).toContain('Cancelled')
  })
  it('disables tools at the iteration limit and preserves final evidence', async () => {
    const history: any[] = []; let round = 0
    const result = await runAgentTurn({ model:'x', history, tools:[{name:'read',description:'',parameters:{}}], systemPrompt:'', maxIterations:1, callProvider: async req => { round++; if(round === 2) { expect(req.tools).toEqual([]); return {content:'Incomplete: checks not run'} }; return {toolCalls:[{id:'a',name:'read',arguments:{}}]} }, executeTool: async () => 'file content' })
    expect(result.reachedMaxIterations).toBe(true); expect(history.at(-1).content).toContain('Incomplete')
  })
  it('compacts complete exchanges without changing original history', () => {
    const original = [{ role:'user',content:'goal' },{role:'assistant',toolCalls:[{id:'x'}]},{role:'tool',toolCallId:'x',content:'evidence'},{role:'assistant',content:'answer'}]
    const copy = JSON.stringify(original), compacted = compactWorkingContext(original,'Goal and evidence',2)
    expect(JSON.stringify(original)).toBe(copy)
    expect(compacted.find(m => m.toolCalls)?.toolCalls[0].id).toBe('x')
    expect(compacted.find(m => m.role === 'tool')?.toolCallId).toBe('x')
  })
  it('transforms Retina/cropped images and negative display coordinates', () => {
    const o: any = { bounds:{ x:-1920,y:100,width:960,height:540 },imageWidth:1600,imageHeight:900 }
    expect(screenshotPoint(o,800,450)).toEqual({x:-1440,y:370})
    expect(() => screenshotPoint(o,1600,0)).toThrow('outside')
  })
})
