import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readPreviewSecrets } from '../src/preview-secrets.js';
const execute=promisify(execFile);
it('actual native Wrangler scopes secret_text to one preview deployment without changing Worker defaults',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-native-preview-secret-'));
 const account='a'.repeat(32); const seen=[]; let metadata;
 const server=createServer(async(req,res)=>{
  const body=[]; for await(const chunk of req)body.push(chunk);
  const url=new URL(req.url,'http://localhost'); seen.push({method:req.method,path:url.pathname,query:url.search});
  let result;
  if(req.method==='GET'&&url.pathname.endsWith('/previews/secret-case')) { res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({success:false,errors:[{code:10025,message:'Preview absent'}]}));return; }
  if(req.method==='POST'&&url.pathname.endsWith('/previews'))result={id:'preview-id',name:'secret-case',created_on:'2026-10-06T00:00:00Z',urls:['https://secret-case-worker.fixture.workers.dev']};
  else if(req.method==='POST'&&url.pathname.endsWith('/previews/preview-id/deployments')) { metadata=JSON.parse(Buffer.concat(body).toString('utf8')); result={id:'deploy-id',preview_id:'preview-id',preview_name:'secret-case',annotations:{'workers/tag':'cossack:fixture'},urls:['https://secret-case-worker.fixture.workers.dev']}; }
  else {res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({success:false,errors:[{code:999,message:'Unexpected test request'}]}));return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success:true,result}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const file=path.join(root,'secret.json');await fs.writeFile(file,JSON.stringify({APP_SECRET:'dummy-preview-secret-only'}),{mode:0o600});
  const bindings=await readPreviewSecrets(root,file,['APP_SECRET']);
  await fs.writeFile(path.join(root,'worker.js'),'export default {fetch(){return new Response("ok")}};');
  await fs.writeFile(path.join(root,'wrangler.json'),JSON.stringify({name:'worker',main:'worker.js',account_id:account,compatibility_date:'2026-06-06',vars:{MODE:'production'},unsafe:{bindings:[{name:'PRODUCTION_KEY',type:'secret_text',text:'dummy-production-do-not-send'}]},previews:{vars:{MODE:'staging'},unsafe:{bindings}}}));
  const require=createRequire(import.meta.url);const binary=path.join(path.dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
  const operation=execute(process.execPath,[binary,'preview','--name','secret-case','--worker-name','worker','--tag','cossack:fixture','--ignore-defaults','--json','--config',path.join(root,'wrangler.json')],{cwd:root,detached:process.platform!=='win32',timeout:25000,maxBuffer:1024*1024,env:{...process.env,CLOUDFLARE_API_TOKEN:'dummy-test-api-token',CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_BASE_URL:`http://127.0.0.1:${server.address().port}/client/v4`,CLOUDFLARE_ENV:'',WRANGLER_HIDE_BANNER:'true',WRANGLER_LOG_SANITIZE:'true',FORCE_COLOR:'0',WRANGLER_LOG_PATH:path.join(root,'private-wrangler.log'),WRANGLER_SEND_METRICS:'false',WRANGLER_SEND_ERROR_REPORTS:'false',CLOUDFLARE_CF_FETCH_ENABLED:'false',CI:'true'}});
  const deadline=setTimeout(()=>{try{if(operation.child?.pid&&process.platform!=='win32')process.kill(-operation.child.pid,'SIGKILL');else operation.child?.kill('SIGKILL');}catch{}},24000);deadline.unref();
  let result;try{result=await operation;}finally{clearTimeout(deadline);}
  expect(metadata.env.APP_SECRET).toEqual({type:'secret_text',text:'dummy-preview-secret-only'});
  expect(metadata.env.MODE).toEqual({type:'plain_text',text:'staging'});
  expect(metadata.env.PRODUCTION_KEY).toBeUndefined();
  expect(seen.filter(item=>item.method!=='GET').map(item=>item.path)).toEqual([`/client/v4/accounts/${account}/workers/workers/worker/previews`,`/client/v4/accounts/${account}/workers/workers/worker/previews/preview-id/deployments`]);
  expect(seen.filter(item=>item.method==='POST').every(item=>item.query==='?ignore_defaults=true')).toBe(true);
  expect(result.stdout).not.toContain('dummy-preview-secret-only');
  expect(result.stdout).not.toContain('dummy-production-do-not-send');
  // Wrangler validation warnings may contain values: the production provider must discard stderr.
  expect(result.stderr).toContain('dummy-preview-secret-only');
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
},30000);
