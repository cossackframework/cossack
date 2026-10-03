import { describe, expect, it, vi } from 'vitest';
import { Hono, type Context } from 'hono';
import {HTTPException} from 'hono/http-exception';
import { createResourcePolicy, ResourceAuthorizationError } from '../src/index';

interface Actor { id: string; tenant: string; }
interface Post { id: number; owner: string; tenant: string; }
const owner = { id:'u1', tenant:'t1' };
const post = { id:1, owner:'u1', tenant:'t1' };
async function context(user: Actor | undefined = owner, signal?: AbortSignal) {
    let result!: Context;
    const app=new Hono<{Variables:{user:Actor|undefined}}>(); app.get('/', c=>{c.set('user',user);result=c;return new Response(null);});
    await app.fetch(new Request('http://localhost/',{signal})); return result;
}
const create = () => createResourcePolicy<Post,Actor>()({
    read: ({user,resource})=>user.tenant===resource.tenant,
    edit: ({user,resource})=>user.id===resource.owner && user.tenant===resource.tenant,
});
it('infers named actions and checks actual ownership/tenant against the request actor',async()=>{
    const policy=create(), c=await context();
    expect(policy.actions).toEqual(['read','edit']); expect(Object.isFrozen(policy.actions)).toBe(true);
    expect(await policy.authorize(c,'edit',post)).toBe(post);
    expect(await policy.can(c,'read',{...post,owner:'u2'})).toBe(true);
    expect(await policy.can(c,'edit',{...post,owner:'u2'})).toBe(false);
    expect(await policy.can(c,'edit',{...post,tenant:'other'})).toBe(false);
    expect(await policy.can(c,'edit',null)).toBe(false);
    expect(await policy.can(c,'constructor' as any,post)).toBe(false);
});
it('derives frozen boolean-only permissions for presentation',async()=>{
    const policy=create(), c=await context();
    const result=await policy.permissions(c,{...post,owner:'u2'});
    expect(result).toEqual({read:true,edit:false}); expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('owner');
    const guest=await context();guest.set('user',undefined);
    expect(await policy.permissions(guest,post)).toEqual({read:false,edit:false});
});
it.each([undefined, {...owner,id:'u2'}, {...owner,tenant:'other'}])('returns fixed correlated HTTP denials (%#)',async user=>{
    const policy=create(), c=await context(user);
    if(user===undefined)c.set('user',undefined);
    const failure=await policy.authorize(c,'edit',post).catch(error=>error);
    expect(failure).toBeInstanceOf(ResourceAuthorizationError);
    const response=failure.getResponse(); expect(response.status).toBe(user ? 403 : 401);
    expect(await response.json()).toMatchObject({code:user?'COSSACK_AUTH_FORBIDDEN':'COSSACK_AUTH_UNAUTHENTICATED',
        error:user?'Forbidden':'Authentication required',requestId:response.headers.get('X-Cossack-Request-Id')});
});
it('performs app-owned lookup with the parsed argument and trusted context',async()=>{
    const policy=create(), c=await context(), signal=new AbortController().signal;
    const lookup=vi.fn((value:{id:number}, options:{context:Context;signal:AbortSignal})=>{
        expect(options.context).toBe(c);expect(options.signal).toBe(signal);return value.id===1?post:undefined;
    });
    const gate=policy.action('edit',lookup);
    expect(await gate({id:1},{context:c,signal})).toBe(true);
    await expect(gate({id:2},{context:c,signal})).rejects.toMatchObject({authorizationCode:'COSSACK_AUTH_FORBIDDEN'});
    c.set('user',undefined); lookup.mockClear();
    await expect(gate({id:1},{context:c,signal})).rejects.toMatchObject({authorizationCode:'COSSACK_AUTH_UNAUTHENTICATED'});
    expect(lookup).not.toHaveBeenCalled();
});
it('snapshots policy callbacks instead of reading a mutable definition',async()=>{
    const rules={edit:()=>false};const policy=createResourcePolicy<Post,Actor>()(rules);
    rules.edit=()=>true; expect(await policy.can(await context(),'edit',post)).toBe(false);
});
it.each([1, 'allowed', undefined, null])('refuses nonboolean policy decisions (%#)',async answer=>{
    const policy=createResourcePolicy<Post,Actor>()({edit:()=>answer as any});
    await expect(policy.can(await context(),'edit',post)).rejects.toThrow(/boolean/);
});
it('keeps lookup/policy exceptions internal rather than changing them into a denial',async()=>{
    const failure=Error('PRIVATE_BACKEND');const c=await context();
    const policy=createResourcePolicy<Post,Actor>()({edit:()=>{throw failure;}});
    await expect(policy.can(c,'edit',post)).rejects.toMatchObject({message:'[Cossack Auth] Resource policy callback failed.',cause:failure});
    await expect(create().action('edit',()=>{throw failure;})({},{context:c,signal:c.req.raw.signal})).rejects.toMatchObject({message:'[Cossack Auth] Resource policy callback failed.',cause:failure});
});
it.each(['lookup','rule'])('keeps thrown HTTP exceptions private in middleware %s',async site=>{
    const failure=new HTTPException(418,{message:'PRIVATE_POLICY_HTTP'}),writes=vi.fn();
    const policy=createResourcePolicy<Post,Actor>()({edit:()=>{if(site==='rule')throw failure;return true;}});
    const app=new Hono<{Variables:{user:Actor}}>();
    app.onError((error,c)=>{expect(error).toMatchObject({cause:failure});return c.text('Internal Server Error',500);});
    app.use('*',async(c,next)=>{c.set('user',owner);await next();});
    app.post('/',policy.middleware('edit',()=>{if(site==='lookup')throw failure;return post;}),c=>{writes();return c.json({saved:true});});
    const response=await app.request('/',{method:'POST'});expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');expect(writes).not.toHaveBeenCalled();
});
it('cancels a stuck lookup before policy evaluation and observes its late failure',async()=>{
    const controller=new AbortController(), c=await context(); let fail!:(error:Error)=>void;
    const check=vi.fn(()=>true);const policy=createResourcePolicy<Post,Actor>()({edit:check});
    const gate=policy.action('edit',()=>new Promise<Post>((_resolve,reject)=>{fail=reject;}));
    const pending=gate({},{context:c,signal:controller.signal});const rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(fail).toBeTypeOf('function'));controller.abort();await rejection;
    expect(check).not.toHaveBeenCalled();fail(Error('PRIVATE_LATE_FAILURE'));await Promise.resolve();await Promise.resolve();
});
it('stops owning a pending policy check and skips later permission checks on abort',async()=>{
    const controller=new AbortController(), c=await context();let resolve!:(allowed:boolean)=>void;
    const after=vi.fn(()=>true);const policy=createResourcePolicy<Post,Actor>()({
        read:({signal})=>{expect(signal).toBe(controller.signal);return new Promise<boolean>(done=>{resolve=done;});},edit:after,
    });
    const pending=policy.permissions(c,post,{signal:controller.signal});const rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));controller.abort();await rejection;resolve(true);
    await Promise.resolve();await Promise.resolve();expect(after).not.toHaveBeenCalled();
});
it('does not start a lookup/check for an already cancelled request',async()=>{
    const controller=new AbortController();controller.abort();const lookup=vi.fn(()=>post), c=await context();
    await expect(create().action('edit',lookup)({},{context:c,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
    expect(lookup).not.toHaveBeenCalled();
});
describe('HTTP middleware composition',()=>{
    it.each([owner,undefined,{...owner,id:'other'},{...owner,tenant:'other'}])('enforces a resource before the HTTP write (%#)',async user=>{
        const app=new Hono<{Variables:{user:Actor|undefined}}>(), writes=vi.fn();const policy=create();const lookup=vi.fn(()=>post);
        app.use('*',async(c,next)=>{c.set('user',user);await next();});
        app.post('/posts/:id',policy.middleware('edit',lookup),c=>{writes();return c.json({saved:true});});
        const response=await app.request('/posts/1',{method:'POST',body:JSON.stringify({canEdit:true,owner:'u1',tenant:'t1'})});
        expect(response.status).toBe(user===owner?200:user?403:401);
        expect(writes).toHaveBeenCalledTimes(user===owner?1:0);expect(lookup).toHaveBeenCalledTimes(user?1:0);
    });
});
it.each([{}, {edit:1}, {constructor:()=>true}, {[Symbol('edit')]:()=>true}].map(rules=>({rules})))('rejects invalid action maps (%#)',({rules})=>{
    expect(()=>createResourcePolicy<Post,Actor>()(rules as any)).toThrow(/configuration/);
});
it('never invokes configuration accessors',()=>{
    const get=vi.fn(()=>()=>true);const rules=Object.defineProperty({},'edit',{enumerable:true,get});
    expect(()=>createResourcePolicy<Post,Actor>()(rules as any)).toThrow(/configuration/);expect(get).not.toHaveBeenCalled();
});
