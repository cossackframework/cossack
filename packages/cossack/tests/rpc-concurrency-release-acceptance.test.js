import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createApp } from '@cossackframework/scaffold';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { createTestHarness } from 'wrangler';
import { parseSync } from 'vite';
import { writeRpcConcurrencyAcceptance, checkRpcConsumers, checkDurableLifecycle } from './fixtures/rpc-concurrency-acceptance.js';
import { writeRpcDisconnectAcceptance } from './fixtures/rpc-disconnect-acceptance.js';

const execute=promisify(execFile);
async function project(adapter) {
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-rpc-concurrency-'));
  let root;
  const installedRoot=process.env.COSSACK_RPC_CONCURRENCY_INSTALLED_ROOT;
  if(installedRoot) {
    ({projectDir:root}=await createApp('app',{cwd:parent,adapter,preset:'minimal',features:[],interactive:false}));
    const gate=JSON.parse(await fs.readFile(path.join(installedRoot,'package.json'),'utf8'));
    const overrides=Object.fromEntries(Object.entries({...gate.dependencies,...gate.devDependencies}).filter(([name,value])=>(name.startsWith('@cossackframework/')||name==='cossack')&&typeof value==='string'&&value.startsWith('file:')));
    const manifestFile=path.join(root,'package.json');const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));manifest.pnpm={...manifest.pnpm,overrides};await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
    await fs.writeFile(path.join(root,'pnpm-workspace.yaml'),'overrides:\n'+Object.entries(overrides).map(([name,value])=>`  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n')+'\n');
    await execute('pnpm',['install','--ignore-scripts','--config.strict-dep-builds=false'],{cwd:root,timeout:120000,maxBuffer:8*1024*1024});
    for(const name of ['core','renderer','framework'])expect((await fs.realpath(path.join(root,'node_modules/@cossackframework',name))).startsWith(root+path.sep)).toBe(true);
  }else root=await scaffoldLinkedApp(parent,{adapter,features:[],packages:['framework','core','renderer','node-adapter','auth','database','ui']});
  await writeRpcConcurrencyAcceptance(root,adapter);await writeRpcDisconnectAcceptance(root);return {root,parent};
}
function tool(root,name,file){const require=createRequire(path.join(root,'package.json'));return path.join(path.dirname(require.resolve(name+'/package.json')),file);}

async function serveNode(root) {
  const child=spawn(process.execPath,['--input-type=module','-e',`import {serve} from '@hono/node-server';const {app,env,runtime}=await import('./dist/server/index.js');
    const server=await new Promise(resolve=>{const listener=serve({fetch:request=>app.fetch(request,env),hostname:'127.0.0.1',port:0},()=>resolve(listener));});
    env.APP_URL='http://127.0.0.1:'+server.address().port;runtime.attach(server,request=>app.fetch(request,env));console.log('SESSION_ORIGIN='+env.APP_URL);
    process.once('message',async()=>{await runtime.dispose();server.close(()=>process.exit(0));});`],{cwd:root,env:{...process.env,APP_SECRET:'fixture-application-secret-0123456789',NODE_ENV:'production',VITEST:''},stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stdout.on('data',value=>{output+=value;});child.stderr.on('data',value=>{output+=value;});const exited=once(child,'exit');
  const close=async()=>{if(child.exitCode===null)child.send('stop');const kill=setTimeout(()=>child.kill('SIGKILL'),10000);try{await exited;}finally{clearTimeout(kill);}};
  try {await expect.poll(()=>{if(child.exitCode!==null)throw new Error(output);return /SESSION_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];},{timeout:30000}).toBeTruthy();return {origin:/SESSION_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1],close};}catch(error){await close();throw error;}
}

async function serveDirectWorker(root){
const require=createRequire(import.meta.url);const module=await import(pathToFileURL(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]})).href);const directory=path.join(root,'dist/ssr');const config=JSON.parse(await fs.readFile(path.join(directory,'wrangler.json'),'utf8'));
const durableObjects=Object.fromEntries((config.durable_objects?.bindings??[]).map(binding=>[binding.name,{className:binding.class_name,useSQLite:(config.migrations??[]).some(migration=>migration.new_sqlite_classes?.includes(binding.class_name))}]));
const main=path.resolve(directory,config.main);const modules=[{type:'ESModule',path:main}];const collect=async folder=>{for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await collect(file);else if(file!==main&&entry.name.endsWith('.js'))modules.push({type:'ESModule',path:file});}};await collect(directory);
// The direct socket targets the generated application service itself. Miniflare's
// service-entry/Wrangler proxy lacks incoming-signal passthrough before headers.
// Static assets are not requested by this RPC test. Registering Miniflare assets
// replaces its default direct socket with another RPC proxy, losing the bypass.
const worker=new module.Miniflare({name:config.name,modules,modulesRoot:directory,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:config.vars,durableObjects,unsafeDirectSockets:[{host:'127.0.0.1',port:0}]});
try{const url=await worker.unsafeGetDirectURL(config.name);return{origin:url.origin,close:()=>worker.dispose()};}catch(error){await worker.dispose();throw error;}}
function hydration(html){const match=/<script\b[^>]*>\s*window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/i.exec(html);expect(match,'hydration JSON').toBeTruthy();return JSON.parse(match[1].trim().replace(/;$/,''));}
async function preHeaderSocket(origin,body,key){const url=new URL(origin);const socket=net.connect({host:url.hostname,port:Number(url.port)});let bytes=0;socket.on('data',data=>bytes+=data.length);socket.on('error',()=>{});await once(socket,'connect');const json=JSON.stringify(body);socket.write(`POST /crpc HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: ${url.origin}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\nX-Disconnect-Case: ${key}\r\nConnection: keep-alive\r\n\r\n${json}`);return{socket,get bytes(){return bytes;}};}

it('generates parseable pre-header disconnect fixture without mocked request signals',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-disconnect-source-'));try{await writeRpcDisconnectAcceptance(root);const visit=async directory=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else expect(parseSync(file,await fs.readFile(file,'utf8'),{lang:'ts'}).errors,file).toEqual([]);}};await visit(root);}finally{await fs.rm(root,{recursive:true,force:true});}});

// One generated app per adapter carries both the duplicate-consumer/lifecycle
// and the pre-header disconnect fixtures: one scaffold and one build.
describe.each(['node','cloudflare'])('native RPC concurrency and disconnect on %s',adapter=>{
 let root,parent;
 beforeAll(async()=>{
  ({root,parent}=await project(adapter));
  await execute(process.execPath,[tool(root,'vite','bin/vite.js'),'build'],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:'',WRANGLER_SEND_METRICS:'false'},timeout:120000,maxBuffer:4*1024*1024});
  if(adapter==='node')await execute(process.execPath,[tool(root,'vite','bin/vite.js'),'build','--ssr','src/index.ts','--outDir','dist/server'],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:''},timeout:120000,maxBuffer:4*1024*1024});
 },240000);
 afterAll(async()=>{if(parent)await fs.rm(parent,{recursive:true,force:true});});

 it(`proves native duplicate consumers and lifecycle ownership on ${adapter}`,async()=>{
  let runtime;
  try{
   if(adapter==='node'){runtime=await serveNode(root);await checkRpcConsumers(runtime.origin);}
   else{runtime=createTestHarness({root,workers:[{configPath:path.join(root,'dist/ssr/wrangler.json')}]});const {url}=await runtime.listen();await checkRpcConsumers(new URL(url).origin);await checkDurableLifecycle(runtime,new URL(url).origin);}
  }finally{await runtime?.close();}
 },240000);

 it(`delivers native incoming TCP reset before RPC headers and disposes calls on ${adapter}`,async()=>{let runtime;const sockets=[];const failures=[];
try{runtime=adapter==='node'?await serveNode(root):await serveDirectWorker(root);
const audit=async key=>{const response=await fetch(runtime.origin+'/api/disconnect-audit?key='+encodeURIComponent(key));expect(response.status).toBe(200);return response.json();};
for(const transport of ['http','sse']){const response=await fetch(runtime.origin+'/disconnect/'+transport);expect(response.status).toBe(200);const state=hydration(await response.text());
for(const service of [false,true]){const key=`${adapter}-${transport}-${service?'service':'page'}`;const envelope={componentRouteId:state.componentRouteId,scopeKey:state.scopeKey,action:'hold',payload:[key,'hold'],...(service?{service:{ownerRouteId:state._layout_stack.at(-1).componentRouteId,slot:'0'},pageParams:state.metadata.params}:{})};const call=await preHeaderSocket(runtime.origin,envelope,key);sockets.push(call.socket);
try{await expect.poll(async()=>(await audit(key))?.starts,{timeout:3000}).toBe(1);expect(call.bytes,'no RPC status/header byte may arrive before disconnect').toBe(0);call.socket.resetAndDestroy();
await expect.poll(async()=>{const entry=await audit(key);return{native:entry?.nativeAborts,action:entry?.actionAborts,settled:entry?.settled,service:entry?.serviceDisposed,middleware:entry?.middlewareDisposed};},{timeout:4500}).toEqual({native:1,action:1,settled:1,service:1,middleware:1});
const entry=await audit(key);expect(entry).toMatchObject({starts:1,mutations:0,timeouts:0,pageDisposed:service?0:1});expect(entry.cleanupContext.every(item=>item.key===key&&item.path==='/crpc')).toBe(true);
}catch(error){call.socket.destroy();failures.push({case:key,error:String(error),audit:await audit(key)});}
// Independent normal request proves recovery and single execution after each disconnect.
const recovery=key+'-recovery';const saved=await fetch(runtime.origin+'/crpc',{method:'POST',headers:{'content-type':'application/json','Origin':runtime.origin,'X-Disconnect-Case':recovery},body:JSON.stringify({...envelope,payload:[recovery,'fast']})});expect(saved.status).toBe(200);await saved.text();await expect.poll(async()=>(await audit(recovery))?.middlewareDisposed,{timeout:3000}).toBe(1);expect(await audit(recovery)).toMatchObject({starts:1,mutations:1,settled:1,timeouts:0,serviceDisposed:1});}}
expect(failures,'native pre-header signal/cleanup acceptance failures with bounded audit evidence').toEqual([]);
}finally{sockets.forEach(socket=>socket.destroy());await runtime?.close();}},240000);
});
