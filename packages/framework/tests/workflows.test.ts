import { expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers',()=>({WorkflowEntrypoint:class {constructor(_ctx:unknown,protected env:unknown){}}}));
import {createCloudflareWorkflowProvider} from '../src/workflows/provider';
import {createCloudflareWorkflow} from '../src/workflows';
import {defineWorkflow,createWorkflowClient} from '@cossackframework/core/workflows';
const schema={async parse(value:unknown){if(typeof value!=='number')throw new Error('PRIVATE_INPUT');return value;}};
it('maps only declared provider statuses and never exposes status errors/output',async()=>{
 const instance={status:vi.fn(async()=>({status:'errored',error:{message:'PRIVATE_PROVIDER'},output:'SECRET'})),sendEvent:vi.fn(),pause:vi.fn(),resume:vi.fn(),terminate:vi.fn()};
 const binding={create:vi.fn(),get:vi.fn(async()=>instance)},provider=createCloudflareWorkflowProvider(binding);
 expect(await provider.inspect('one')).toBe('failed');instance.status.mockResolvedValueOnce({status:'new-provider-state'} as never);expect(await provider.inspect('one')).toBe('unknown');
 instance.status.mockResolvedValueOnce({status:'constructor'} as never);expect(await provider.inspect('one')).toBe('unknown');
 instance.status.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER'));await expect(provider.inspect('one')).rejects.toMatchObject({code:'WORKFLOW_PROVIDER_UNAVAILABLE',message:'The workflow operation could not be completed.'});
 await provider.control('one','pause');await provider.control('one','resume');await provider.control('one','terminate');expect(instance.pause).toHaveBeenCalledOnce();expect(instance.resume).toHaveBeenCalledOnce();expect(instance.terminate).toHaveBeenCalledOnce();
});
it('delegates step/retry/wait durability to native and validates trusted envelope/event payloads',async()=>{
 const definition=defineWorkflow({name:'sample',version:1,schema,events:{approve:schema},async run(value,{step}){await step.do('first',()=>value,{retries:{limit:1,delay:10}});return step.waitForEvent('approval','approve');}});
 const binding={create:vi.fn(),get:vi.fn()};const client=createWorkflowClient(definition,createCloudflareWorkflowProvider(binding),{namespace:'app'});const identity=await client.invoke(3,{key:'one'});const envelope=binding.create.mock.calls[0][0].params;
 const Entry=createCloudflareWorkflow(definition),entry=new Entry({} as ExecutionContext,{});
 const native={do:vi.fn(async(_name:string,_options:unknown,callback:()=>Promise<unknown>)=>callback()),sleep:vi.fn(),waitForEvent:vi.fn(async()=>({payload:5}))};
 expect(await entry.run({instanceId:identity.id,payload:envelope} as never,native as never)).toBe(5);expect(native.do).toHaveBeenCalledWith('first',{retries:{limit:1,delay:10}},expect.any(Function));
 native.waitForEvent.mockResolvedValueOnce({payload:'PRIVATE_BAD_EVENT'} as never);await expect(entry.run({instanceId:identity.id,payload:envelope} as never,native as never)).rejects.toMatchObject({code:'WORKFLOW_EVENT_INVALID'});
 await expect(entry.run({instanceId:'forged',payload:envelope} as never,native as never)).rejects.toMatchObject({code:'WORKFLOW_IDENTITY_INVALID'});
});
it('invokes native RPC methods directly without Function.prototype call/apply/bind',async()=>{
 const definition=defineWorkflow({name:'rpc-method',version:1,schema,events:{},async run(value,{step}){return step.do('first',()=>value);}});
 const binding={create:vi.fn(),get:vi.fn()},client=createWorkflowClient(definition,createCloudflareWorkflowProvider(binding),{namespace:'app'});const identity=await client.invoke(9,{key:'one'}),envelope=binding.create.mock.calls[0][0].params;
 const entry=new (createCloudflareWorkflow(definition))({} as ExecutionContext,{});
 let calls=0;const native={do:new Proxy(async(_name:string,_config:unknown,callback:()=>Promise<unknown>)=>{calls++;return callback();},{get(target,key,receiver){if(['call','apply','bind'].includes(String(key)))throw new Error('Remote RPC method has no Function prototype');return Reflect.get(target,key,receiver);}}),sleep:vi.fn(),waitForEvent:vi.fn()};
 expect(await entry.run({instanceId:identity.id,payload:envelope} as never,native as never)).toBe(9);expect(calls).toBe(1);
});
