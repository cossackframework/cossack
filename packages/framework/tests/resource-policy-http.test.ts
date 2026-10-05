import 'reflect-metadata';
import { beforeEach, expect, it, vi } from 'vitest';
import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { createResourcePolicy } from '../../auth/src/index';

const { registry } = vi.hoisted(()=>({registry:{pages:{} as Record<string,unknown>,layouts:{},loadings:{}}}));
vi.mock('virtual:cossack-pages',()=>({default:registry}));
vi.mock('virtual:cossack-middlewares',()=>({default:[async(c:any,next:()=>Promise<void>)=>{
    c.set('user',c.env?.TEST_ACTOR); c.header('X-Cossack-Request-Id','policy-request'); await next();
}]}));
vi.mock('virtual:cossack-config',()=>({requirements:{},environment:null,default:{}}));

interface Actor {id:string;tenant:string;}
interface Post {id:number;owner:string;tenant:string;title:string;}
const post:Post={id:1,owner:'u1',tenant:'t1',title:'RESOURCE_PRIVATE_TITLE'};
const writes=vi.fn();
const kit=createResourcePolicy<Post,Actor>()({
    read:({user,resource})=>user.tenant===resource.tenant,
    edit:({user,resource})=>user.tenant===resource.tenant && user.id===resource.owner,
});
const lookup=(id:string|undefined)=>id==='1'?post:undefined;
@Page({transport:'http'})
class PostApi extends Cossack {
    async get(){const resource=await kit.authorize(this.c,'read',lookup(this.c.req.param('id')));return this.c.json({title:resource.title});}
    async post(){await kit.authorize(this.c,'edit',lookup(this.c.req.param('id')));writes();return this.c.json({saved:true});}
}
@Page({transport:'http'})
class PostPage extends Cossack {
    @State() title='';
    @State() permissions={read:false,edit:false};
    async init(){
        const resource=await kit.authorize(this.c,'read',lookup(this.c.req.param('id')));
        this.title=resource.title;this.permissions=await kit.permissions(this.c,resource);
    }
    render(){return html`<h1>${this.title}</h1>${this.permissions.edit?html`<button>Edit owned post</button>`:''}`;}
}
registry.pages['/src/pages/api/posts/[id]/index.ts']={default:PostApi};
registry.pages['/src/pages/posts/[id]/index.ts']={default:PostPage};
const {createApp}=await import('../src/router');
beforeEach(()=>writes.mockClear());

it.each([
    [{id:'u1',tenant:'t1'},200,200,true],
    [{id:'u2',tenant:'t1'},403,200,false],
    [{id:'u1',tenant:'t2'},403,403,false],
    [undefined,401,401,false],
] as const)('shares record policy across API writes, reads and SSR presentation (%#)',async(actor,writeStatus,readStatus,edit)=>{
    const app=createApp(), env={TEST_ACTOR:actor};
    const mutation=await app.request('/api/posts/1',{method:'POST',body:JSON.stringify({owner:'u1',canEdit:true})},env);
    expect(mutation.status).toBe(writeStatus);expect(writes).toHaveBeenCalledTimes(writeStatus===200?1:0);
    const api=await app.request('/api/posts/1',{},env);expect(api.status).toBe(readStatus);
    const page=await app.request('/posts/1',{},env);expect(page.status).toBe(readStatus);
    if(readStatus===200){
        expect(await api.json()).toEqual({title:post.title});const markup=await page.text();
        expect(markup).toContain(post.title);expect(markup.includes('Edit owned post')).toBe(edit);
    }
    for(const response of [mutation,api,page]){
        if(response.status<400)continue;
        expect(response.headers.get('X-Cossack-Request-Id')).toBe('policy-request');
        expect(await response.json()).toEqual({error:actor?'Forbidden':'Authentication required',
            code:actor?'COSSACK_AUTH_FORBIDDEN':'COSSACK_AUTH_UNAUTHENTICATED',requestId:'policy-request'});
    }
});
it('denies missing resources without running API writes or disclosing resource state',async()=>{
    const app=createApp(),env={TEST_ACTOR:{id:'u1',tenant:'t1'}};
    for(const [path,method] of [['/api/posts/9','POST'],['/api/posts/9','GET'],['/posts/9','GET']]){
        const response=await app.request(path,{method},env);expect(response.status).toBe(403);
        expect(await response.json()).toEqual({error:'Forbidden',code:'COSSACK_AUTH_FORBIDDEN',requestId:'policy-request'});
    }
    expect(writes).not.toHaveBeenCalled();
});
