import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {afterEach,expect,it} from 'vitest';
import {authorHostedStagingScenarioApp} from './fixtures/hosted-staging-scenario-app.js';
const execute=promisify(execFile);
const cleanup=[];
afterEach(async()=>{for(const action of cleanup.splice(0).reverse())await action();});
async function app(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hosted-staging-author-'));
 cleanup.push(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'src'));
 await fs.writeFile(path.join(root,'src/index.ts'),"export const Preserved = true;\nexport default {fetch:()=>new Response('original')};\n");
 await authorHostedStagingScenarioApp(root);return root;
}
it('authors actual decorator, public ORM operations and worker asset while preserving entry exports',async()=>{
 const root=await app();
 expect(await fs.readFile(path.join(root,'src/index.ts'),'utf8')).toContain('export const Preserved = true');
 expect(await fs.readFile(path.join(root,'src/pages/acceptance/index.ts'),'utf8')).toContain('@Server({authorize:');
 expect(await fs.readFile(path.join(root,'orm.config.ts'),'utf8')).toContain("createD1ToolingAdapter(context,{binding:'DB'})");
 expect(await fs.readFile(path.join(root,'public/acceptance/private.txt'),'utf8')).toContain('HOSTED_PROTECTED_ASSET_SENTINEL');
});
it('fails the migration gate before apply when public plan names a different remote target',async()=>{
 const root=await app(),bin=path.join(root,'bin');await fs.mkdir(bin);
 await fs.writeFile(path.join(bin,'pnpm'),`#!/usr/bin/env node
import('node:fs').then(fs=>{fs.appendFileSync('commands.jsonl',JSON.stringify(process.argv.slice(2))+'\\n');console.log(JSON.stringify({ok:true,data:{complete:true,migrations:[{complete:true,target:{provider:'d1',target:'remote',environment:'staging',binding:'DB',accountId:'account',databaseId:'wrong'}}]}}));});`,{mode:0o700});
 await expect(execute(process.execPath,['scripts/acceptance-ci.mjs','migrate'],{cwd:root,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,COSSACK_ACCEPTANCE_ACCOUNT_ID:'account',COSSACK_ACCEPTANCE_STAGING_DATABASE_ID:'expected'}})).rejects.toMatchObject({code:1});
 const commands=(await fs.readFile(path.join(root,'commands.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 expect(commands).toEqual([['exec','cossack','migration','plan','--remote','--env','staging','--json']]);
 await expect(fs.access(path.join(root,'.cossack/scenario-migration.json'))).rejects.toThrow();
});
it('network smoke rejects forged anonymous authority and records a single authorized effect without secrets',async()=>{
 const root=await app();let effects=0;const key='private-test-cookie';
 const server=http.createServer(async(req,res)=>{
 const authorized=req.headers.cookie==='acceptance_actor='+key;
 if(!authorized){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({code:'COSSACK_AUTH_UNAUTHENTICATED'}));return;}
 if(req.url==='/acceptance/evidence')res.end(JSON.stringify({effects,scope:'staging'}));
 else if(req.url==='/acceptance/private.txt')res.end('HOSTED_PROTECTED_ASSET_SENTINEL\n');
 else if(req.url==='/acceptance')res.end('<script>window.__INITIAL_STATE__ = '+JSON.stringify({componentRouteId:'fixture-route',scopeKey:'fixture-scope'})+';</script>');
 else if(req.url==='/crpc'){
 let body='';for await(const chunk of req)body+=chunk;
 const envelope=JSON.parse(body);expect(envelope.action).toBe('edit');expect(envelope.state.user.id).toBe('acceptance-owner');effects++;res.end(JSON.stringify({_cossack_return:'acceptance-saved'}));
 }else{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port;
 await fs.writeFile(path.join(root,'journal.json'),JSON.stringify({status:'deployed',url}));
 await execute(process.execPath,['scripts/acceptance-ci.mjs','smoke'],{cwd:root,env:{...process.env,COSSACK_ACCEPTANCE_PREVIEW_JOURNAL:'journal.json',COSSACK_PREVIEW_SECRETS_JSON:JSON.stringify({ACCEPTANCE_KEY:key})}});
 const text=await fs.readFile(path.join(root,'.cossack/scenario-smoke.json'),'utf8');expect(text).not.toContain(key);
 expect(JSON.parse(text)).toMatchObject({rpc:{anonymousEffectsAfter:0,effectsAfter:1},protectedAsset:{anonymousStatus:401,authorizedStatus:200}});
});
it.each([true,false])('migration receipt requires persisted checksum correspondence (matches=%s)',async matches=>{
 const root=await app(),bin=path.join(root,'bin');await fs.mkdir(bin);
 await fs.writeFile(path.join(root,'artifact.json'),JSON.stringify({account_id:'account',vars:{MODE:'staging'},d1_databases:[{binding:'DB',database_id:'expected'}]}));
 await fs.writeFile(path.join(bin,'pnpm'),`#!/usr/bin/env node
import('node:fs').then(fs=>{
 const args=process.argv.slice(2);fs.appendFileSync('commands.jsonl',JSON.stringify(args)+'\\n');
 const target={provider:'d1',target:'remote',environment:'staging',binding:'DB',accountId:'account',databaseId:'expected'};
 let data;
 if(args[2]==='migration'&&args[3]==='plan'){
 const applied=fs.existsSync('applied');data={complete:true,migrations:applied?[]:[{target,name:'0001_hosted_acceptance',checksum:'checked-checksum',complete:true,direction:'up',statements:[{text:'CREATE TABLE scenario_effects (id INTEGER PRIMARY KEY, actor TEXT NOT NULL)',parameterCount:0}]}]};
 }else if(args[2]==='migration'&&args[3]==='up'){fs.writeFileSync('applied','yes');data={applied:['0001_hosted_acceptance']};}
 else if(args[2]==='migration'&&args[3]==='status')data={migrations:[{state:'applied',applied:{checksum:${JSON.stringify(matches?'checked-checksum':'different-checksum')}}}]};
 else if(args[2]==='deploy')data={artifact:'artifact.json'};
 else process.exit(2);
 console.log(JSON.stringify({ok:true,data}));
 });`,{mode:0o700});
 const run=execute(process.execPath,['scripts/acceptance-ci.mjs','migrate'],{cwd:root,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,COSSACK_ACCEPTANCE_ACCOUNT_ID:'account',COSSACK_ACCEPTANCE_STAGING_DATABASE_ID:'expected'}});
 if(matches){await run;expect(JSON.parse(await fs.readFile(path.join(root,'.cossack/scenario-migration.json'),'utf8'))).toMatchObject({applied:true,verification:{historyChecksum:'checked-checksum',pendingAfter:0},artifact:{databaseId:'expected'}});}
 else{await expect(run).rejects.toMatchObject({code:1});await expect(fs.access(path.join(root,'.cossack/scenario-migration.json'))).rejects.toThrow();expect(await fs.readFile(path.join(root,'commands.jsonl'),'utf8')).not.toContain('deploy');}
});
