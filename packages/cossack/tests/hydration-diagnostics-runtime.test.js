import { it, expect } from 'vitest';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { parseSync } from 'vite';
import { createApp } from '@cossackframework/scaffold';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { writeHydrationDiagnosticsAcceptance, checkHydrationDiagnosticsAcceptance, checkHydrationProductionArtifacts } from './fixtures/hydration-diagnostics-acceptance.js';

const repository=fileURLToPath(new URL('../../../',import.meta.url));

it('writes parseable TypeScript hydration acceptance fixtures',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-hydration-source-'));
  try {
    await writeHydrationDiagnosticsAcceptance(root);
    const visit=async directory=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else if(entry.name.endsWith('.ts'))expect(parseSync(file,await fs.readFile(file,'utf8'),{lang:'ts'}).errors,file).toEqual([]);}};
    await visit(path.join(root,'src'));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

async function project() {
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-hydration-native-'));
  let root;
  const installedRoot=process.env.COSSACK_HYDRATION_INSTALLED_ROOT;
  if(installedRoot) {
    ({projectDir:root}=await createApp('app',{cwd:parent,adapter:'node',preset:'minimal',features:[],interactive:false}));
    const gate=JSON.parse(await fs.readFile(path.join(installedRoot,'package.json'),'utf8'));
    const overrides=Object.fromEntries(Object.entries({...gate.dependencies,...gate.devDependencies}).filter(([name,value])=>(name.startsWith('@cossackframework/')||name==='cossack')&&value.startsWith('file:')));
    const manifestFile=path.join(root,'package.json');const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
    manifest.pnpm={...manifest.pnpm,overrides};await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
    await fs.writeFile(path.join(root,'pnpm-workspace.yaml'),'overrides:\n'+Object.entries(overrides).map(([name,value])=>`  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n')+'\n');
    await promisify(execFile)('pnpm',['install','--ignore-scripts', '--config.strict-dep-builds=false'],{cwd:root,timeout:120000,maxBuffer:8*1024*1024});
    for(const name of ['core','renderer','framework'])expect((await fs.realpath(path.join(root,'node_modules/@cossackframework',name))).startsWith(root+path.sep)).toBe(true);
  }else root=await scaffoldLinkedApp(parent,{adapter:'node',features:[],packages:['framework','core','renderer','node-adapter','auth','database','ui']});
  await writeHydrationDiagnosticsAcceptance(root);
  return {root,parent};
}

async function serve(root,production) {
  const source=production?`
    import {serve} from '@hono/node-server';const {app,env,runtime}=await import('./dist/server/index.js');
    const server=await new Promise(resolve=>{const server=serve({fetch:request=>app.fetch(request,env),port:0,hostname:'127.0.0.1'},()=>resolve(server));});
    env.APP_URL='http://127.0.0.1:'+server.address().port;runtime.attach(server,request=>app.fetch(request,env));
    console.log('HYDRATION_ORIGIN='+env.APP_URL);process.once('message',async()=>{await runtime.dispose();server.close(()=>process.exit(0));});
  `:`
    import {createServer} from 'vite';const server=await createServer({root:${JSON.stringify(root)},logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:${JSON.stringify([root,repository])}}}});
    await server.listen();console.log('HYDRATION_ORIGIN=http://127.0.0.1:'+server.httpServer.address().port);
    process.once('message',async()=>{await server.close();process.exit(0);});
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:root,env:{...process.env,NODE_ENV:production?'production':'development',VITEST:'',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});const exited=once(child,'exit');
  const close=async()=>{if(child.exitCode===null)child.send('stop');const kill=setTimeout(()=>child.kill('SIGKILL'),10000);try{await exited;}finally{clearTimeout(kill);}};
  try {
    await expect.poll(()=>{if(child.exitCode!==null)throw new Error(output);return /HYDRATION_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];},{timeout:30000}).toBeTruthy();
    return {origin:/HYDRATION_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1],close};
  } catch(error){await close();throw error;}
}

it.each([false,true])('proves generated Node hydration diagnostics and lifecycle (production: %s)',async production=>{
  const {root,parent}=await project();let runtime,browser;
  try {
    if(production){for(const args of [[],['--ssr','src/index.ts','--outDir','dist/server']])await promisify(execFile)(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build',...args],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:''},timeout:120000,maxBuffer:4*1024*1024});await checkHydrationProductionArtifacts(root);}
    runtime=await serve(root,production);browser=await chromium.launch({headless:true});
    await checkHydrationDiagnosticsAcceptance(browser,runtime.origin,{production});
  } finally {await browser?.close();await runtime?.close();await fs.rm(parent,{recursive:true,force:true});}
},180000);
