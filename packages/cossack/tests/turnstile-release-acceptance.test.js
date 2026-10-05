import { it, expect } from 'vitest';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { parseSync } from 'vite';
import { createApp } from '@cossackframework/scaffold';
import { createTestHarness } from 'wrangler';
import { writeTurnstileAcceptance, checkTurnstileAcceptance, TURNSTILE_ENV, TURNSTILE_SECRET_SENTINEL, TURNSTILE_PROVIDER_SENTINEL } from './fixtures/turnstile-acceptance.js';
const repository=fileURLToPath(new URL('../../../',import.meta.url));const execute=promisify(execFile);
async function project(adapter) {
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-turnstile-'));
  try {
    const {projectDir:root}=await createApp('app',{cwd:parent,adapter,preset:'minimal',features:['turnstile'],interactive:false});
    const installedRoot=process.env.COSSACK_TURNSTILE_INSTALLED_ROOT;
    if(installedRoot){
      const gate=JSON.parse(await fs.readFile(path.join(installedRoot,'package.json'),'utf8'));
      const overrides=Object.fromEntries(Object.entries({...gate.dependencies,...gate.devDependencies}).filter(([name,value])=>(name.startsWith('@cossackframework/')||name==='cossack')&&typeof value==='string'&&value.startsWith('file:')));
      const manifestFile=path.join(root,'package.json');const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));manifest.pnpm={...manifest.pnpm,overrides};await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
      await fs.writeFile(path.join(root,'pnpm-workspace.yaml'),'overrides:\n'+Object.entries(overrides).map(([name,value])=>`  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n')+'\n');
      await execute('pnpm',['install','--ignore-scripts','--config.strict-dep-builds=false'],{cwd:root,timeout:120000,maxBuffer:8*1024*1024});
      for(const name of ['core','renderer','framework','auth','ui'])expect((await fs.realpath(path.join(root,'node_modules/@cossackframework',name))).startsWith(root+path.sep)).toBe(true);
    }else{
      const modules=path.join(root,'node_modules');await fs.mkdir(modules);
      for(const name of await fs.readdir(path.join(repository,'node_modules'))){if(name.startsWith('.')||name==='@cossackframework')continue;await fs.symlink(path.join(repository,'node_modules',name),path.join(modules,name),'junction');}
      await fs.mkdir(path.join(modules,'@cossackframework'));
      for(const name of ['framework','core','renderer','node-adapter','auth','database','ui'])await fs.symlink(path.join(repository,'packages',name),path.join(modules,'@cossackframework',name),'junction');
    }
    await writeTurnstileAcceptance(root);return{root,parent};
  }catch(error){await fs.rm(parent,{recursive:true,force:true});throw error;}
}
function tool(root,name,file){const require=createRequire(path.join(root,'package.json'));return path.join(path.dirname(require.resolve(name+'/package.json')),file);}
async function serveNode(root){
  const child=spawn(process.execPath,['--input-type=module','-e',`import{serve}from'@hono/node-server';const{app,env,runtime}=await import('./dist/server/index.js');Object.assign(env,${JSON.stringify(TURNSTILE_ENV)});const server=await new Promise(resolve=>{const listener=serve({fetch:request=>app.fetch(request,env),hostname:'127.0.0.1',port:0},()=>resolve(listener));});env.APP_URL='http://127.0.0.1:'+server.address().port;runtime.attach(server,request=>app.fetch(request,env));console.log('TURNSTILE_ORIGIN='+env.APP_URL);process.once('message',async()=>{await runtime.dispose();server.close(()=>process.exit(0));});`],{cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:''},stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stdout.on('data',value=>{output+=value;});child.stderr.on('data',value=>{output+=value;});const exited=once(child,'exit');
  const close=async()=>{if(child.exitCode===null)child.send('stop');const kill=setTimeout(()=>child.kill('SIGKILL'),10000);try{await exited;}finally{clearTimeout(kill);}};
  try{await expect.poll(()=>{if(child.exitCode!==null)throw new Error(output);return /TURNSTILE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];},{timeout:30000}).toBeTruthy();return{origin:/TURNSTILE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1],close};}catch(error){await close();throw error;}
}
async function scanClient(root,adapter){
  const directory=path.join(root,adapter==='cloudflare'?'dist/client':'dist');let scanned=0;
  const visit=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.name==='server'||entry.name==='ssr')continue;const file=path.join(dir,entry.name);if(entry.isDirectory())await visit(file);else if(/\.(js|map|html)$/.test(entry.name)){scanned++;const source=await fs.readFile(file,'utf8');expect(source,file).not.toContain(TURNSTILE_SECRET_SENTINEL);expect(source,file).not.toContain(TURNSTILE_PROVIDER_SENTINEL);expect(source,file).not.toContain('/turnstile/v0/siteverify');expect(source,file).not.toContain('turnstile.secret');}}};
  await visit(directory);expect(scanned).toBeGreaterThan(0);
}
it('writes parseable Turnstile acceptance TypeScript',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-turnstile-source-'));
  try{await writeTurnstileAcceptance(root);const visit=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await visit(file);else if(entry.name.endsWith('.ts'))expect(parseSync(file,await fs.readFile(file,'utf8'),{lang:'ts'}).errors,file).toEqual([]);}};await visit(root);}finally{await fs.rm(root,{recursive:true,force:true});}
});
it.each(['node','cloudflare'])('proves generated Turnstile widget lifetime and authoritative protected mutation on %s',async adapter=>{
  const{root,parent}=await project(adapter);let browser,runtime;
  try{
    await execute(process.execPath,[tool(root,'typescript','bin/tsc'),'--ignoreConfig','--noEmit','--strict','--skipLibCheck','--module','ESNext','--moduleResolution','Bundler','--target','ESNext','turnstile-types.ts'],{cwd:root,timeout:30000,maxBuffer:1024*1024});
    const options={cwd:root,env:{...process.env,NODE_ENV:'production',VITEST:'',CLOUDFLARE_ENV:'',WRANGLER_SEND_METRICS:'false'},timeout:120000,maxBuffer:8*1024*1024};
    await execute(process.execPath,[tool(root,'vite','bin/vite.js'),'build','--sourcemap'],options);
    if(adapter==='node')await execute(process.execPath,[tool(root,'vite','bin/vite.js'),'build','--ssr','src/index.ts','--outDir','dist/server'],options);
    await scanClient(root,adapter);browser=await chromium.launch({headless:true});
    if(adapter==='node'){runtime=await serveNode(root);await checkTurnstileAcceptance(browser,runtime.origin);}
    else{const configPath=path.join(root,'dist/ssr/wrangler.json');const config=JSON.parse(await fs.readFile(configPath,'utf8'));config.vars={...config.vars,TURNSTILE_SITE_KEY:TURNSTILE_ENV.TURNSTILE_SITE_KEY,TURNSTILE_HOSTNAME:TURNSTILE_ENV.TURNSTILE_HOSTNAME};await fs.writeFile(configPath,JSON.stringify(config));await fs.writeFile(path.join(path.dirname(configPath),'.dev.vars'),'TURNSTILE_SECRET_KEY='+TURNSTILE_ENV.TURNSTILE_SECRET_KEY+'\n');runtime=createTestHarness({root,workers:[{configPath}]});const{url}=await runtime.listen();await checkTurnstileAcceptance(browser,new URL(url).origin);}
  }finally{await browser?.close();await runtime?.close();await fs.rm(parent,{recursive:true,force:true});}
},240000);
