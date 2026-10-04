import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:net';
import {execFile,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {chromium,expect} from '@playwright/test';

const browserExpect=expect;

// The browser driver is a repository test client. Vite and every application
// dependency resolve from root, including when root contains installed tarballs.
export async function verifyDevelopmentTraceApplication(root,{onRecorded,additionalAllowedPaths=[],transport='http',runtime='cloudflare',https=false,launcher}) {
  // Repeated installed runs must not inherit the SSE coordinator's durable state.
  const scope='trace-acceptance-'+randomUUID();
  const files=['src/pages/api/trace-context.ts','vite.config.ts','src/services/TraceCounter.ts','src/pages/layout.ts','src/pages/index.ts',...(transport==='durable-object'&&runtime==='cloudflare'?['wrangler.jsonc','src/index.ts']:[])];
  const backups=new Map();
  for(const file of files){
    try{backups.set(file,await fs.readFile(path.join(root,file)));}
    catch(error){if(error.code!=='ENOENT')throw error;backups.set(file,null);}
  }
  let tlsDirectory;
  try {
  let tls;
  if(https){
    tlsDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-trace-tls-'));
    const key=path.join(tlsDirectory,'key.pem'),cert=path.join(tlsDirectory,'cert.pem');
    await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{timeout:15000});
    tls={key:await fs.readFile(key,'utf8'),cert:await fs.readFile(cert,'utf8')};
  }
  if(transport==='durable-object'&&runtime==='cloudflare') {
    const configPath=path.join(root,'wrangler.jsonc'), config=JSON.parse(await fs.readFile(configPath,'utf8'));
    config.durable_objects.bindings.push({name:'COSSACK_OBJECT',class_name:'TraceAcceptanceObject'});
    config.migrations.push({tag:'trace-acceptance-v2',new_sqlite_classes:['TraceAcceptanceObject']});
    await fs.writeFile(configPath,JSON.stringify(config));
    await fs.appendFile(path.join(root,'src/index.ts'), "\nexport { AppDurableObject as TraceAcceptanceObject } from '@cossackframework/framework';\n");
  }
  const configFile=path.join(root,'vite.config.ts');
  const generatedConfig=await fs.readFile(configFile,'utf8');
  expect(generatedConfig).toContain('cossackPages({');
  let traceConfig=generatedConfig.replace('cossackPages({','cossackPages({ developmentTraces: true,');
  if(launcher){
    expect(traceConfig).toContain('plugins: [');
    traceConfig=traceConfig.replace('plugins: [',`plugins: [{name:'trace-server-options',config:()=>({server:${JSON.stringify({https:tls,fs:{allow:[root,...additionalAllowedPaths]}})}})},`);
  }
  await fs.writeFile(configFile,traceConfig);
  await fs.mkdir(path.join(root,'src/pages/api'),{recursive:true});
  await fs.writeFile(path.join(root,'src/pages/api/trace-context.ts'), `
    import {defineApi} from '@cossackframework/framework/api';
    export const GET=defineApi({handler:async({c})=>c.json({url:c.req.url})});
  `);
  await fs.mkdir(path.join(root,'src/services'),{recursive:true});
  await fs.writeFile(path.join(root,'src/services/TraceCounter.ts'), `
    import {CossackService,Service,State,Server} from '@cossackframework/core';
    @Service() export default class TraceCounter extends CossackService {
      @State() count=0;
      @Server() async serviceIncrement(value:string){this.count++;return value;}
      @Server() async nativeBody(){return new Response(new Uint8Array([0,255,128]),{status:201,headers:{'Content-Length':'3','X-Native-Test':'kept'}});}
      @Server() async nativeEmpty(){return new Response(null,{status:204});}
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
    @Page({transport:'${transport}',stateful:false,scope:()=>${JSON.stringify(scope)}}) export default class TracePage extends Cossack {
      @State() count=0;
      @ClientState() failure='';
      @ClientState() nativeResult='';
      @ClientState() nativeEmptyResult='';
      @ClientState() componentNativeResult='';
      @Inject(TraceCounter) counter!:TraceCounter;
      @Server() async *componentStream(value:string){this.count++;yield value;this.count++;return value;}
      @Server() async componentNative(){return new Response(new Uint8Array([0,255,128]),{status:201,headers:{'Content-Length':'3','X-Native-Test':'kept'}});}
      @Server() async componentFailure(){throw new ClientVisibleError('private-error-sentinel');}
      @Client() onMount(){if(import.meta.env.DEV)(window as any).__traceFixture={tools:enableDevTools(),component:this};}
      @Client() async runComponent(){for await(const _value of rpc$(this.componentStream('private-value-sentinel'))){} }
      @Client() async runService(){await this.counter.serviceIncrement('private-value-sentinel');}
      @Client() async runNative(){const response=await rpc$(this.counter.nativeBody());if(response)this.nativeResult=[response.status,response.headers.get('X-Native-Test'),...new Uint8Array(await response.arrayBuffer())].join(',');}
      @Client() async runEmpty(){const response=await rpc$(this.counter.nativeEmpty());if(response)this.nativeEmptyResult=String(response.status)+':'+String(response.body===null);}
      @Client() async runComponentNative(){const response=await rpc$(this.componentNative());if(response)this.componentNativeResult=[response.status,response.headers.get('X-Native-Test'),...new Uint8Array(await response.arrayBuffer())].join(',');}
      @Client() async runFailure(){try{await this.componentFailure();}catch(error){this.failure=(error as {code:string}).code;}}
      render(){return html\`<main><span id="trace-count">\${this.count}</span><span id="trace-service">\${this.counter.count}</span>
        <span id="trace-native">\${this.nativeResult}</span><span id="trace-empty">\${this.nativeEmptyResult}</span><span id="trace-component-native">\${this.componentNativeResult}</span>
        <button @click="\${()=>this.runNative()}">Native service</button>
        <button @click="\${()=>this.runEmpty()}">Empty service</button>
        <button @click="\${()=>this.runComponentNative()}">Native component</button>
        <span id="trace-failure">\${this.failure}</span>
        <button @click="\${()=>this.runComponent()}">Component stream</button>
        <button @click="\${()=>this.runService()}">Service action</button>
        <button @click="\${()=>this.runFailure()}">Failed action</button></main>\`;}
    }
  `);
  try {await promisify(execFile)('pnpm',['exec','tsc','--noEmit'],{cwd:root,timeout:30000,maxBuffer:1024*1024});}
  catch(error){throw new Error(`Generated trace types: ${error.stdout}\n${error.stderr}`);}
  let cliOrigin;
  let cliArgs;
  if(launcher){
    const reservation=createServer();
    await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
    const port=reservation.address().port;
    await new Promise(resolve=>reservation.close(resolve));
    cliOrigin=`${https?'https':'http'}://127.0.0.1:${port}`;
    cliArgs=[launcher.entry,'dev',...(launcher.json?['--json']:[]),'--host','127.0.0.1','--port',String(port),'--strictPort'];
  }
  const viteArgs=['--input-type=module','-e',`
    import {createServer} from 'vite';
    const server=await createServer({root:${JSON.stringify(root)},logLevel:'error',server:{host:'127.0.0.1',port:0,https:${JSON.stringify(tls)},fs:{allow:${JSON.stringify([root,...additionalAllowedPaths])}}}});
    await server.listen();
    console.log('TRACE_ORIGIN=${https?'https':'http'}://127.0.0.1:'+server.httpServer.address().port);
    process.once('message',async()=>{await server.close();process.exit(0);});
  `];
  const child=spawn(process.execPath,cliArgs??viteArgs,{cwd:root,env:{...process.env,PATH:(launcher?.binDirectory??path.join(root,'node_modules/.bin'))+path.delimiter+process.env.PATH,NODE_ENV:'development',VITEST:'',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe',...(launcher?[]:['ipc'])]});
  let output='',stdout='';child.stdout.on('data',data=>{output+=data;stdout+=data;});child.stderr.on('data',data=>{output+=data;});
  const exited=once(child,'exit');let browser;
  try {
    browser=await chromium.launch({headless:true});const page=await browser.newPage({ignoreHTTPSErrors:https});const errors=[];
    await expect.poll(async()=>{
      if(child.exitCode!==null)throw new Error(output);
      if(!launcher)return /TRACE_ORIGIN=(https?:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
      try{return (await page.request.get(cliOrigin+'/@vite/client',{timeout:1000})).ok();}catch{return false;}
    },{timeout:30000}).toBeTruthy();
    const origin=cliOrigin??/TRACE_ORIGIN=(https?:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.url().includes('development-trace'))output+='\nTRACE_MODULE='+request.url();});
    page.on('console',message=>{if(message.type()==='error')output+='\nBROWSER_ERROR='+message.text();});
    page.on('websocket',socket=>{
      for(const direction of ['framesent','framereceived'])socket.on(direction,({payload})=>{
        try {const message=JSON.parse(String(payload));if(message.event?.includes('development-trace'))output+='\nTRACE_HMR='+JSON.stringify({direction,event:message.event,id:message.data?.id,status:message.data?.status});}catch{}
      });
    });
    expect(await (await page.request.get(origin+'/api/trace-context?check=public')).json()).toEqual({url:origin+'/api/trace-context?check=public'});
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
    await page.getByRole('button',{name:'Native service',exact:true}).click();
    await browserExpect(page.locator('#trace-native')).toHaveText('201,kept,0,255,128');
    await page.getByRole('button',{name:'Empty service',exact:true}).click();
    await browserExpect(page.locator('#trace-empty')).toHaveText('204:true');
    if(transport!=='durable-object') {
      await page.getByRole('button',{name:'Native component',exact:true}).click();
      await browserExpect(page.locator('#trace-component-native')).toHaveText('201,kept,0,255,128');
    }
    await expect.poll(()=>page.evaluate(()=>window.__traceFixture.tools.snapshot().events.filter(event=>event.kind==='server-native').length),{timeout:10000}).toBe(transport!=='durable-object'?3:2);
    await page.getByRole('button',{name:'Stop trace',exact:true}).click();
    const snapshot=await page.evaluate(()=>window.__traceFixture.tools.snapshot());
    const calls=snapshot.events.filter(event=>(event.kind==='rpc'||event.kind==='service-rpc')&&event.phase==='start');
    expect(calls).toHaveLength(transport!=='durable-object'?6:5);
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
        if(dispatch.result==='native')expect(joined.find(event=>event.kind==='server-native')).toMatchObject({requestId:call.requestId,dispatchId:dispatch.dispatchId,outcome:'succeeded',cleanup:'completed'});
        if(dispatch.result==='stream')expect(joined.find(event=>event.kind==='server-stream')).toMatchObject({requestId:call.requestId,dispatchId:dispatch.dispatchId,outcome:'succeeded',cleanup:'completed'});
      }
    }
    expect(snapshot.events.filter(event=>event.kind==='server-stream')).toHaveLength(transport!=='durable-object'?1:0);
    expect(snapshot.events.filter(event=>event.kind==='server-socket')).toHaveLength(transport!=='durable-object'?0:3);
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
    for(const method of ['nativeBody','nativeEmpty','componentNative'])expect(JSON.stringify(recorded.snapshot.events)).not.toContain(method);
    await onRecorded({snapshot,recorded});
    expect(errors).toEqual([]);
  } catch(error) {throw new Error(`${error.stack}\nGenerated Vite output:\n${output}`);}
  finally {
    await browser?.close();
    if(child.exitCode===null){if(launcher)child.kill(launcher.json?'SIGINT':'SIGTERM');else child.send('stop');}
    const kill=setTimeout(()=>child.kill('SIGKILL'),10000);const [exitCode,signal]=await exited;clearTimeout(kill);
    expect({exitCode,signal},output).toEqual({exitCode:0,signal:null});
    if(launcher?.json){
      const events=stdout.trim().split('\n').map(line=>JSON.parse(line));
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ok:true,command:'dev',data:{event:'started',tool:'vite'}});
      expect(events[1]).toMatchObject({ok:true,command:'dev',data:{event:'stopped',reason:'requested'}});
    }
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
        for(const marker of ['X-Cossack-Development-Trace','Record trace','server-stream','server-socket','server-native','cossack:development-trace:native','beginDevelopmentSocketDispatch','cossack-start:'])expect(source.includes(marker),`${file}: ${marker}`).toBe(false);
      }
    }
  };
  if(runtime==='node'||runtime==='deno')await promisify(execFile)(process.execPath,[vite,'build','--ssr','src/index.ts','--outDir','dist/server'],{
    cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:''},timeout:120000,maxBuffer:8*1024*1024,
  });
  await checkProduction(path.join(root,'dist/client/assets'));await checkProduction(path.join(root,runtime==='cloudflare'?'dist/ssr':'dist/server'));
  } finally {
    if(tlsDirectory)await fs.rm(tlsDirectory,{recursive:true,force:true});
    for(const [file,content] of backups){
      if(content===null)await fs.rm(path.join(root,file),{force:true});
      else await fs.writeFile(path.join(root,file),content);
    }
  }
}
