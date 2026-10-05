import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {createApp} from '@cossackframework/scaffold';
const repository=path.resolve(import.meta.dirname,'../../..');
const execute=promisify(execFile);

it('generated production Deno entry drains accepted requests and bounds uncooperative work on real signals',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-deno-drain-'));
 const gate=process.env.COSSACK_DENO_SHUTDOWN_INSTALLED_ROOT;
 let child;
 try {
  let root;
  if(gate){
   root=path.join(parent,'app');
   await execute(process.execPath,[path.join(gate,'node_modules/cossack/bin/cossack.js'),'create','app','--adapter','deno','--preset','minimal','--yes','--json'],{cwd:parent,timeout:30000,env:{...process.env,COSSACK_DISABLE_UPDATE_CHECK:'1'}});
   await fs.symlink(path.join(gate,'node_modules'),path.join(root,'node_modules'),'junction');
  }else{
   ({projectDir:root}=await createApp('app',{cwd:parent,adapter:'deno',preset:'minimal',interactive:false}));
   await fs.mkdir(path.join(root,'node_modules'));
   for(const name of await fs.readdir(path.join(repository,'node_modules'))){if(name.startsWith('.')||name==='@cossackframework')continue;await fs.symlink(path.join(repository,'node_modules',name),path.join(root,'node_modules',name),'junction');}
   await fs.mkdir(path.join(root,'node_modules/@cossackframework'));
   for(const name of ['core','renderer','framework','deno-adapter'])await fs.symlink(path.join(repository,'packages',name),path.join(root,'node_modules/@cossackframework',name),'junction');
  }
  const entry=await fs.readFile(path.join(root,'src/index.ts'),'utf8');expect(entry).toContain('installDenoShutdown(server');
  await fs.mkdir(path.join(root,'src/pages/api'),{recursive:true});
  await fs.writeFile(path.join(root,'src/pages/api/drain.ts'),`
const marker=Deno.env.get('DRAIN_MARKER')!;
const existsSync=(file:string)=>{try{Deno.statSync(file);return true;}catch{return false;}};
const join=(root:string,name:string)=>root+'/'+name;
const writeFileSync=(file:string,value:string)=>Deno.writeTextFileSync(file,value);
for(const signal of ['SIGTERM','SIGINT'] as const)Deno.addSignalListener(signal,()=>writeFileSync(join(marker,'signal'),'accepted'));
export const GET=async(c:any)=>{
 writeFileSync(join(marker,'entered'),'accepted');
 if(c.req.query('mode')==='stuck')await new Promise(()=>{});
 else while(!existsSync(join(marker,'release')))await new Promise(resolve=>setTimeout(resolve,10));
 return c.text('accepted-request-completed');
};`);
  const require=createRequire(path.join(root,'package.json'));
  const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
  await fs.writeFile(path.join(root,'shutdown-types.ts'),`import {createDenoAdapter,installDenoShutdown,type DenoShutdownResult} from '@cossackframework/deno-adapter';
const server=createDenoAdapter().serve({fetch:()=>new Response()});
const control=installDenoShutdown(server,{onComplete(result){const forced:boolean=result.forced;void forced;}});
const result:DenoShutdownResult=await control.shutdown();
// @ts-expect-error status is not part of the shutdown result
result.status;
// @ts-expect-error forceShutdown is required to bound outstanding HTTP work
installDenoShutdown({shutdown:async()=>{}});
// @ts-expect-error timeout is numeric
installDenoShutdown(server,{timeoutMs:'10'});
// @ts-expect-error runtime instance limit is numeric
createDenoAdapter({maxInstances:'wrong'});
`);
  const compiler=path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc');
  await execute(process.execPath,[compiler,'--ignoreConfig','--noEmit','--skipLibCheck','--strict','--types','node','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','shutdown-types.ts'],{cwd:root,timeout:30000,maxBuffer:4*1024*1024});
  await execute(process.execPath,[vite,'build','--ssr','src/index.ts','--outDir','dist/server'],{cwd:root,timeout:120000,maxBuffer:4*1024*1024,env:{...process.env,NODE_ENV:'production',VITEST:''}});
  for(const mode of ['finite','stuck']){
   const marker=path.join(parent,mode);await fs.mkdir(marker);
   const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
   child=spawn(process.env.COSSACK_DENO_BINARY || 'deno',['run','--allow-env','--allow-net','--allow-read','--allow-write','dist/server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),DRAIN_MARKER:marker},stdio:['ignore','pipe','pipe']});
   let diagnostics='';child.stdout.on('data',data=>diagnostics+=data);child.stderr.on('data',data=>diagnostics+=data);
   const ended=once(child,'exit');
   const origin=`http://127.0.0.1:${port}`;
   await expect.poll(async()=>{if(child.exitCode!==null)throw Error(diagnostics);try{return(await fetch(origin)).status;}catch{return 0;}},{timeout:15000}).toBe(200);
   const response=fetch(origin+'/api/drain?mode='+mode).then(async r=>({body:await r.text()}),()=>({disconnected:true}));
   await expect.poll(()=>fs.access(path.join(marker,'entered')).then(()=>true,()=>false),{timeout:5000}).toBe(true);
   const start=performance.now();child.kill(mode==='finite'?'SIGTERM':'SIGINT');
   await expect.poll(()=>fs.access(path.join(marker,'signal')).then(()=>true,()=>false),{timeout:5000}).toBe(true);
   await expect(fetch(origin)).rejects.toThrow();
   child.kill('SIGTERM'); // repeated signals must not replace the owned drain.
   if(mode==='finite')await fs.writeFile(path.join(marker,'release'),'release');
   const [code,signal]=await ended;expect(signal).toBe(null);expect(code,diagnostics).toBe(mode==='finite'?0:1);
   if(mode==='finite')expect(await response).toEqual({body:'accepted-request-completed'});
   else{expect(await response).toEqual({disconnected:true});expect(performance.now()-start).toBeLessThan(15000);}
   child=undefined;
  }
 }finally{if(child&&child.exitCode===null){child.kill('SIGKILL');await once(child,'exit');}await fs.rm(parent,{recursive:true,force:true});}
},180000);
