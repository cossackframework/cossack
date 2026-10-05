import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root=await fs.realpath(process.argv[2]);
const require=createRequire(path.join(root,'package.json'));
const resolve=async name=>(await promisify(execFile)(process.execPath,['--input-type=module','-e',`process.stdout.write(import.meta.resolve(${JSON.stringify(name)}))`],{cwd:root})).stdout;
const target=await resolve('@cossackframework/test-utils/server');
assert.ok((await fs.realpath(new URL(target))).startsWith(root+path.sep),'Use installed tarball, not repository aliases.');
const server=await import(target);
const browser=await import(await resolve('@cossackframework/test-utils/browser'));
assert.equal(typeof browser.render,'function');
const signal=server.controlledAsync();signal.cancel();await assert.rejects(signal.promise);assert.ok(signal.signal.aborted);
assert.deepEqual(server.readHydrationState('<script>window.__INITIAL_STATE__ = {"public":{"count":2}}</script>'),{public:{count:2}});
assert.equal(server.authFixture({cookies:{session_id:'fixture token'}}).headers.get('cookie'),'session_id=fixture%20token');
const env={identity:'installed'};
const app=server.createServerApp({env,fetch:async(req,bindings)=>{assert.equal(bindings,env);return Response.json({url:req.url,body:await req.json()});}});
const reply=await(await app.serviceRpc({ownerRouteId:'layout',slot:'0',action:'snapshot'})).json();
assert.deepEqual(reply.body.service,{ownerRouteId:'layout',slot:'0'});
const fixture=await fs.mkdtemp(path.join(root,'.test-utils-types-'));
try {
 await fs.writeFile(path.join(fixture,'consumer.ts'),`import {createServerApp,authFixture,readHydrationState,controlledAsync} from '@cossackframework/test-utils/server';
import {render} from '@cossackframework/test-utils/browser';
const app=createServerApp({env:{name:'test'},fetch:async(request,env)=>new Response(env.name)});
app.componentRpc({componentRouteId:'page',action:'test'},authFixture({cookies:{session_id:'test'}}));
app.serviceRpc({ownerRouteId:'layout',slot:'0',action:'test'});
const state=readHydrationState<{public:{count:number}}>('<html>');
const operation=controlledAsync<number>();operation.resolve(1);void render;void state;
// @ts-expect-error required production component identity
app.componentRpc({action:'test'});
// @ts-expect-error deferred retains payload type
operation.resolve('wrong');
`);
 await fs.writeFile(path.join(fixture,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ESNext',module:'NodeNext',moduleResolution:'NodeNext',strict:true,skipLibCheck:true,noEmit:true,types:['node'],lib:['ESNext','DOM']},files:['consumer.ts']}));
 const compiler=path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc');
 await promisify(execFile)(process.execPath,[compiler,'-p',path.join(fixture,'tsconfig.json')],{cwd:root,timeout:30000,maxBuffer:1024*1024});
 console.log('Installed test-utils browser/server runtime exports and strict published type imports passed.');
}finally{await fs.rm(fixture,{recursive:true,force:true});}
