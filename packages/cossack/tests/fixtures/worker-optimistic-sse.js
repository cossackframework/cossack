import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';

export async function writeWorkerOptimisticSse(root) {
  const write = async (name, source) => {
    const file = path.join(root, name); await fs.mkdir(path.dirname(file), {recursive:true}); await fs.writeFile(file, source);
  };
  await write('src/private-sse-optimistic.ts', `
    export async function initialize(db:D1Database) {
      await db.prepare('CREATE TABLE IF NOT EXISTS optimistic_sse_counter (id INTEGER PRIMARY KEY, count INTEGER NOT NULL)').run();
      await db.prepare('INSERT OR IGNORE INTO optimistic_sse_counter VALUES (1,0)').run();
      await db.prepare('CREATE TABLE IF NOT EXISTS optimistic_sse_operations (id TEXT PRIMARY KEY, released INTEGER NOT NULL DEFAULT 0)').run();
    }
    export async function read(db:D1Database) {
      await initialize(db);
      return (await db.prepare('SELECT count FROM optimistic_sse_counter WHERE id=1').first<{count:number}>())!;
    }
    export async function commit(db:D1Database,id:string) {
      await initialize(db);
      await db.prepare('INSERT INTO optimistic_sse_operations (id) VALUES (?)').bind(id).run();
      return (await db.prepare('UPDATE optimistic_sse_counter SET count=count+1 WHERE id=1 RETURNING count').first<{count:number}>())!;
    }
    export async function audit(db:D1Database) {
      const counter=await read(db), rows=await db.prepare('SELECT id FROM optimistic_sse_operations ORDER BY id').all();
      return {...counter,operations:rows.results};
    }
    export async function replace(db:D1Database,count:number) {
      await db.prepare('UPDATE optimistic_sse_counter SET count=? WHERE id=1').bind(count).run();
      return count;
    }
    export async function waitForRelease(db:D1Database,id:string) {
      const deadline=Date.now()+15000;
      while(!(await db.prepare('SELECT released FROM optimistic_sse_operations WHERE id=?').bind(id).first<{released:number}>())?.released) {
        if(Date.now()>deadline) throw new Error('Test did not release its SSE stream');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    }
  `);
  await write('src/pages/resource-check/optimistic-sse/index.ts', `
    import { Cossack, Page, State, ClientState, Client, Server, Optimistic, optimistic, input, rpc$, ClientVisibleError } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { read, commit, replace, waitForRelease } from '../../../private-sse-optimistic';
    @Page({transport:'sse'}) export default class OptimisticSse extends Cossack<Env> {
      @State() count=0;
      @ClientState() draft='draft';
      @ClientState() yields:string[]=[];
      @ClientState() failures:string[]=[];
      private streamCall?:{cancel():Promise<void>};
      async init() { this.count=(await read(this.env.DB)).count; }
      @Optimistic('increment') preview() { optimistic<OptimisticSse>(this).increment('count',1); }
      @Server({input:input.object({id:input.string()})})
      async increment(value:{id:string}) { this.count=(await commit(this.env.DB,value.id)).count; return this.count; }
      @Server({input:input.object({count:input.number()})})
      async replace(value:{count:number}) { this.count=await replace(this.env.DB,value.count); return this.count; }
      @Optimistic('streamIncrement') previewStream() { optimistic<OptimisticSse>(this).increment('count',1); }
      @Server({input:input.object({id:input.string(),fail:input.boolean()})})
      async *streamIncrement(value:{id:string;fail:boolean}) {
        this.count=(await commit(this.env.DB,value.id)).count; yield {id:value.id,count:this.count};
        if(value.fail) throw new ClientVisibleError('The SSE write committed before this stream failed.');
        await waitForRelease(this.env.DB,value.id); return this.count;
      }
      @Client() async startStream(id:string,fail:boolean) {
        const call=rpc$(this.streamIncrement({id,fail})); this.streamCall=call;
        try { for await(const value of call) this.yields=[...this.yields,value.id]; }
        catch(error) { this.failures=[...this.failures,(error as {code:string}).code]; }
      }
      @Client() async cancelStream() { await this.streamCall?.cancel(); }
      @Client() onMount() {
        const observed=window as any; observed.__optimisticSse=this; observed.__sseFrames=[];
        (Reflect.get(this,'_sseConnection') as EventSource).addEventListener('state-update',(event:MessageEvent)=>{
          observed.__sseFrames.push({cursor:event.lastEventId,data:JSON.parse(event.data)});
        });
      }
      render() { return html\`<span id="sse-count">\${this.count}</span><span id="sse-draft">\${this.draft}</span>
        <span id="sse-loading">\${(this.loading.increment??0)+(this.loading.streamIncrement??0)}</span>\`; }
    }
  `);
  // Test-owned publication controls use the real namespace and snapshot API.
  // They never replace the production subscription handler or browser EventSource.
  await write('src/pages/api/rpc-check/optimistic-sse.ts', `
    import type { Context } from 'hono';
    import type { SseDurableObject } from '@cossackframework/framework/SseDurableObject';
    import { audit } from '../../../private-sse-optimistic';
    export const GET=async(c:Context<{Bindings:Env}>)=>{
      return c.json(await audit(c.env.DB));
    };
    export const POST=async(c:Context<{Bindings:Env}>)=>{
      const release=c.req.query('release');
      if(release) {
        await c.env.DB.prepare('UPDATE optimistic_sse_operations SET released=1 WHERE id=?').bind(release).run();
        return c.json({released:true});
      }
      const value=await c.req.json<{route:string;scope:string;count:number;overflow?:boolean}>();
      const stub=c.env.COSSACK_SSE.getByName(JSON.stringify([value.route,value.scope])) as DurableObjectStub<SseDurableObject>;
      const before=await stub.currentState(); if(!before) return c.text('Scope missing',404);
      const state=JSON.parse(before.state);
      let cursor=before.cursor;
      for(let i=0;i<(value.overflow?130:1);i++) cursor=(await stub.publish(JSON.stringify({...state,count:value.count}))).cursor;
      await c.env.DB.prepare('UPDATE optimistic_sse_counter SET count=? WHERE id=1').bind(value.count).run();
      return c.json({cursor,count:value.count});
    };
  `);
  const middlewareFile=path.join(root,'src/bootstrap/middlewares.ts');
  const middleware=await fs.readFile(middlewareFile,'utf8');
  const marker='const middlewares: MiddlewareHandler[] = [';
  // The Node shared fixture has no custom middleware array. Native acceptance
  // uses this exact array and owns only the controlled response-end wrapper.
  if(middleware.includes(marker)) await fs.writeFile(middlewareFile,middleware.replace(marker,`${marker}
    async (c,next)=>{
      await next();
      if(!c.req.path.startsWith('/sse/')||c.req.query('__test_sse_close')!=='1'||!c.res.body) return;
      const response=c.res, reader=response.body!.getReader(), decoder=new TextDecoder();
      let pending='', closed=false;
      c.res=new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
          if(closed) return;
          const next=await reader.read();
          if(next.done) { closed=true; reader.releaseLock(); controller.close(); return; }
          controller.enqueue(next.value); pending+=decoder.decode(next.value,{stream:true});
          if(pending.length>1024*1024) throw new Error('Test SSE block exceeded its bound');
          let end;
          while((end=pending.indexOf('\\n\\n'))!==-1) {
            const block=pending.slice(0,end); pending=pending.slice(end+2);
            if(block.includes('event: state-update')&&/"count":7(?:,|})/.test(block)) {
              closed=true; await reader.cancel(); reader.releaseLock(); controller.close(); return;
            }
          }
        },
        async cancel() { if(!closed) { closed=true; await reader.cancel(); reader.releaseLock(); } },
      },{highWaterMark:0}),{status:response.status,headers:response.headers});
    },`));
}

