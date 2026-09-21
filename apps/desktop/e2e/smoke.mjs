import { _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = await mkdtemp(path.join(os.tmpdir(), 'syntax-e2e-'))
const repo = path.join(root, 'repo'); await mkdir(repo)
execFileSync('git', ['init', repo])
let reviews = 'allow'
const server = createServer(async (req, res) => {
  let raw=''; for await(const chunk of req) raw+=chunk
  if(req.method === 'GET') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'local-model'}]}));return}
  const body=JSON.parse(raw), isReview = body.messages?.some(m=>String(m.content).includes('automatic execution reviewer'))
  let text='', call
  if(isReview) text=reviews === 'error' ? 'not valid json' : JSON.stringify({approved:reviews==='allow',reason:'fixture '+reviews})
  else {
    const count=body.messages.filter(m=>m.role==='tool').length
    if(count===0) call={id:'write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'result.txt',content:'verified fixture\n'})}}
    else if(count===1 && !String(body.messages.at(-1).content).includes('BLOCKED')) call={id:'check',type:'function',function:{name:'terminal',arguments:JSON.stringify({command:'sleep .4; test -f result.txt && cat result.txt',purpose:'check'})}}
    else text='Fixture finished. Check the recorded result.'
  }
  res.setHeader('Content-Type','text/event-stream')
  const delta=call?{tool_calls:[{index:0,...call}]}:{content:text}
  res.write('data: '+JSON.stringify({choices:[{delta,finish_reason:null}]})+'\n\n')
  res.write('data: '+JSON.stringify({choices:[{delta:{},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})+'\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const port=server.address().port
const options={args:[path.resolve('dist/main/index.js')],env:{...process.env,ELECTRON_RUN_AS_NODE:'',NODE_ENV:'production',SYNTAX_SENPAI_DATA_DIR:path.join(root,'data')},cwd:process.cwd()}
delete options.env.ELECTRON_RUN_AS_NODE
if(process.env.SYNTAX_PACKAGED_APP) { options.executablePath=process.env.SYNTAX_PACKAGED_APP; options.args=[] }
let app
try {
  app=await electron.launch(options)
  const page=await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
  const errors=[]; page.on('pageerror',e=>errors.push(e.message))
  await page.waitForFunction(()=>!!window.electron?.ipcRenderer)
  const invoke=(channel,...args)=>page.evaluate(({channel,args})=>window.electron.ipcRenderer.invoke(channel,...args),{channel,args})
  assert.deepEqual(await invoke('policy:get'),{version:2,autoDecideActions:false})
  const logged=await invoke('terminal:exec','printf syntax-audit',repo)
  assert.equal(logged.stdout,'syntax-audit')
  assert.match((await invoke('agent:getAudit')).content,/"event":"terminal"/)
  const created=await invoke('store:createConversation','aria','Runtime fixture')
  const definitions=['write_file','terminal','read_file'].map(name=>({name,description:'Fixture '+name,parameters:{type:'object',properties:{}}}))
  const spec={conversationId:created.conversation.id,workspace:repo,providerConfig:{type:'lmstudio',baseUrl:`http://127.0.0.1:${port}/v1`},model:'local-model',history:[{id:'user',role:'user',content:'Write result.txt and verify it. Do not push.'}],tools:definitions,systemPrompt:'Fixture coding task',maxIterations:3}
  const id=await invoke('runs:start',spec)
  // Reload while the main process owns an in-flight tool/provider turn.
  await page.reload(); await page.waitForFunction(()=>!!window.electron?.ipcRenderer)
  const result=await invoke('runs:result',id)
  assert.match(await readFile(path.join(repo,'result.txt'),'utf8'),/verified fixture/)
  const events=await invoke('runs:replay',id,0)
  assert(events.some(e=>e.type==='file.edit' && e.payload.additions===1))
  assert(events.some(e=>e.type==='process.output'))
  assert(events.some(e=>e.type==='checks' && e.payload.some(c=>c.status==='passed')))
  assert(result.history.some(m=>m.role==='tool'))
  const runs=await invoke('runs:list',created.conversation.id)
  assert.equal(runs[0].status,'verified')
  for(const behavior of ['block','error']) {
    reviews=behavior; await invoke('policy:set',{version:2,autoDecideActions:true})
    const next=await invoke('runs:start',{...spec,workspace:path.join(root,behavior)})
    await invoke('runs:result',next)
    const ev=await invoke('runs:replay',next,0)
    assert(ev.some(e=>e.type==='policy.blocked'))
    await assert.rejects(readFile(path.join(root,behavior,'result.txt')))
  }
  reviews='allow'; await invoke('policy:set',{version:2,autoDecideActions:true})
  const allow=await invoke('runs:start',{...spec,workspace:path.join(root,'allowed')}); await invoke('runs:result',allow)
  assert.match(await readFile(path.join(root,'allowed','result.txt'),'utf8'),/verified fixture/)
  const status=await invoke('computer:status')
  await page.screenshot({path:path.join(root,'app.png')})
  await writeFile(path.join(root,'report.json'),JSON.stringify({passed:true,runId:id,status,runtimeErrors:errors,events:events.length},null,2))
  console.log(JSON.stringify({passed:true,root,status,runtimeErrors:errors}))
} finally { if(app) await app.close(); server.close() }
