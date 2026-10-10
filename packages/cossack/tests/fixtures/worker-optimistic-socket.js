import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';

// The release/audit endpoints exist only in this disposable acceptance app.
export async function writeWorkerOptimisticSocket(root) {
  const write = async (name, source) => {
    const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, source);
  };
  await write('src/private-socket-recovery.ts', `
    export async function initialize(db: D1Database) {
      await db.prepare('CREATE TABLE IF NOT EXISTS socket_counter (id INTEGER PRIMARY KEY, count INTEGER NOT NULL)').run();
      await db.prepare('INSERT OR IGNORE INTO socket_counter VALUES (1,0)').run();
      await db.prepare('CREATE TABLE IF NOT EXISTS socket_operations (id TEXT PRIMARY KEY, released INTEGER NOT NULL, settled INTEGER NOT NULL)').run();
    }
    export async function read(db: D1Database) {
      await initialize(db);
      return (await db.prepare('SELECT count FROM socket_counter WHERE id=1').first<{count:number}>())!;
    }
    export async function commit(db: D1Database, id:string) {
      // The test audits both persisted writes before deliberately closing the socket.
      await db.prepare('INSERT INTO socket_operations VALUES (?,0,0)').bind(id).run();
      return (await db.prepare('UPDATE socket_counter SET count=count+1 WHERE id=1 RETURNING count').first<{count:number}>())!;
    }
    export async function waitForRelease(db:D1Database, id:string) {
      const deadline=Date.now()+15000;
      while (!(await db.prepare('SELECT released FROM socket_operations WHERE id=?').bind(id).first<{released:number}>())?.released) {
        if(Date.now()>deadline) throw new Error('Test did not release the committed socket action');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      await db.prepare('UPDATE socket_operations SET settled=1 WHERE id=?').bind(id).run();
    }
  `);
  await write('src/pages/resource-check/socket/index.ts', `
    import { Cossack, Page, State, ClientState, Client, Server, Optimistic, OnEvent, optimistic, input, rpc$, ClientVisibleError } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { read, commit, waitForRelease } from '../../../private-socket-recovery';
    @Page({transport:'durable-object',stateful:true}) export default class SocketRecovery extends Cossack<Env> {
      @State() count=0;
      @State() actor='';
      @ClientState() draft='draft';
      @ClientState() failures:string[]=[];
      @ClientState() committed:string[]=[];
      @ClientState() yields:string[]=[];
      private streamCall?:{cancel():Promise<void>};
      async init() { this.count=(await read(this.env.DB)).count; }
      @Optimistic('increment') preview() { optimistic<SocketRecovery>(this).increment('count',1); }
      @Server({input:input.object({id:input.string()})})
      async increment(value:{id:string}) {
        this.actor=this.user?.id??'guest';
        this.count=(await commit(this.env.DB,value.id)).count;
        this.broadcastEvent('socket:committed',value.id);
        await waitForRelease(this.env.DB,value.id);
        return this.count;
      }
      @Optimistic('streamIncrement') previewStream() { optimistic<SocketRecovery>(this).increment('count',1); }
      @Server({input:input.object({id:input.string()})})
      async *streamIncrement(value:{id:string}) {
        this.actor=this.user?.id??'guest';
        this.count=(await commit(this.env.DB,value.id)).count;
        yield {id:value.id,count:this.count};
        await waitForRelease(this.env.DB,value.id);
        throw new ClientVisibleError('The record committed before the stream failed.');
      }
      @Client() async startStream(id:string) {
        const call=rpc$(this.streamIncrement({id})); this.streamCall=call;
        try { for await(const value of call) this.yields=[...this.yields,value.id]; }
        catch(error) { this.failures=[...this.failures,(error as {code:string}).code]; }
      }
      @Client() async cancelStream() { await this.streamCall?.cancel(); }
      @Client() @OnEvent('socket:committed') receiveCommit(id:string) { this.committed=[...this.committed,id]; }
      @Client() onMount() { (window as any).__socketRecovery=this; }
      @Client() async start(id:string) {
        try { await this.increment({id}); }
        catch(error) { this.failures=[...this.failures,(error as {code:string}).code]; }
      }
      render() { return html\`<main><span id="socket-count">\${this.count}</span><span id="socket-actor">\${this.actor}</span><span id="socket-draft">\${this.draft}</span>
        <span id="socket-loading">\${(this.loading.increment||0)+(this.loading.streamIncrement||0)}</span><span id="socket-failures">\${this.failures.join(',')}</span></main>\`; }
    }
  `);
  await write('src/pages/api/rpc-check/socket.ts', `
    import type { Context } from 'hono';
    import { initialize, read } from '../../../private-socket-recovery';
    export const GET=async(c:Context<{Bindings:Env}>)=>{
      const counter=await read(c.env.DB);
      const operations=await c.env.DB.prepare('SELECT id,released,settled FROM socket_operations ORDER BY id').all();
      return c.json({...counter,operations:operations.results});
    };
    export const POST=async(c:Context<{Bindings:Env}>)=>{
      if(c.req.query('disconnect')) {
        const stub=c.env.COSSACK_OBJECT.get(c.env.COSSACK_OBJECT.idFromString(c.req.query('disconnect')!));
        return stub.fetch('https://object/__test_drop');
      }
      await initialize(c.env.DB);
      await c.env.DB.prepare('UPDATE socket_operations SET released=1 WHERE id=?').bind(c.req.query('id')).run();
      return c.json({released:true});
    };
  `);
  // Only disconnect control is test-owned. The published default registry,
  // dispatch, restoration, persistence and snapshots serve this generated app.
  await write('src/SocketRecoveryObject.ts', `
    import { AppDurableObject } from '@cossackframework/framework/DurableObject';
    export class SocketRecoveryObject extends AppDurableObject {
      async fetch(request:Request) {
        if(new URL(request.url).pathname==='/__test_drop') {
          const sockets=this.state.getWebSockets();
          for(const socket of sockets) socket.close(1012,'Test drops the committed action reply');
          return Response.json({closed:sockets.length});
        }
        return super.fetch(request);
      }
    }
  `);
  await fs.appendFile(path.join(root,'src/index.ts'), "\nexport { SocketRecoveryObject } from './SocketRecoveryObject';\n");
}

