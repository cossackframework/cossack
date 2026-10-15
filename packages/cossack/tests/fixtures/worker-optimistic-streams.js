import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';

export async function writeWorkerOptimisticStreams(root) {
  const write = async (name, source) => {
    const file=path.join(root,name); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,source);
  };
  await write('src/private-optimistic-streams.ts', `
    import { sql } from '@cossackframework/database';
    async function ensure(scope:string) {
      await sql\`CREATE TABLE IF NOT EXISTS optimistic_stream_audit (scope TEXT PRIMARY KEY, count INTEGER NOT NULL, mutations INTEGER NOT NULL, released INTEGER NOT NULL)\`;
      await sql\`INSERT OR IGNORE INTO optimistic_stream_audit VALUES (\${scope},0,0,0)\`;
    }
    export async function audit(scope:string) {
      await ensure(scope);
      return (await sql<{count:number;mutations:number;released:number}>\`SELECT count,mutations,released FROM optimistic_stream_audit WHERE scope=\${scope}\`).rows[0]!;
    }
    export async function commit(scope:string) {
      await ensure(scope);
      await sql\`UPDATE optimistic_stream_audit SET count=count+1,mutations=mutations+1 WHERE scope=\${scope}\`;
      return {count:(await audit(scope)).count};
    }
    // Socket actions have no HTTP ORM scope; use their explicit binding.
    export async function commitBound(db:D1Database,scope:string) {
      await db.prepare('CREATE TABLE IF NOT EXISTS optimistic_stream_audit (scope TEXT PRIMARY KEY, count INTEGER NOT NULL, mutations INTEGER NOT NULL, released INTEGER NOT NULL)').run();
      await db.prepare('INSERT OR IGNORE INTO optimistic_stream_audit VALUES (?,0,0,0)').bind(scope).run();
      return (await db.prepare('UPDATE optimistic_stream_audit SET count=count+1,mutations=mutations+1 WHERE scope=? RETURNING count').bind(scope).first<{count:number}>())!;
    }
    export async function waitForReleaseBound(db:D1Database,scope:string) {
      const deadline=Date.now()+15000;
      while(!(await db.prepare('SELECT released FROM optimistic_stream_audit WHERE scope=?').bind(scope).first<{released:number}>())?.released) {
        if(Date.now()>deadline) throw new Error('Test did not release its optimistic stream');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    }
    export async function release(scope:string) {
      await sql\`UPDATE optimistic_stream_audit SET released=1 WHERE scope=\${scope}\`;
    }
    export async function waitForRelease(scope:string) {
      const deadline=Date.now()+15000;
      while(!(await audit(scope)).released) {
        if(Date.now()>deadline) throw new Error('Test did not release its optimistic stream');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    }
  `);
  await write('src/services/OptimisticStreams.ts', `
    import { CossackService, Service, Server, State, ClientState, Optimistic, optimistic, input, ClientVisibleError } from '@cossackframework/core';
    import { commit,waitForRelease } from '../private-optimistic-streams';
    @Service() export default class StreamCounter extends CossackService {
      @State() serviceCount=0;
      @ClientState() previewCount=0;
      @ClientState() draft='service draft';
      @Optimistic('streamService') preview() {
        const edits=optimistic<StreamCounter>(this); edits.increment('serviceCount',1); edits.increment('previewCount',1);
      }
      @Server({timeout:1500,input:input.object({scope:input.string()})})
      async *timedStreamService(value:{scope:string}) {
        this.serviceCount=(await commit(value.scope)).count; yield {scope:value.scope,count:this.serviceCount};
        await waitForRelease(value.scope); return this.serviceCount;
      }
      @Server({input:input.object({scope:input.string(),mode:input.enum(['error','held','done'] as const)})})
      async *streamService(value:{scope:string;mode:'error'|'held'|'done'}) {
        this.serviceCount=(await commit(value.scope)).count; yield {scope:value.scope,count:this.serviceCount};
        if(value.mode==='error') throw new ClientVisibleError('The service write committed before failure.');
        if(value.mode==='held') await waitForRelease(value.scope);
        return this.serviceCount;
      }
    }
  `);
  await write('src/pages/resource-check/optimistic-streams/layout.ts', `
    import { Cossack,Page,Inject } from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    import StreamCounter from '../../../services/OptimisticStreams';
    @Page({services:[StreamCounter]}) export default class StreamLayout extends Cossack {
      @Inject(StreamCounter) service!:StreamCounter;
      render() { return html\`<aside><span id="stream-layout-count">\${this.service.serviceCount}</span>
        <span id="stream-layout-loading">\${(this.loading.streamService??0)+(this.loading.timedStreamService??0)}</span>
        <span id="stream-layout-preview">\${this.service.previewCount}</span></aside>\${this.children}\`; }
    }
  `);
  await write('src/pages/api/rpc-check/optimistic-streams.ts', `
    import type {Context} from 'hono';
    import {audit,release} from '../../../private-optimistic-streams';
    export const GET=async(c:Context)=>c.json(await audit(c.req.query('scope')!));
    export const POST=async(c:Context)=>{await release(c.req.query('scope')!);return c.json({released:true});};
  `);
  await write('src/pages/resource-check/optimistic-streams/example/index.ts',
    await fs.readFile(new URL('../../../../docs/examples/optimistic-stream.ts',import.meta.url),'utf8'));
  await write('src/private/optimistic-stream.server.ts',
    await fs.readFile(new URL('../../../../docs/examples/optimistic-stream.server.ts',import.meta.url),'utf8'));
  await write('src/pages/api/rpc-check/optimistic-stream-example.ts', `
    import type {Context} from 'hono';
    import {readCounter} from '@/private/optimistic-stream.server';
    export const GET=async(c:Context)=>c.json(await readCounter());
  `);
  for(const transport of ['http','sse','durable-object']) await write(`src/pages/resource-check/optimistic-streams/${transport}/index.ts`, `
    import { Cossack,Page,Component,Inject,State,ClientState,Client,Server,Optimistic,optimistic,input,rpc$,ClientVisibleError } from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';
    import StreamCounter from '../../../../services/OptimisticStreams';
    import {commit,waitForRelease,commitBound,waitForReleaseBound} from '../../../../private-optimistic-streams';
    @Component({transport:'http'}) class StreamWatcher extends Cossack {
      @Inject(StreamCounter) service!:StreamCounter;
      render() {return html\`<span id="stream-nested-count">\${this.service.serviceCount}</span>
        <span id="stream-nested-loading">\${(this.loading.streamService??0)+(this.loading.timedStreamService??0)}</span>
        <span id="stream-nested-preview">\${this.service.previewCount}</span>\`;}
    }
    @Page({transport:'${transport}'}) export default class StreamPage extends Cossack<Env> {
      @Inject(StreamCounter) service!:StreamCounter;
      @State() count=0;
      @ClientState() previewCount=0;
      @ClientState() draft='component draft';
      @ClientState() yields:string[]=[];
      @ClientState() failures:Array<{scope:string;code:string;requestId?:string}>=[];
      private active?:{cancel():Promise<void>};
      @Optimistic('streamComponent') preview() {
        const edits=optimistic<StreamPage>(this);edits.increment('count',1);edits.increment('previewCount',1);
      }
      @Server({timeout:1500,input:input.object({scope:input.string()})})
      async *timedStreamComponent(value:{scope:string}) {
        this.count=(await commitBound(this.env.DB,value.scope)).count; yield {scope:value.scope,count:this.count};
        await waitForReleaseBound(this.env.DB,value.scope); return this.count;
      }
      @Server({input:input.object({scope:input.string(),mode:input.enum(['error','held','done'] as const)})})
      async *streamComponent(value:{scope:string;mode:'error'|'held'|'done'}) {
        this.count=(await commit(value.scope)).count;yield {scope:value.scope,count:this.count};
        if(value.mode==='error') throw new ClientVisibleError('The component write committed before failure.');
        if(value.mode==='held') await waitForRelease(value.scope);
        return this.count;
      }
      @Client() onMount() {(window as any).__optimisticStreams=this;}
      @Client() async start(useService:boolean,scope:string,mode:'error'|'held'|'done') {
        const call=rpc$(useService?this.service.streamService({scope,mode}):this.streamComponent({scope,mode}));this.active=call;
        try {for await(const value of call)this.yields=[...this.yields,value.scope];}
        catch(error) {const diagnostic=error as {code:string;requestId?:string};this.failures=[...this.failures,{scope,...diagnostic}];}
      }
      @Client() async cancel() {await this.active?.cancel();}
      render() {return html\`<main><span id="stream-component-count">\${this.count}</span>
        <span id="stream-service-count">\${this.service.serviceCount}</span>
        <span id="stream-page-loading">\${((this.loading.streamService??0)+(this.loading.timedStreamService??0))+(this.loading.streamComponent??0)+(this.loading.timedStreamComponent??0)}</span>
        <span id="stream-component-preview">\${this.previewCount}</span><span id="stream-service-preview">\${this.service.previewCount}</span>
        <span id="stream-component-draft">\${this.draft}</span><span id="stream-service-draft">\${this.service.draft}</span>
        \${component(StreamWatcher)}</main>\`;}
    }
  `);
}