export async function checkWorkerOptimisticSse(server, serverUrl, sessionCookie, {native=true}={}) {
  const browser=await chromium.launch({headless:true});
  const audit=async()=>{
    const response=await server.fetch('/api/rpc-check/optimistic-sse',{headers:{cookie:sessionCookie}});
    expect(response.status).toBe(200); return response.json();
  };
  try {
    const context=await browser.newContext();
    await context.addCookies([{name:'session_id',value:sessionCookie.split(';')[0].slice('session_id='.length),url:serverUrl.origin,httpOnly:true}]);
    const page=await context.newPage(), errors=[], calls=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(new URL(request.url()).pathname==='/crpc') calls.push(request.postDataJSON());});
    await page.goto(new URL('/resource-check/optimistic-sse'+(native?'?__test_sse_close=1':''),serverUrl).href);
    await page.waitForFunction(()=>window.__optimisticSse?.realtime.sse.state==='open');
    await browserExpect(page.locator('#sse-count')).toHaveText('0');
    const target=await page.evaluate(()=>{
      const host=window.__optimisticSse, initial=host.getInitialStateFromWindow();
      host.draft='keep the draft';
      return {route:initial.componentRouteId,scope:initial.scopeKey};
    });
    const publish=async(count,overflow=false)=>{
      if(!native) {
        const response=await server.fetch('/crpc',{method:'POST',headers:{origin:serverUrl.origin,cookie:sessionCookie,'Content-Type':'application/json'},
          body:JSON.stringify({componentRouteId:target.route,scopeKey:target.scope,action:'replace',payload:[{count}]})});
        expect(response.status).toBe(200); expect((await response.json())._cossack_return).toBe(count);
        return {count,cursor:Number(response.headers.get('X-Cossack-SSE-Cursor'))};
      }
      const response=await server.fetch('/api/rpc-check/optimistic-sse',{method:'POST',headers:{cookie:sessionCookie,'Content-Type':'application/json'},
        body:JSON.stringify({...target,count,overflow})});
      expect(response.status).toBe(200); return response.json();
    };
    let release, committed;
    const held=new Promise(resolve=>{release=resolve;});
    const committedReply=new Promise(resolve=>{committed=resolve;});
    await page.route('**/crpc**',async route=>{
      const response=await route.fetch({maxRetries:0,maxRedirects:0});
      expect(response.status()).toBe(200); expect((await response.json())._cossack_return).toBe(1);
      committed(); await held; await route.fulfill({response});
    });
    await page.evaluate(()=>{window.__sseCall=Promise.resolve(window.__optimisticSse.increment({id:'one'}));});
    await committedReply;
    expect(await audit()).toEqual({count:1,operations:[{id:'one'}]});
    await page.waitForFunction(()=>window.__sseFrames.some(frame=>frame.data.count===1));
    await browserExpect(page.locator('#sse-loading')).toHaveText('1');
    // Its own authoritative broadcast must confirm the increment, not add it twice.
    await browserExpect(page.locator('#sse-count')).toHaveText('1');
    await publish(6);
    await browserExpect(page.locator('#sse-count')).toHaveText('6');
    release(); await page.evaluate(()=>window.__sseCall);
    await browserExpect(page.locator('#sse-count')).toHaveText('6');
    await browserExpect(page.locator('#sse-loading')).toHaveText('0');
    await page.unroute('**/crpc**');
    await publish(7); await browserExpect(page.locator('#sse-count')).toHaveText('7');
    const oldCursor=await page.evaluate(()=>Number(window.__optimisticSse.realtime.sse.lastEventId));
    expect(oldCursor).toBeGreaterThan(0);
    if(native) {
      await page.waitForFunction(()=>window.__optimisticSse.realtime.sse.state==='reconnecting');
      await context.setOffline(true);
      const latest=await publish(777,true);
      expect(latest.cursor-oldCursor).toBe(130);
      await context.setOffline(false);
      await page.waitForFunction(cursor=>window.__optimisticSse.realtime.sse.state==='open'&&window.__optimisticSse.realtime.sse.resynced===true
        &&Number(window.__optimisticSse.realtime.sse.lastEventId)===cursor,latest.cursor);
      await browserExpect(page.locator('#sse-count')).toHaveText('777');
    }
    await browserExpect(page.locator('#sse-draft')).toHaveText('keep the draft');
    await browserExpect(page.locator('#sse-loading')).toHaveText('0');
    expect(calls.filter(call=>call.action==='increment')).toHaveLength(1);
    expect(await audit()).toEqual({count:native?777:7,operations:[{id:'one'}]});
    await page.evaluate(()=>window.__optimisticSse.startStream('stream-failure',true));
    await page.waitForFunction(()=>window.__optimisticSse.yields.includes('stream-failure'));
    expect(await page.evaluate(()=>window.__optimisticSse.failures)).toEqual(['COSSACK_RPC_CLIENT_ERROR']);
    await browserExpect(page.locator('#sse-count')).toHaveText(native?'778':'8');
    await browserExpect(page.locator('#sse-loading')).toHaveText('0');
    if(native) {
      await page.evaluate(()=>{void window.__optimisticSse.startStream('stream-cancel',false);});
      await page.waitForFunction(()=>window.__optimisticSse.yields.includes('stream-cancel'));
      await browserExpect(page.locator('#sse-loading')).toHaveText('1');
      await page.evaluate(()=>window.__optimisticSse.cancelStream());
      expect((await server.fetch('/api/rpc-check/optimistic-sse?release=stream-cancel',{method:'POST',headers:{cookie:sessionCookie}})).status).toBe(200);
      await page.waitForFunction(()=>window.__optimisticSse.failures.length===2);
      expect(await page.evaluate(()=>window.__optimisticSse.failures)).toEqual(['COSSACK_RPC_CLIENT_ERROR','COSSACK_RPC_CANCELLED']);
      await browserExpect(page.locator('#sse-count')).toHaveText('779');
      expect(await audit()).toEqual({count:779,operations:[{id:'one'},{id:'stream-cancel'},{id:'stream-failure'}]});
    } else expect(await audit()).toEqual({count:8,operations:[{id:'one'},{id:'stream-failure'}]});
    await browserExpect(page.locator('#sse-loading')).toHaveText('0');
    await browserExpect(page.locator('#sse-draft')).toHaveText('keep the draft');
    expect(calls.filter(call=>call.action==='increment')).toHaveLength(1);
    expect(calls.filter(call=>call.action==='streamIncrement')).toHaveLength(native?2:1);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}