export async function checkWorkerOptimisticSocket(server, serverUrl, sessionCookie) {
  const browser=await chromium.launch({headless:true});
  const audit=async()=>{
    const response=await server.fetch('/api/rpc-check/socket',{headers:{cookie:sessionCookie}});
    expect(response.status).toBe(200); return response.json();
  };
  try {
    const context=await browser.newContext();
    await context.addCookies([{name:'session_id',value:sessionCookie.split(';')[0].slice('session_id='.length),url:serverUrl.origin,httpOnly:true}]);
    const page=await context.newPage(), frames=[], received=[], errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('websocket',socket=>{
      socket.on('framereceived',frame=>{
        if(typeof frame.payload==='string'&&frame.payload.startsWith('{')) received.push(JSON.parse(frame.payload));
      });
      socket.on('framesent',frame=>{
        if(typeof frame.payload==='string'&&frame.payload.startsWith('{')) frames.push(JSON.parse(frame.payload));
      });
    });
    await page.goto(new URL('/resource-check/socket',serverUrl).href);
    await page.waitForFunction(()=>window.__socketRecovery?.realtime.websockets.page?.state==='open');
    await browserExpect(page.locator('#socket-count')).toHaveText('0');
    for(const ids of [['one'],['two','three']]) {
      const before=await audit(), callsBefore=frames.filter(frame=>frame.type==='action').length;
      await page.evaluate(ids=>{
        const host=window.__socketRecovery; host.draft='keep this draft';
        for(const id of ids) void host.start(id);
      },ids);
      await page.waitForFunction(id=>window.__socketRecovery.committed.includes(id),ids[0]);
      const committed=await audit();
      await browserExpect(page.locator('#socket-actor')).toHaveText('u1');
      expect(committed.count).toBe(before.count+1);
      expect(committed.operations.filter(row=>ids.includes(row.id))).toHaveLength(1);
      expect(committed.operations.filter(row=>ids.includes(row.id)).every(row=>row.settled===0)).toBe(true);
      await browserExpect(page.locator('#socket-loading')).toHaveText(String(ids.length));
      const requestIds=frames.filter(frame=>frame.type==='action').slice(-ids.length).map(frame=>frame.requestId);
      expect(received.filter(frame=>requestIds.includes(frame.requestId)&&['done','error'].includes(frame.type))).toHaveLength(0);
      const old=await page.evaluate(()=>{
        const host=window.__socketRecovery; host.oldSocket=host.websockets.get('page');
        return host.failures.length;
      });
      const objectId=await page.evaluate(()=>window.__socketRecovery.getInitialStateFromWindow().providerTargets.page);
      const dropped=await server.fetch('/api/rpc-check/socket?disconnect='+encodeURIComponent(objectId),{method:'POST',headers:{cookie:sessionCookie}});
      expect(await dropped.json()).toEqual({closed:1});
      // Release held I/O after the server starts the real close handshake.
      expect((await server.fetch('/api/rpc-check/socket?id='+ids[0],{method:'POST',headers:{cookie:sessionCookie}})).status).toBe(200);
      await page.waitForFunction(expected=>window.__socketRecovery.failures.length===expected,old+ids.length);
      await browserExpect(page.locator('#socket-loading')).toHaveText('0');
      expect(await page.evaluate(()=>window.__socketRecovery.failures.slice(-2))).toEqual(
        Array(Math.min(old+ids.length,2)).fill('COSSACK_RPC_TRANSPORT_CLOSED'));
      await expect.poll(async()=> (await audit()).operations.filter(row=>ids.includes(row.id)&&row.settled===1).length).toBe(1);
      await page.evaluate(()=>{const host=window.__socketRecovery;host.beforeEvictionSocket=host.websockets.get('page');});
      await server.getWorker().evictDurableObject('COSSACK_OBJECT',{id:objectId,webSockets:'close'});
      await page.waitForFunction(()=>{
        const host=window.__socketRecovery;
        return host.websockets.get('page')!==host.beforeEvictionSocket&&host.realtime.websockets.page.state==='open';
      });
      await browserExpect(page.locator('#socket-count')).toHaveText(String(before.count+1));
      await browserExpect(page.locator('#socket-draft')).toHaveText('keep this draft');
      expect(frames.filter(frame=>frame.type==='action').length-callsBefore).toBe(ids.length);
      expect(received.filter(frame=>requestIds.includes(frame.requestId)&&['done','error'].includes(frame.type))).toHaveLength(0);
      expect((await audit()).count).toBe(before.count+1);
      expect((await audit()).operations.filter(row=>ids.includes(row.id))).toHaveLength(1);
      expect(errors).toEqual([]);
    }
    for(const cancel of [false,true]) {
      const id=cancel?'stream-cancel':'stream-error', before=await audit();
      const old=await page.evaluate(()=>window.__socketRecovery.failures.length);
      const framesBefore=frames.filter(frame=>frame.type==='action').length;
      await page.evaluate(id=>{void window.__socketRecovery.startStream(id);},id);
      await page.waitForFunction(id=>window.__socketRecovery.yields.includes(id),id);
      expect((await audit()).count).toBe(before.count+1);
      await browserExpect(page.locator('#socket-actor')).toHaveText('u1');
      await browserExpect(page.locator('#socket-loading')).toHaveText('1');
      if(cancel) await page.evaluate(()=>window.__socketRecovery.cancelStream());
      expect((await server.fetch('/api/rpc-check/socket?id='+id,{method:'POST',headers:{cookie:sessionCookie}})).status).toBe(200);
      await page.waitForFunction(expected=>window.__socketRecovery.failures.length===expected,old+1);
      expect(await page.evaluate(()=>window.__socketRecovery.failures.at(-1))).toBe(cancel?'COSSACK_RPC_CANCELLED':'COSSACK_RPC_CLIENT_ERROR');
      await browserExpect(page.locator('#socket-loading')).toHaveText('0');
      await expect.poll(async()=> (await audit()).operations.find(row=>row.id===id)?.settled).toBe(1);
      await browserExpect(page.locator('#socket-count')).toHaveText(String(before.count+1));
      await browserExpect(page.locator('#socket-draft')).toHaveText('keep this draft');
      expect(frames.filter(frame=>frame.type==='action').length-framesBefore).toBe(1);
      expect((await audit()).count).toBe(before.count+1);
      expect(errors).toEqual([]);
    }
    await context.close();
  } finally { await browser.close(); }
}
