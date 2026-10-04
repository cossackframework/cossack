import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {chromium,expect} from '@playwright/test';

const browserExpect=expect;

// The browser driver is a repository test client. Vite and every application
// dependency resolve from root, including when root contains installed tarballs.
export async function verifyDevelopmentTraceApplication(root,{onRecorded,additionalAllowedPaths=[],transport='http'}) {
  const files=['vite.config.ts','src/services/TraceCounter.ts','src/pages/layout.ts','src/pages/index.ts',...(transport==='durable-object'?['wrangler.jsonc','src/index.ts']:[])];
  const backups=new Map();
  for(const file of files){
    try{backups.set(file,await fs.readFile(path.join(root,file)));}
    catch(error){if(error.code!=='ENOENT')throw error;backups.set(file,null);}
  }
  try {
  if(transport==='durable-object') {
    const configPath=path.join(root,'wrangler.jsonc'), config=JSON.parse(await fs.readFile(configPath,'utf8'));
    config.durable_objects.bindings.push({name:'COSSACK_OBJECT',class_name:'TraceAcceptanceObject'});
    config.migrations.push({tag:'trace-acceptance-v2',new_sqlite_classes:['TraceAcceptanceObject']});
    await fs.writeFile(configPath,JSON.stringify(config));
    await fs.appendFile(path.join(root,'src/index.ts'), "\nexport { AppDurableObject as TraceAcceptanceObject } from '@cossackframework/framework';\n");
  }
  const configFile=path.join(root,'vite.config.ts');
  const generatedConfig=await fs.readFile(configFile,'utf8');
  expect(generatedConfig).toContain('cossackPages({');
  await fs.writeFile(configFile,generatedConfig.replace('cossackPages({','cossackPages({ developmentTraces: true,'));
  await fs.mkdir(path.join(root,'src/services'),{recursive:true});
  await fs.writeFile(path.join(root,'src/services/TraceCounter.ts'), `
    import {CossackService,Service,State,Server} from '@cossackframework/core';
    @Service() export default class TraceCounter extends CossackService {
      @State() count=0;
      @Server() async serviceIncrement(value:string){this.count++;return value;}
    }
  `);
  await fs.writeFile(path.join(root,'src/pages/layout.ts'), `
    import {Cossack,Page} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    import TraceCounter from '../services/TraceCounter';
    @Page({services:[TraceCounter]}) export default class Layout extends Cossack {
      render(){return html\`\${this.children}\`;}
    }
  `);
  await fs.writeFile(path.join(root,'src/pages/index.ts'), `
    import {Cossack,Page,Client,Server,State,ClientState,Inject,ClientVisibleError,rpc$} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    import {enableDevTools} from '@cossackframework/framework/client/devtools';
    import TraceCounter from '../services/TraceCounter';
    @Page({transport:'${transport}',stateful:false}) export default class TracePage extends Cossack {
      @State() count=0;
      @ClientState() failure='';
      @Inject(TraceCounter) counter!:TraceCounter;
      @Server() async *componentStream(value:string){this.count++;yield value;this.count++;return value;}
      @Server() async componentFailure(){throw new ClientVisibleError('private-error-sentinel');}
      @Client() onMount(){if(import.meta.env.DEV)(window as any).__traceFixture={tools:enableDevTools(),component:this};}
      @Client() async runComponent(){for await(const _value of rpc$(this.componentStream('private-value-sentinel'))){} }
      @Client() async runService(){await this.counter.serviceIncrement('private-value-sentinel');}
      @Client() async runFailure(){try{await this.componentFailure();}catch(error){this.failure=(error as {code:string}).code;}}
      render(){return html\`<main><span id="trace-count">\${this.count}</span><span id="trace-service">\${this.counter.count}</span>
        <span id="trace-failure">\${this.failure}</span>
        <button @click="\${()=>this.runComponent()}">Component stream</button>
        <button @click="\${()=>this.runService()}">Service action</button>
        <button @click="\${()=>this.runFailure()}">Failed action</button></main>\`;}
    }
  `);
  try {await promisify(execFile)('pnpm',['exec','tsc','--noEmit'],{cwd:root,timeout:30000,maxBuffer:1024*1024});}
  catch(error){throw new Error(`Generated trace types: ${error.stdout}\n${error.stderr}`);}
  const child=spawn(process.execPath,['--input-type=module','-e',`
    import {createServer} from 'vite';
    const server=await createServer({root:${JSON.stringify(root)},logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:${JSON.stringify([root,...additionalAllowedPaths])}}}});
    await server.listen();
    console.log('TRACE_ORIGIN=http://127.0.0.1:'+server.httpServer.address().port);
    process.once('message',async()=>{await server.close();process.exit(0);});
  `],{cwd:root,env:{...process.env,NODE_ENV:'development',VITEST:'',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  const exited=once(child,'exit');let browser;
  try {
    await expect.poll(()=>{
      if(child.exitCode!==null)throw new Error(output);
      return /TRACE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    },{timeout:30000}).toBeTruthy();
    const origin=/TRACE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.url().includes('development-trace'))output+='\nTRACE_MODULE='+request.url();});
    page.on('console',message=>{if(message.type()==='error')output+='\nBROWSER_ERROR='+message.text();});
    page.on('websocket',socket=>{
      for(const direction of ['framesent','framereceived'])socket.on(direction,({payload})=>{
        try {const message=JSON.parse(String(payload));if(message.event?.includes('development-trace'))output+='\nTRACE_HMR='+JSON.stringify({direction,event:message.event,id:message.data?.id,status:message.data?.status});}catch{}
      });
    });
    await page.goto(origin);await page.waitForFunction(()=>!!window.__traceFixture,{},{timeout:30000});
    if(transport==='durable-object')await page.waitForFunction(()=>Object.values(window.__traceFixture.component.realtime.websockets).some(connection=>connection.state==='open'),{},{timeout:30000});
    expect(await page.content()).toContain('cossack-start:');
    expect(await page.evaluate(()=>window.__traceFixture.tools.snapshot())).toBeNull();
    await page.getByRole('button',{name:'Record trace',exact:true}).click();
    await page.getByRole('button',{name:'Component stream',exact:true}).click();
    await browserExpect(page.locator('#trace-count')).toHaveText('2');
    await page.getByRole('button',{name:'Service action',exact:true}).click();
    await browserExpect(page.locator('#trace-service')).toHaveText('1');
    await page.getByRole('button',{name:'Failed action',exact:true}).click();
    await browserExpect(page.locator('#trace-failure')).toHaveText('COSSACK_RPC_CLIENT_ERROR');
    await page.getByRole('button',{name:'Stop trace',exact:true}).click();
    const snapshot=await page.evaluate(()=>window.__traceFixture.tools.snapshot());
    const calls=snapshot.events.filter(event=>(event.kind==='rpc'||event.kind==='service-rpc')&&event.phase==='start');
    expect(calls).toHaveLength(3);
    for(const call of calls){
      const joined=snapshot.events.filter(event=>event.callId===call.callId);
      expect(joined.filter(event=>(event.kind==='rpc'||event.kind==='service-rpc')&&event.phase==='finish')).toHaveLength(1);
      if(call.transport==='websocket') {
        const evidence=joined.filter(event=>event.kind==='server-socket');
        expect(evidence.length).toBeGreaterThan(0);
        expect(new Set(evidence.map(event=>event.dispatchId)).size).toBe(1);
        for(const event of evidence)expect(event).toMatchObject({requestId:call.requestId,invokedAt:expect.any(Number)});
        expect(evidence.map(event=>event.frame)).toEqual(evidence[0].result==='stream'?['yield','done']:['error']);
      } else {
        const dispatch=joined.find(event=>event.kind==='server-rpc');
        expect(dispatch).toMatchObject({requestId:call.requestId,invokedAt:expect.any(Number)});
        if(dispatch.result==='stream')expect(joined.find(event=>event.kind==='server-stream')).toMatchObject({requestId:call.requestId,dispatchId:dispatch.dispatchId,outcome:'succeeded',cleanup:'completed'});
      }
    }
    expect(snapshot.events.filter(event=>event.kind==='server-stream')).toHaveLength(transport==='http'?1:0);
    expect(snapshot.events.filter(event=>event.kind==='server-socket')).toHaveLength(transport==='http'?0:3);
    expect(snapshot.events.filter(event=>event.phase==='finish'&&event.outcome==='failed')).toHaveLength(1);
    expect(snapshot.sessionId).toMatch(/^[a-f0-9-]{36}$/i);
    const readRecord=async()=>{
      try{return JSON.parse(await fs.readFile(path.join(root,'.cossack/development-traces',snapshot.sessionId+'.json'),'utf8'));}
      catch(error){if(error.code==='ENOENT')return null;throw error;}
    };
    await expect.poll(async()=> (await readRecord())?.snapshot.collecting,{timeout:10000}).toBe(false);
    const recorded=await readRecord();
    expect(recorded.snapshot.events).toEqual(snapshot.events);
    for(const secret of ['private-value-sentinel','private-error-sentinel','componentStream','serviceIncrement'])expect(JSON.stringify(recorded)).not.toContain(secret);
    await onRecorded({snapshot,recorded});
    expect(errors).toEqual([]);
  } catch(error) {throw new Error(`${error.stack}\nGenerated Vite output:\n${output}`);}
  finally {
    await browser?.close();
    if(child.exitCode===null)child.send('stop');
    const kill=setTimeout(()=>child.kill('SIGKILL'),10000);const [exitCode,signal]=await exited;clearTimeout(kill);
    expect({exitCode,signal},output).toEqual({exitCode:0,signal:null});
  }
  const require=createRequire(path.join(root,'package.json'));
  const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
  await promisify(execFile)(process.execPath,[vite,'build'],{
    cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:'',WRANGLER_SEND_METRICS:'false'},timeout:120000,maxBuffer:8*1024*1024,
  });
  const checkProduction=async directory=>{
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await checkProduction(file);
      else if(entry.name.endsWith('.js')){
        const source=await fs.readFile(file,'utf8');
        for(const marker of ['X-Cossack-Development-Trace','Record trace','server-stream','server-socket','beginDevelopmentSocketDispatch','cossack-start:'])expect(source.includes(marker),`${file}: ${marker}`).toBe(false);
      }
    }
  };
  await checkProduction(path.join(root,'dist/client/assets'));await checkProduction(path.join(root,'dist/ssr'));
  } finally {
    for(const [file,content] of backups){
      if(content===null)await fs.rm(path.join(root,file),{force:true});
      else await fs.writeFile(path.join(root,file),content);
    }
  }
}
