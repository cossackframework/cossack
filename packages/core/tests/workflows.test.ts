// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createLocalWorkflowProvider, createWorkflowClient, defineWorkflow, workflowData, type WorkflowProvider } from '../src/workflows';
const number = { async parse(value: unknown) { if (typeof value !== 'number') throw new Error('PRIVATE_SCHEMA_VALUE'); return value; } };
const boolean = { async parse(value: unknown) { if (typeof value !== 'boolean') throw new Error('PRIVATE_EVENT_VALUE'); return value; } };
function fixture(run: () => Promise<null> = vi.fn(async () => null)) { const definition = defineWorkflow({ name: 'approval', version: 1, schema: number, events: { approved: boolean }, run }); const provider = createLocalWorkflowProvider(definition, { env: {} }); return { definition, provider, client: createWorkflowClient(definition, provider, { namespace: 'app' }) }; }
it('keeps deterministic identity isolated by version/namespace/tenant/actor/key, and never dispatches duplicates', async () => {
 const run=vi.fn(async()=>null),f=fixture(run),id=await f.client.invoke(1,{key:'one',scope:{tenantId:'a',actorId:'user'}});
 await expect(f.client.invoke(2,{key:'one',scope:{tenantId:'a',actorId:'user'}})).rejects.toMatchObject({code:'WORKFLOW_DUPLICATE'});
 const other=await f.client.invoke(1,{key:'one',scope:{tenantId:'b',actorId:'user'}});expect(other.id).not.toBe(id.id);
 await vi.waitFor(()=>expect(run).toHaveBeenCalledTimes(2));expect((await f.client.inspect(id)).durability).toBe('process');
});
it('retries only the failed step, reports waiting, validates external events and completes once', async () => {
 let first=0,retries=0,last=0;
 const definition=defineWorkflow({name:'approval',version:1,schema:number,events:{approved:boolean},async run(input,{step}){
 await step.do('first',()=>{first++;return input;});await step.do('retry',()=>{if(++retries===1)throw new Error('PRIVATE_RETRY');return retries;},{retries:{limit:1,delay:0}});
 const approved=await step.waitForEvent('decision','approved');await step.do('last',()=>{last++;return approved;});return approved;
 }});
 const provider=createLocalWorkflowProvider(definition,{env:{}}),client=createWorkflowClient(definition,provider,{namespace:'app'}),id=await client.invoke(1,{key:'one'});
 await vi.waitFor(async()=>expect((await client.inspect(id)).status).toBe('waiting'));
 await expect(client.sendEvent(id,'approved','secret' as unknown as boolean)).rejects.toMatchObject({code:'WORKFLOW_EVENT_INVALID',message:'The workflow operation could not be completed.'});
 expect(last).toBe(0);await client.sendEvent(id,'approved',true);await vi.waitFor(async()=>expect((await client.inspect(id)).status).toBe('complete'));
 expect({first,retries,last}).toEqual({first:1,retries:2,last:1});
});
it('preserves waiting across local pause/resume and stops later work when terminated', async () => {
 const effects=vi.fn();const definition=defineWorkflow({name:'pause',version:1,schema:number,events:{approved:boolean},async run(_input,{step}){await step.waitForEvent('gate','approved');await step.do('effect',()=>{effects();return null;});return null;}});
 const client=createWorkflowClient(definition,createLocalWorkflowProvider(definition,{env:{}}),{namespace:'app'}),id=await client.invoke(1,{key:'paused'});
 await vi.waitFor(async()=>expect((await client.inspect(id)).status).toBe('waiting'));await client.pause(id);expect((await client.inspect(id)).status).toBe('paused');await client.resume(id);expect((await client.inspect(id)).status).toBe('waiting');await client.terminate(id);
 await vi.waitFor(async()=>expect((await client.inspect(id)).status).toBe('terminated'));expect(effects).not.toHaveBeenCalled();
});
it('redacts failures and performs authorization before provider access or publication', async () => {
 const f=fixture(async()=>{throw new Error('PRIVATE_FAILURE_SECRET');}),id=await f.client.invoke(1,{key:'fail'});
 await vi.waitFor(async()=>expect((await f.client.inspect(id)).status).toBe('failed'));expect(JSON.stringify(await f.client.inspect(id))).not.toContain('PRIVATE_FAILURE');
 const provider:WorkflowProvider={durability:'durable',create:vi.fn(),inspect:vi.fn(),sendEvent:vi.fn(),control:vi.fn()};const client=createWorkflowClient(f.definition,provider,{namespace:'app',authorize(){throw new Error('Denied');}});
 await expect(client.invoke(1,{key:'denied'})).rejects.toThrow('Denied');await expect(client.inspect(id)).rejects.toThrow('Denied');await expect(client.sendEvent(id,'approved',true)).rejects.toThrow('Denied');expect(provider.create).not.toHaveBeenCalled();expect(provider.inspect).not.toHaveBeenCalled();expect(provider.sendEvent).not.toHaveBeenCalled();
});
it('rejects unsafe input before schema/provider effects without invoking getters/toJSON/map', async () => {
 const effect=vi.fn(),f=fixture(effect);const getter=vi.fn(()=>123),toJSON=vi.fn(()=>[]);class Unsafe extends Array {toJSON=toJSON;}
 const array=[1];Object.defineProperty(array,'0',{get:getter,enumerable:true});
 for(const value of [array,new Unsafe(1),Object.assign([1],{extra:true}),Object.defineProperty({},'hidden',{value:1})]){expect(()=>workflowData(value)).toThrow();await expect(f.client.invoke(value as unknown as number,{key:'unsafe'})).rejects.toMatchObject({code:'WORKFLOW_INPUT_INVALID'});}
 expect(getter).not.toHaveBeenCalled();expect(toJSON).not.toHaveBeenCalled();expect(effect).not.toHaveBeenCalled();
});
it('enforces declared event names, schema input and scoped identity ownership', async()=>{
 const f=fixture();await expect(f.client.invoke('PRIVATE' as unknown as number,{key:'bad'})).rejects.toMatchObject({code:'WORKFLOW_INPUT_INVALID'});const id=await f.client.invoke(1,{key:'good'});
 await expect(f.client.sendEvent(id,'unknown' as 'approved',true)).rejects.toMatchObject({code:'WORKFLOW_EVENT_INVALID'});await expect(f.client.inspect({...id,namespace:'other'})).rejects.toMatchObject({code:'WORKFLOW_IDENTITY_INVALID'});
});
it('reports exhaustion and event timeout as redacted failure without later effects',async()=>{
 let attempts=0,late=0;const definition=defineWorkflow({name:'exhausted',version:1,schema:number,events:{approved:boolean},async run(_input,{step}){await step.do('retry',()=>{attempts++;throw new Error('PRIVATE_ATTEMPT');},{retries:{limit:2,delay:0}});late++;return null;}});
 const client=createWorkflowClient(definition,createLocalWorkflowProvider(definition,{env:{}}),{namespace:'app'}),id=await client.invoke(1,{key:'one'});await vi.waitFor(async()=>expect((await client.inspect(id)).status).toBe('failed'));expect(attempts).toBe(3);expect(late).toBe(0);
 const timeout=defineWorkflow({name:'timeout',version:1,schema:number,events:{approved:boolean},async run(_input,{step}){await step.waitForEvent('approval','approved',{timeout:5});late++;return null;}});const timed=createWorkflowClient(timeout,createLocalWorkflowProvider(timeout,{env:{}}),{namespace:'app'}),waiting=await timed.invoke(1,{key:'one'});await vi.waitFor(async()=>expect((await timed.inspect(waiting)).status).toBe('failed'));expect(late).toBe(0);
});
it('does not imply restart durability and rejects invalid step configurations before effects',async()=>{
 const effects=vi.fn();const definition=defineWorkflow({name:'bad-step',version:1,schema:number,events:{approved:boolean},async run(_input,{step}){await step.do('invalid',()=>{effects();return null;},{retries:{limit:-1,delay:0}});return null;}});const first=createWorkflowClient(definition,createLocalWorkflowProvider(definition,{env:{}}),{namespace:'app'}),id=await first.invoke(1,{key:'one'});await vi.waitFor(async()=>expect((await first.inspect(id)).status).toBe('failed'));expect(effects).not.toHaveBeenCalled();
 const restarted=createWorkflowClient(definition,createLocalWorkflowProvider(definition,{env:{}}),{namespace:'app'});await expect(restarted.inspect(id)).rejects.toMatchObject({code:'WORKFLOW_PROVIDER_UNAVAILABLE'});
});
// Compile-only public inference proof; these branches never dispatch workflows.
if(false){const f=fixture();const id={} as Awaited<ReturnType<typeof f.client.invoke>>;
 // @ts-expect-error input schema requires a number
 void f.client.invoke('bad',{key:'one'});
 // @ts-expect-error undeclared event
 void f.client.sendEvent(id,'missing',true);
 // @ts-expect-error declared approved event requires boolean
 void f.client.sendEvent(id,'approved',1);
}
it('produces native RPC plain records without prototype pollution or toJSON invocation',()=>{
 const data=JSON.parse('{"__proto__":{"polluted":true},"constructor":"safe","nested":{"value":1}}');const clone=workflowData(data) as Record<string,unknown>;
 expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);expect(Object.getPrototypeOf(clone.nested)).toBe(Object.prototype);expect(Object.hasOwn(clone,'__proto__')).toBe(true);expect(({} as {polluted?:boolean}).polluted).toBeUndefined();expect(JSON.stringify(clone)).toBe(JSON.stringify(data));
});
it.each([['constant',[10,10,10]],['linear',[10,20,30]],['exponential',[10,20,40]]] as const)('honors deterministic %s retry delays',async(backoff,expected)=>{
 let attempts=0;const sleep=vi.fn(async(_milliseconds:number,_signal:AbortSignal)=>{});const definition=defineWorkflow({name:'backoff',version:1,schema:number,events:{},async run(_input,{step}){return step.do('retry',()=>{if(++attempts<4)throw new Error('PRIVATE_RETRY');return attempts;},{retries:{limit:3,delay:10,backoff}});}});
 const client=createWorkflowClient(definition,createLocalWorkflowProvider(definition,{env:{},sleep}),{namespace:'app'}),id=await client.invoke(1,{key:'one'});await vi.waitFor(async()=>expect((await client.inspect(id)).status).toBe('complete'));expect(sleep.mock.calls.map(([ms])=>ms)).toEqual(expected);expect(attempts).toBe(4);
});
it('enforces step timeout, retires its timer, and does not run later steps after failure',async()=>{
 vi.useFakeTimers();try{let later=0;const definition=defineWorkflow({name:'deadline',version:1,schema:number,events:{},async run(_input,{step}){await step.do('stuck',async()=>new Promise<null>(()=>{}),{timeout:10});later++;return null;}});
 const client=createWorkflowClient(definition,createLocalWorkflowProvider(definition,{env:{}}),{namespace:'app'}),id=await client.invoke(1,{key:'one'});await vi.advanceTimersByTimeAsync(0);expect(vi.getTimerCount()).toBe(1);await vi.advanceTimersByTimeAsync(10);expect((await client.inspect(id)).status).toBe('failed');expect(later).toBe(0);expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
it.each(['sleep','event','retry','callback'] as const)('termination cancels pending %s timers and later effects',async kind=>{
 vi.useFakeTimers();try{let effects=0;const definition=defineWorkflow({name:'cancel',version:1,schema:number,events:{approved:boolean},async run(_input,{step}){
 if(kind==='sleep')await step.sleep('sleep',10000);else if(kind==='event')await step.waitForEvent('wait','approved',{timeout:10000});else if(kind==='callback')await step.do('callback',()=>new Promise<null>(()=>{}),{timeout:10000});else await step.do('retry',()=>{throw new Error('PRIVATE_RETRY');},{retries:{limit:1,delay:10000}});
 effects++;return null;}});
 const client=createWorkflowClient(definition,createLocalWorkflowProvider(definition,{env:{}}),{namespace:'app'}),id=await client.invoke(1,{key:'one'});await vi.advanceTimersByTimeAsync(0);expect(vi.getTimerCount()).toBe(1);await client.terminate(id);await vi.advanceTimersByTimeAsync(0);expect((await client.inspect(id)).status).toBe('terminated');expect(vi.getTimerCount()).toBe(0);expect(effects).toBe(0);
 }finally{vi.useRealTimers();}
});