export async function checkWorkerOptimisticStreams(server,serverUrl,cookie) {
  const origin=serverUrl.origin,browser=await chromium.launch({headless:true});
  const audit=async scope=>{
    const response=await server.fetch('/api/rpc-check/optimistic-streams?scope='+encodeURIComponent(scope),{headers:{cookie}});
    expect(response.status).toBe(200);return response.json();
  };
  try {
    for(const transport of ['http','sse','durable-object']) {
      const context=await browser.newContext();
      await context.addCookies([{name:'session_id',value:cookie.split(';')[0].slice('session_id='.length),url:origin,httpOnly:true}]);
      const page=await context.newPage(),errors=[],requests=[],socketRequests=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('websocket',socket=>socket.on('framesent',event=>{
        try {socketRequests.push(JSON.parse(String(event.payload)));} catch { /* Non-RPC frame. */ }
      }));
      page.on('request',request=>{if(new URL(request.url()).pathname==='/crpc')requests.push(request.postDataJSON());});
      await page.goto(origin+'/resource-check/optimistic-streams/'+transport);
      await page.waitForFunction(()=>!!window.__optimisticStreams);
      if(transport==='sse')await page.waitForFunction(()=>window.__optimisticStreams.realtime.sse.state==='open');
      if(transport==='durable-object')await page.waitForFunction(()=>window.__optimisticStreams.realtime.websocket?.state==='open');
      for(const useService of transport==='durable-object'?[true]:[false,true]) for(const failure of ['error','cancel','malformed','truncated','after-terminal']) {
        const scope=transport+':'+(useService?'service':'component')+':'+failure;
        const before=requests.length;let requestId;
        if(['malformed','truncated','after-terminal'].includes(failure)) {
          await page.route('**/crpc**',async route=>{
            if(route.request().postDataJSON().payload?.[0]?.scope!==scope)return route.continue();
            // Consume a real, bounded two-frame response after the actual write
            // commits, then damage the delivery. Business dispatch is unchanged.
            const reply=await route.fetch({maxRedirects:0,maxRetries:0});expect(reply.status()).toBe(200);
            const bytes=await reply.body();expect(bytes.length).toBeLessThan(16384);
            const frames=bytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
            expect(frames.map(frame=>frame.type)).toEqual(['yield','done']);
            requestId=reply.headers()['x-cossack-request-id'];expect(requestId).toBeTruthy();
            const first=JSON.stringify(frames[0])+'\n';
            const body=failure==='malformed'?first+'{bad-json}\n':failure==='truncated'?first:
              first+JSON.stringify({...frames[1],state:useService?{serviceCount:999}:{count:999}})+'\n'+first;
            expect(await audit(scope)).toMatchObject({count:1,mutations:1});
            await route.fulfill({response:reply,body});
          });
        }
        await page.evaluate(({useService,scope,mode})=>{
          const host=window.__optimisticStreams;
          host.draft='keep component draft';host.service.draft='keep service draft';
          window.__optimisticStreamDone=host.start(useService,scope,mode);
        },{useService,scope,mode:failure==='error'?'error':failure==='cancel'?'held':'done'});
        await page.waitForFunction(scope=>window.__optimisticStreams.yields.includes(scope),scope);
        if(failure==='cancel') {
          await browserExpect(page.locator('#stream-page-loading')).toHaveText('1');
          if(useService)for(const owner of ['layout','nested'])await browserExpect(page.locator('#stream-'+owner+'-loading')).toHaveText('1');
          await page.evaluate(()=>window.__optimisticStreams.cancel());
          const released=await server.fetch('/api/rpc-check/optimistic-streams?scope='+encodeURIComponent(scope),{method:'POST',headers:{cookie}});
          expect(released.status).toBe(200);
        }
        await page.evaluate(()=>window.__optimisticStreamDone);
        const expectedCode=failure==='error'?'COSSACK_RPC_CLIENT_ERROR':failure==='cancel'?'COSSACK_RPC_CANCELLED':
          failure==='truncated'?'COSSACK_RPC_STREAM_TRUNCATED':'COSSACK_RPC_STREAM_INVALID';
        const diagnostic=await page.evaluate(scope=>window.__optimisticStreams.failures.find(item=>item.scope===scope),scope);
        expect(diagnostic).toMatchObject({scope,code:expectedCode,requestId:expect.any(String)});
        if(requestId)expect(diagnostic.requestId).toBe(requestId);
        const owned=requests.slice(before).filter(body=>body.payload?.[0]?.scope===scope);
        expect(owned).toHaveLength(1);expect(!!owned[0].service).toBe(useService);
        expect(owned[0].state).not.toHaveProperty('previewCount');expect(owned[0].state).not.toHaveProperty('draft');
        await browserExpect(page.locator('#stream-page-loading')).toHaveText('0');
        await browserExpect(page.locator('#stream-'+(useService?'service':'component')+'-count')).toHaveText('1');
        await browserExpect(page.locator('#stream-'+(useService?'service':'component')+'-preview')).toHaveText('0');
        for(const owner of ['layout','nested']) {
          await browserExpect(page.locator('#stream-'+owner+'-loading')).toHaveText('0');
          if(useService) {
            await browserExpect(page.locator('#stream-'+owner+'-count')).toHaveText('1');
            await browserExpect(page.locator('#stream-'+owner+'-preview')).toHaveText('0');
          }
        }
        await browserExpect(page.locator('#stream-component-draft')).toHaveText('keep component draft');
        await browserExpect(page.locator('#stream-service-draft')).toHaveText('keep service draft');
        expect(await audit(scope)).toMatchObject({count:1,mutations:1});expect(errors).toEqual([]);
        await page.unroute('**/crpc**');
      }
      for (const useService of [false,true]) {
        const scope=transport+':'+(useService?'service':'component')+':paused-deadline';
        const first=await page.evaluate(async({scope,useService})=>{
          const host=window.__optimisticStreams;
          const call=useService?host.service.timedStreamService({scope}):host.timedStreamComponent({scope});
          window.__pausedCall=call; window.__pausedIterator=call[Symbol.asyncIterator](); window.__pausedError=undefined;
          void call.catch(error=>{window.__pausedError={code:error.code,requestId:error.requestId};});
          return window.__pausedIterator.next();
        },{scope,useService});
        expect(first).toMatchObject({done:false,value:{scope,count:1}});
        await page.waitForFunction(()=>!!window.__pausedError);
        expect(await page.evaluate(()=>window.__pausedError)).toMatchObject({code:'COSSACK_RPC_TIMEOUT',requestId:expect.any(String)});
        await browserExpect(page.locator('#stream-page-loading')).toHaveText('0');
        await browserExpect(page.locator('#stream-'+(useService?'service':'component')+'-count')).toHaveText('1');
        if(useService)for(const owner of ['layout','nested'])await browserExpect(page.locator('#stream-'+owner+'-loading')).toHaveText('0');
        expect(await page.evaluate(async()=>{
          try {await window.__pausedIterator.next();return 'unexpected-success';} catch(error){return error.code;}
        })).toBe('COSSACK_RPC_TIMEOUT');
        await page.evaluate(()=>window.__pausedCall.cancel());
        expect(await audit(scope)).toMatchObject({count:1,mutations:1});
        const requestsForCall=(transport==='durable-object'&&!useService?socketRequests:requests).filter(body=>body.payload?.[0]?.scope===scope);
        expect(requestsForCall).toHaveLength(1);
        const released=await server.fetch('/api/rpc-check/optimistic-streams?scope='+encodeURIComponent(scope),{method:'POST',headers:{cookie}});
        expect(released.status).toBe(200); expect(errors).toEqual([]);
      }
      if(transport==='sse') {
        await page.goto(origin+'/resource-check/optimistic-streams/example');
        await browserExpect(page.locator('#optimistic-example-read')).toHaveText('0');
        await page.locator('input[name="draft"]').fill('keep example draft');
        const before=requests.length;
        await page.getByRole('button',{name:'Increase',exact:true}).click();
        await browserExpect(page.locator('#optimistic-example-count')).toHaveText('1');
        await browserExpect(page.locator('#optimistic-example-read')).toHaveText('1');
        await browserExpect(page.locator('#optimistic-example-loading')).toHaveText('0');
        await browserExpect(page.locator('#optimistic-example-preview')).toHaveText('0');

        await page.locator('input[name="failAfterWrite"]').check();
        await page.getByRole('button',{name:'Increase',exact:true}).click();
        await browserExpect(page.locator('#optimistic-example-error')).toHaveText('COSSACK_RPC_CLIENT_ERROR');
        await browserExpect(page.locator('#optimistic-example-recovery')).toHaveText('refreshed');
        await browserExpect(page.locator('#optimistic-example-count')).toHaveText('2');
        await browserExpect(page.locator('#optimistic-example-read')).toHaveText('2');
        await browserExpect(page.locator('#optimistic-example-loading')).toHaveText('0');
        await browserExpect(page.locator('#optimistic-example-preview')).toHaveText('0');

        await page.locator('input[name="failAfterWrite"]').uncheck();
        await page.getByRole('button',{name:'Increase',exact:true}).click();
        await browserExpect(page.locator('#optimistic-example-loading')).toHaveText('1');
        await browserExpect(page.locator('#optimistic-example-progress')).toHaveText('1');
        await expect.poll(async()=>{
          const response=await server.fetch('/api/rpc-check/optimistic-stream-example',{headers:{cookie}});
          expect(response.status).toBe(200);return (await response.json()).count;
        }).toBe(3);
        await page.getByRole('button',{name:'Cancel',exact:true}).click();
        await browserExpect(page.locator('#optimistic-example-error')).toHaveText('COSSACK_RPC_CANCELLED');
        await browserExpect(page.locator('#optimistic-example-recovery')).toHaveText('recovered');
        await browserExpect(page.locator('#optimistic-example-count')).toHaveText('3');
        await browserExpect(page.locator('#optimistic-example-read')).toHaveText('3');
        await browserExpect(page.locator('#optimistic-example-loading')).toHaveText('0');
        await browserExpect(page.locator('#optimistic-example-preview')).toHaveText('0');
        await browserExpect(page.locator('input[name="draft"]')).toHaveValue('keep example draft');
        expect(requests.slice(before).filter(body=>body.action==='increment')).toHaveLength(3);
        expect(errors).toEqual([]);
      }
      await context.close();
    }
  } finally {await browser.close();}
}
