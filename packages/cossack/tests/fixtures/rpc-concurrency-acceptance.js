import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { chromium } from '@playwright/test';

export async function writeRpcConcurrencyAcceptance(root,adapter) {
 const write=async(name,source)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,source);};
 await write('src/private-rpc-audit.ts',`export const audit=new Map<string,{mutations:number,closed:number,disposed:number}>();`);
 await write('src/pages/concurrency/index.ts',`
 import {Cossack,Page,Client,Server,rpc$} from '@cossackframework/core';
 import {html} from '@cossackframework/renderer';
 import {audit} from '../../private-rpc-audit';
 @Page({transport:'http'}) export default class Concurrent extends Cossack {
 private operation?:string;
 @Server() async *stream(id:string) {this.operation=id; const record={mutations:1,closed:0,disposed:0};audit.set(id,record);try{yield 'started';return 'complete';}finally{record.closed++;}}
 onCleanup(){if(this.operation)audit.get(this.operation)!.disposed++;}
 @Client() onMount(){(window as any).__concurrency=this;}
 @Client() async probe(id:string){const call=rpc$(this.stream(id));const iterator=call[Symbol.asyncIterator]();const first=await iterator.next();let code='';try{call[Symbol.asyncIterator]();}catch(error){code=(error as {code:string}).code;}const a=Promise.resolve(call),b=Promise.resolve(call);const final=await iterator.next();return {first,final,results:await Promise.all([a,b]),code};}
 render(){return html\`<main>Concurrency acceptance</main>\`;}
 }
 `);
 await write('src/pages/api/concurrency.ts',`import {audit} from '../../private-rpc-audit';export const GET=(c:any)=>c.json(Object.fromEntries(audit));`);
 if(adapter==='cloudflare') {
 await write('src/pages/api/lifecycle.ts',`export const GET=(c:any)=>{const id=c.env.COSSACK_OBJECT.idFromName('lifecycle');const op=new URL(c.req.url).searchParams.get('op');if(op==='id')return c.json({id:id.toString()});const stub=c.env.COSSACK_OBJECT.get(id);if(op)return stub.fetch('https://fixture.test/'+op);return stub.fetch(new Request('https://fixture.test/global?pathname=/live&params={}',{headers:{Upgrade:'websocket','X-Component-Path':'/fixture/live.ts','X-Provider-Name':'page'}}));};`);

 const configFile=path.join(root,'wrangler.jsonc');const config=JSON.parse(await fs.readFile(configFile,'utf8'));config.durable_objects.bindings.push({name:'COSSACK_OBJECT',class_name:'AppDurableObject'});config.migrations[0].new_sqlite_classes.push('AppDurableObject');await fs.writeFile(configFile,JSON.stringify(config));
 await write('src/fixture-do.ts',`
 import {Cossack,CossackDurableObject,Page,State,Server} from '@cossackframework/core';
 @Page({transport:'durable-object',stateful:true}) class Live extends Cossack {
 storage!:DurableObjectStorage;
 @State() count=0;
 async get(){const n=await this.storage.get<number>('gets')??0;await this.storage.put('gets',n+1);}
 async init(){const n=await this.storage.get<number>('inits')??0;await this.storage.put('inits',n+1);while(!await this.storage.get('released'))await new Promise(r=>setTimeout(r,5));this.count=91;}
 @Server() increment(){return ++this.count;}
 }
 Reflect.defineMetadata('cossack:durable-object-name','COSSACK_OBJECT',Live);
 export class FixtureDO extends CossackDurableObject {
 async getComponentRegistry(){const storage=this.state.storage;class RegisteredLive extends Live {constructor(){super();this.storage=storage;}}return new Map([['/fixture/live.ts',RegisteredLive]]);}
 override async fetch(request:Request){const path=new URL(request.url).pathname;
 if(path==='/audit')return Response.json({inits:await this.state.storage.get('inits')??0,gets:await this.state.storage.get('gets')??0,published:!!this.componentInstance,count:this.componentInstance?.getInitialState().public.count,peers:this.state.getWebSockets().length});
 if(path==='/release'){await this.state.storage.put('released',true);return Response.json({ok:true});}
 return super.fetch(request);}
 }
 `);
 const file=path.join(root,'src/index.ts');let index=await fs.readFile(file,'utf8');index=index.replace("import { AppDurableObject } from '@cossackframework/framework/DurableObject';","import { FixtureDO as AppDurableObject } from './fixture-do';");await fs.writeFile(file,index);
 }
}
export async function checkRpcConsumers(origin) {
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.goto(origin+'/concurrency');await expect.poll(()=>page.evaluate(()=>!!window.__concurrency)).toBe(true);
 const result=await page.evaluate(()=>window.__concurrency.probe('duplicate'));
 expect(result).toEqual({first:{done:false,value:'started'},final:{done:true,value:'complete'},results:['complete','complete'],code:'COSSACK_RPC_ALREADY_CONSUMED'});
 await expect.poll(async()=>await (await fetch(origin+'/api/concurrency')).json()).toEqual({duplicate:{mutations:1,closed:1,disposed:1}});
 }finally{await browser.close();}
}
export async function checkDurableLifecycle(runtime,origin) {
 const worker=runtime.getWorker();const request=op=>fetch(origin+'/api/lifecycle?op='+op);const {id}=await (await request('id')).json();
 const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.goto(origin+'/concurrency');
 const open=()=>page.evaluate(()=>{window.__lifecyclePeers??=[];window.__lifecyclePeers.push(new WebSocket(location.origin.replace('http','ws')+'/api/lifecycle'));});
 await open();await expect.poll(async()=> (await (await request('audit')).json()).inits).toBe(1);await open();
 expect(await (await request('audit')).json()).toMatchObject({inits:1,published:false,peers:0});await (await request('release')).json();
 await expect.poll(()=>page.evaluate(()=>window.__lifecyclePeers.map(peer=>peer.readyState))).toEqual([1,1]);
 expect(await (await request('audit')).json()).toMatchObject({inits:1,gets:1,published:true,count:91,peers:2});
 await page.evaluate(()=>{for(const peer of window.__lifecyclePeers)peer.close();});
 await expect.poll(()=>page.evaluate(()=>window.__lifecyclePeers.map(peer=>peer.readyState))).toEqual([3,3]);
 await expect.poll(async()=> (await (await request('audit')).json()).peers).toBe(0);
 await browser.close();
 await worker.evictDurableObject('COSSACK_OBJECT',{id,webSockets:'close'});
 const states=await Promise.all([request('state'),request('state')]);for(const response of states)expect(await response.json()).toMatchObject({public:{count:91}});
 expect(await (await request('audit')).json()).toMatchObject({inits:1,gets:2,published:true,count:91});
 }finally{await browser.close();}
}
