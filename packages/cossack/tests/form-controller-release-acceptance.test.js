import { it, expect } from 'vitest';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { parseSync } from 'vite';
import { createApp } from '@cossackframework/scaffold';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { createTestHarness } from 'wrangler';
import { writeFormControllerAcceptance, checkFormControllerAcceptance } from './fixtures/form-controller-acceptance.js';

const execute=promisify(execFile);
async function project(adapter) {
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-form-controller-'));
  let root;
  const installedRoot=process.env.COSSACK_FORM_INSTALLED_ROOT;
  if(installedRoot) {
    ({projectDir:root}=await createApp('app',{cwd:parent,adapter,preset:'minimal',features:[],interactive:false}));
    const gate=JSON.parse(await fs.readFile(path.join(installedRoot,'package.json'),'utf8'));
    const overrides=Object.fromEntries(Object.entries({...gate.dependencies,...gate.devDependencies}).filter(([name,value])=>(name.startsWith('@cossackframework/')||name==='cossack')&&typeof value==='string'&&value.startsWith('file:')));
    const manifestFile=path.join(root,'package.json');const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));manifest.pnpm={...manifest.pnpm,overrides};await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
    await fs.writeFile(path.join(root,'pnpm-workspace.yaml'),'overrides:\n'+Object.entries(overrides).map(([name,value])=>`  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n')+'\n');
    await execute('pnpm',['install','--ignore-scripts','--config.strict-dep-builds=false'],{cwd:root,timeout:120000,maxBuffer:8*1024*1024});
    for(const name of ['core','renderer','framework'])expect((await fs.realpath(path.join(root,'node_modules/@cossackframework',name))).startsWith(root+path.sep)).toBe(true);
  }else root=await scaffoldLinkedApp(parent,{adapter,features:[],packages:['framework','core','renderer','node-adapter','auth','database','ui']});
  await writeFormControllerAcceptance(root);return {root,parent};
}
function tool(root,name,file){const require=createRequire(path.join(root,'package.json'));return path.join(path.dirname(require.resolve(name+'/package.json')),file);}

async function serveNode(root) {
  const child=spawn(process.execPath,['--input-type=module','-e',`import {serve} from '@hono/node-server';const {app,env,runtime}=await import('./dist/server/index.js');
    const server=await new Promise(resolve=>{const listener=serve({fetch:request=>app.fetch(request,env),hostname:'127.0.0.1',port:0},()=>resolve(listener));});
    env.APP_URL='http://127.0.0.1:'+server.address().port;runtime.attach(server,request=>app.fetch(request,env));console.log('FORM_ORIGIN='+env.APP_URL);
    process.once('message',async()=>{await runtime.dispose();server.close(()=>process.exit(0));});`],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:''},stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stdout.on('data',value=>{output+=value;});child.stderr.on('data',value=>{output+=value;});const exited=once(child,'exit');
  const close=async()=>{if(child.exitCode===null)child.send('stop');const kill=setTimeout(()=>child.kill('SIGKILL'),10000);try{await exited;}finally{clearTimeout(kill);}};
  try {await expect.poll(()=>{if(child.exitCode!==null)throw new Error(output);return /FORM_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];},{timeout:30000}).toBeTruthy();return {origin:/FORM_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1],close};}catch(error){await close();throw error;}
}

it('writes parseable form-controller fixture TypeScript',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-form-source-'));
  try{await writeFormControllerAcceptance(root);const visit=async directory=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else if(entry.name.endsWith('.ts'))expect(parseSync(file,await fs.readFile(file,'utf8'),{lang:'ts'}).errors,file).toEqual([]);}};await visit(root);}
  finally{await fs.rm(root,{recursive:true,force:true});}
});

it.each(['node','cloudflare'])('proves native accessible form lifecycle and file multipart RPC on %s',async adapter=>{
  const {root,parent}=await project(adapter);let browser,runtime;
  try {
    await execute(process.execPath,[tool(root,'typescript','bin/tsc'),'--ignoreConfig','--noEmit','--strict','--skipLibCheck','--module','ESNext','--moduleResolution','Bundler','--target','ESNext','form-controller-types.ts'],{cwd:root,timeout:30000,maxBuffer:1024*1024});
    await execute(process.execPath,[tool(root,'vite','bin/vite.js'),'build'],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:'',WRANGLER_SEND_METRICS:'false'},timeout:120000,maxBuffer:4*1024*1024});
    if(adapter==='node')await execute(process.execPath,[tool(root,'vite','bin/vite.js'),'build','--ssr','src/index.ts','--outDir','dist/server'],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:''},timeout:120000,maxBuffer:4*1024*1024});
    browser=await chromium.launch({headless:true});
    if(adapter==='node'){runtime=await serveNode(root);await checkFormControllerAcceptance(browser,runtime.origin);}
    else{runtime=createTestHarness({root,workers:[{configPath:path.join(root,'dist/ssr/wrangler.json')}]});const {url}=await runtime.listen();await checkFormControllerAcceptance(browser,new URL(url).origin);}
  }finally{await browser?.close();await runtime?.close();await fs.rm(parent,{recursive:true,force:true});}
},240000);
