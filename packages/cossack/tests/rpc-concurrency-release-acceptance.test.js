import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createApp } from '@cossackframework/scaffold';
import { createTestHarness } from 'wrangler';
import { writeRpcConcurrencyAcceptance, checkRpcConsumers, checkDurableLifecycle } from './fixtures/rpc-concurrency-acceptance.js';

const repository=fileURLToPath(new URL('../../../',import.meta.url));const execute=promisify(execFile);
async function project(adapter) {
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-session-concurrency-'));
  const {projectDir:root}=await createApp('app',{cwd:parent,adapter,preset:'minimal',features:[],interactive:false});
  const installedRoot=process.env.COSSACK_RPC_CONCURRENCY_INSTALLED_ROOT;
  if(installedRoot) {
    const gate=JSON.parse(await fs.readFile(path.join(installedRoot,'package.json'),'utf8'));
    const overrides=Object.fromEntries(Object.entries({...gate.dependencies,...gate.devDependencies}).filter(([name,value])=>(name.startsWith('@cossackframework/')||name==='cossack')&&typeof value==='string'&&value.startsWith('file:')));
    const manifestFile=path.join(root,'package.json');const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));manifest.pnpm={...manifest.pnpm,overrides};await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
    await fs.writeFile(path.join(root,'pnpm-workspace.yaml'),'overrides:\n'+Object.entries(overrides).map(([name,value])=>`  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n')+'\n');
    await execute('pnpm',['install','--ignore-scripts','--config.strict-dep-builds=false'],{cwd:root,timeout:120000,maxBuffer:8*1024*1024});
    for(const name of ['core','renderer','framework'])expect((await fs.realpath(path.join(root,'node_modules/@cossackframework',name))).startsWith(root+path.sep)).toBe(true);
  }else{
    const modules=path.join(root,'node_modules');await fs.mkdir(modules);
    for(const name of await fs.readdir(path.join(repository,'node_modules'))){if(name.startsWith('.')||name==='@cossackframework')continue;await fs.symlink(path.join(repository,'node_modules',name),path.join(modules,name),'junction');}
    await fs.mkdir(path.join(modules,'@cossackframework'));
    for(const name of ['framework','core','renderer','node-adapter','auth','database','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(modules,'@cossackframework',name),'junction');
  }
  await writeRpcConcurrencyAcceptance(root,adapter);return {root,parent};
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

it.each(['node','cloudflare'])('proves native duplicate consumers and lifecycle ownership on %s',async adapter=>{
 const {root,parent}=await project(adapter);let runtime;
 try{
 await execute(process.execPath,[tool(root,'vite','bin/vite.js'),'build'],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:'',WRANGLER_SEND_METRICS:'false'},timeout:120000,maxBuffer:4*1024*1024});
 if(adapter==='node'){
 await execute(process.execPath,[tool(root,'vite','bin/vite.js'),'build','--ssr','src/index.ts','--outDir','dist/server'],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:''},timeout:120000,maxBuffer:4*1024*1024});
 runtime=await serveNode(root);await checkRpcConsumers(runtime.origin);
 }else{
 runtime=createTestHarness({root,workers:[{configPath:path.join(root,'dist/ssr/wrangler.json')}]});const {url}=await runtime.listen();await checkRpcConsumers(new URL(url).origin);await checkDurableLifecycle(runtime,new URL(url).origin);
 }
 }finally{await runtime?.close();await fs.rm(parent,{recursive:true,force:true});}
},240000);
