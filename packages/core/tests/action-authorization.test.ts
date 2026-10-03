// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { Hono, type Context } from 'hono';
import { Server } from '../src/shared/decorators';
import { input } from '../src/shared/input-schema';
import { enforceActionInput } from '../src/shared/action-input';
import { enforceActionAuthorization, getAuthorizationFailure } from '../src/shared/action-authorization';

async function context(){let value!:Context;const app=new Hono();app.get('/',c=>{value=c;return new Response(null);});await app.request('/');return value;}
const signal=()=>new AbortController().signal;
it('runs a typed callback on parsed values and authoritative context',async()=>{
    const c=await context();c.set('user',{id:'real'});const active=signal();
    const check=vi.fn((value:{id:number},options:any)=>{expect(value).toEqual({id:2});expect(options).toEqual({context:c,signal:active,action:'save'});return true;});
    class Actions { @Server({input:input.object({id:input.number({coerce:true})}),authorize:check}) save(value:{id:number}){return value;} }
    const parsed=await enforceActionInput(Actions,'save',[{id:'2'}]);
    await enforceActionAuthorization(Actions,'save',parsed,c,active);expect(check).toHaveBeenCalledTimes(1);
});
it('inherits policy metadata and distinguishes unguarded methods',async()=>{
    class Parent{@Server({authorize:()=>false})save(){} @Server()public(){}}
    class Child extends Parent{}
    await expect(enforceActionAuthorization(Child,'save',[],await context(),signal())).rejects.toMatchObject({code:'COSSACK_AUTH_FORBIDDEN',status:403});
    await enforceActionAuthorization(Child,'public',[],undefined,signal());
});
it.each([undefined,null,1,'allow',()=>1,()=>undefined])('rejects malformed metadata/decisions rather than granting access (%#)',async authorize=>{
    class Actions{save(){}}
    Server({authorize:authorize as any})(Actions.prototype,'save');
    await expect(enforceActionAuthorization(Actions,'save',[],await context(),signal())).rejects.toThrow(/contract|boolean/);
});
it('requires an authoritative request context for guarded actions',async()=>{
    class Actions{@Server({authorize:()=>true})save(){}}
    await expect(enforceActionAuthorization(Actions,'save',[],undefined,signal())).rejects.toThrow(/context/);
});
it('normalizes expected cross-package denials without forwarding an arbitrary message',async()=>{
    class Actions{@Server({authorize:()=>{throw {authorizationCode:'COSSACK_AUTH_UNAUTHENTICATED',message:'PRIVATE_MESSAGE'};}})save(){}}
    await expect(enforceActionAuthorization(Actions,'save',[],await context(),signal())).rejects.toMatchObject({code:'COSSACK_AUTH_UNAUTHENTICATED',status:401,message:'Authentication required'});
    expect(getAuthorizationFailure({authorizationCode:'typo',message:'PRIVATE'})).toBeUndefined();
});
it('keeps unexpected exceptions internal',async()=>{
    const failure=Error('PRIVATE');class Actions{@Server({authorize:()=>{throw failure;}})save(){}}
    await expect(enforceActionAuthorization(Actions,'save',[],await context(),signal())).rejects.toBe(failure);
});
it('does not execute exception accessors or fail redaction on hostile proxies',()=>{
    const getter=vi.fn(()=>{throw Error('PRIVATE_ACCESSOR');});
    const failure=Object.defineProperty({},'authorizationCode',{get:getter});
    expect(getAuthorizationFailure(failure)).toBeUndefined();expect(getter).not.toHaveBeenCalled();
    expect(getAuthorizationFailure(new Proxy({}, {getOwnPropertyDescriptor(){throw Error('PRIVATE_PROXY');}}))).toBeUndefined();
});
it('releases cancellation before a stuck callback settles and observes late rejection',async()=>{
    let fail!:(reason:Error)=>void;const controller=new AbortController();const c=await context();
    class Actions{@Server({authorize:()=>new Promise<boolean>((_resolve,reject)=>{fail=reject;})})save(){}}
    const pending=enforceActionAuthorization(Actions,'save',[],c,controller.signal);
    const rejection=expect(pending).rejects.toMatchObject({code:'COSSACK_RPC_CANCELLED'});
    await vi.waitFor(()=>expect(fail).toBeTypeOf('function'));controller.abort();await rejection;
    fail(Error('LATE_PRIVATE'));await Promise.resolve();await Promise.resolve();
});
