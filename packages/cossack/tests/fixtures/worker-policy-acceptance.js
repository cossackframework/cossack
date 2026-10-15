import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';

export async function writeWorkerPolicyAcceptance(root) {
  const write = async (name, source) => {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, source);
  };
  await write('src/post-policy.ts', `
    import { createResourcePolicy } from '@cossackframework/auth';
    import { input, getRequestContext } from '@cossackframework/core';
    import { sql } from '@cossackframework/database';
    interface Post {id:number;owner:string;tenant:string;version:number;}
    interface Actor {id:string;tenant:string;}
    const privateMarker = 'PRIVATE_RESOURCE_POLICY_SENTINEL';
    export const policy = createResourcePolicy<Post,Actor>()({
      read: ({user,resource})=>user.tenant===resource.tenant,
      edit: ({user,resource})=>user.id!==privateMarker && user.id===resource.owner && user.tenant===resource.tenant,
    });
    export async function lookup(value:{id:number}):Promise<Post|undefined> {
      const result=await sql<Post>\`SELECT * FROM policy_posts WHERE id=\${value.id}\`;
      return result.rows[0];
    }
    export const jsonInput=input.object({id:input.number({coerce:true,integer:true,min:1}),key:input.string({required:true})});
    export const fileInput=input.object({id:input.number({coerce:true,integer:true,min:1}),key:input.string({required:true}),file:input.file({maxBytes:16})});
    export async function save(value:{id:number;key:string}) {
      const c=getRequestContext()!,user=c.get('user') as Actor;
      // Repeat ownership predicates in the write to avoid a lookup/write race.
      const updated=await sql\`UPDATE policy_posts SET version=version+1 WHERE id=\${value.id} AND owner=\${user.id} AND tenant=\${user.tenant}\`;
      if(updated.meta.rowsAffected!==1) throw new Error('Record changed during mutation');
      await sql\`INSERT INTO rpc_audit VALUES (\${value.key}, 'policy', \${c.req.path}, \${user.id})\`;
      return value.id;
    }
  `);
  await write('src/services/PostActions.ts', `
    import {CossackService,Service,Server} from '@cossackframework/core';
    import {policy,lookup,jsonInput,fileInput,save} from '../post-policy';
    @Service() export class PostActions extends CossackService {
      @Server({input:jsonInput,authorize:policy.action('edit',lookup)})
      edit(value:{id:number;key:string}) {return save(value);}
      @Server({input:fileInput,authorize:policy.action('edit',lookup)})
      async upload(value:{id:number;key:string;file:File}) {await save(value);return value.file.name;}
    }
  `);
  await write('src/pages/rpc-policy/layout.ts', `
    import {Cossack,Page} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    import {PostActions} from '../../services/PostActions';
    @Page({services:[PostActions]}) export default class PolicyLayout extends Cossack {render(){return html\`\${this.children}\`;}}
  `);
  for (const transport of ['http', 'sse']) {
    await write(`src/pages/rpc-policy/${transport}/index.ts`, `
      import {Cossack,Page,Server,Client,ClientState,State,Inject,rpc$} from '@cossackframework/core';
      import {html} from '@cossackframework/renderer';
      import {PostActions} from '../../../services/PostActions';
      import {policy,lookup,jsonInput,fileInput,save} from '../../../post-policy';
      @Page({transport:'${transport}'}) export default class PolicyPage extends Cossack {
        @Inject(PostActions) posts!:PostActions;
        @State() permissions={read:false,edit:false};
        @ClientState() result='';
        async init(){this.permissions=await policy.permissions(this.c,await lookup({id:1}));}
        @Server({input:jsonInput,authorize:policy.action('edit',lookup)})
        edit(value:{id:number;key:string}) {return save(value);}
        @Server({input:fileInput,authorize:policy.action('edit',lookup)})
        async upload(value:{id:number;key:string;file:File}) {await save(value);return value.file.name;}
        @Client() async submit(){this.result=String(await rpc$(this.edit({id:1,key:'browser-policy-${transport}'})));}
        render(){return html\`<main>\${this.permissions.edit?html\`<button @click=\${this.submit}>Edit owned record</button>\`:''}<output role="status">\${this.result}</output></main>\`;}
      }
    `);
  }
  await write('src/pages/api/rpc-policy/setup.ts', `
    import {sql} from '@cossackframework/database';
    export const POST=async c=>{
      if(!c.get('user'))return c.text('Test authentication required',401);
      await sql\`CREATE TABLE IF NOT EXISTS policy_posts (id INTEGER PRIMARY KEY,owner TEXT,tenant TEXT,version INTEGER)\`;
      await sql\`INSERT OR IGNORE INTO policy_posts VALUES (1,'u1','t1',0),(2,'u2','t1',0),(3,'u1','t2',0)\`;
      return c.json({ready:true});
    };
    export const GET=async c=>c.json((await sql\`SELECT * FROM policy_posts ORDER BY id\`).rows);
  `);
  await write('src/pages/api/rpc-policy/[id]/index.ts', `
    import {Cossack,Page} from '@cossackframework/core';
    import {policy,lookup,save} from '../../../../post-policy';
    @Page() export default class PolicyApi extends Cossack {
      async get(){return this.c.json(await policy.authorize(this.c,'read',await lookup({id:Number(this.c.req.param('id'))})));}
      async post(){
        // This API owns its body parsing. Client permission fields never grant access.
        await this.c.req.json();
        const id=Number(this.c.req.param('id'));await policy.authorize(this.c,'edit',await lookup({id}));
        return this.c.json({saved:await save({id,key:'api-policy-'+id})});
      }
    }
  `);
  await write('src/pages/rpc-policy/record/[id]/index.ts', `
    import {Cossack,Page,State} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    import {policy,lookup} from '../../../../post-policy';
    @Page() export default class RecordPage extends Cossack {
      @State() title=''; @State() permissions={read:false,edit:false};
      async init(){const post=await policy.authorize(this.c,'read',await lookup({id:Number(this.c.req.param('id'))}));this.permissions=await policy.permissions(this.c,post);this.title='Owned record '+post.id;}
      render(){return html\`<h1>\${this.title}</h1>\${this.permissions.edit?html\`<button>Edit owned record</button>\`:''}\`;}
    }
  `);
}

export async function checkWorkerPolicyAcceptance(server, serverUrl, cookie, readHydration) {
  const headers = { origin:serverUrl.origin, cookie };
  const json=async(response,label)=>{
    const body=await response.text();
    try{return JSON.parse(body);}catch{throw new Error(`${label}: ${response.status} ${body.slice(0,1000)}`);}
  };
  const setup=await server.fetch('/api/rpc-policy/setup',{method:'POST',headers});
  expect(setup.status).toBe(200);expect(await json(setup,'policy setup')).toEqual({ready:true});
  const rows = async () => json(await server.fetch('/api/rpc-policy/setup',{headers}),'policy rows');
  const audit = async key => json(await server.fetch('/api/rpc-check?key='+encodeURIComponent(key),{headers}),'policy audit '+key);
  for (const transport of ['http','sse']) {
    const state=readHydration(await (await server.fetch('/rpc-policy/'+transport,{headers})).text());
    const owner=state._layout_stack.at(-1).componentRouteId;
    const anonymous=readHydration(await (await server.fetch('/rpc-policy/'+transport)).text());
    expect(state.public.permissions).toEqual({read:true,edit:true});expect(anonymous.public.permissions).toEqual({read:false,edit:false});
    for (const service of [false,true]) for(const upload of [false,true]) {
      const invoke=async(id,key,authenticated=true,extra={})=>{
        const initial=authenticated?state:anonymous;
        const payload={id,key,...extra};
        const envelope={componentRouteId:initial.componentRouteId,scopeKey:initial.scopeKey,
          ...(service?{service:{ownerRouteId:owner,slot:'0'},pageParams:initial.metadata.params}:{}),action:upload?'upload':'edit',
          state:{permissions:{edit:true},owner:'u1',user:{id:'u1',tenant:'t1'}},payload:[payload]};
        if(upload){
          payload.file={_cossack_file_id:'file_0'};const form=new FormData();
          for(const [name,value] of Object.entries(envelope)) form.set(name,typeof value==='string'?value:JSON.stringify(value));
          form.set('file_0',new File(['ok'],'policy.txt'));
          return fetch(new URL('/upload',serverUrl),{method:'POST',headers:authenticated?headers:{origin:serverUrl.origin},body:form});
        }
        return server.fetch('/crpc',{method:'POST',headers:{...(authenticated?headers:{origin:serverUrl.origin}),'Content-Type':'application/json'},body:JSON.stringify(envelope)});
      };
      for (const [id,authenticated,status] of [[2,true,403],[3,true,403],[9,true,403],[1,false,401]]) {
        const key=`denied-${transport}-${service}-${upload}-${id}-${authenticated}`;
        const before=await rows();const response=await invoke(id,key,authenticated);
        expect(response.status).toBe(status);
        expect(await json(response,key)).toMatchObject({code:status===401?'COSSACK_AUTH_UNAUTHENTICATED':'COSSACK_AUTH_FORBIDDEN',requestId:response.headers.get('X-Cossack-Request-Id')});
        expect(await audit(key)).toEqual([]);expect(await rows()).toEqual(before);
      }
      const key=`policy-${transport}-${service}-${upload}`;
      const rejected=await invoke(1,key,true,{owner:'u1',canEdit:true});expect(rejected.status).toBe(400);
      expect(await json(rejected,key+' invalid')).toMatchObject({code:'COSSACK_VALIDATION_FAILED'});expect(await audit(key)).toEqual([]);
      const response=await invoke('1',key);expect(response.status).toBe(200);
      expect(await json(response,key)).toMatchObject({_cossack_return:upload?'policy.txt':1});
      expect(await audit(key)).toEqual([{kind:'policy',path:upload?'/upload':'/crpc',user:'u1'}]);
    }
  }
  for(const id of [2,3,9]){
    const before=await rows();const response=await server.fetch('/api/rpc-policy/'+id,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({canEdit:true,owner:'u1'})});
    expect(response.status).toBe(403);
    expect(await json(response,'API denial '+id)).toMatchObject({code:'COSSACK_AUTH_FORBIDDEN',error:'Forbidden',requestId:response.headers.get('X-Cossack-Request-Id')});
    expect(await audit('api-policy-'+id)).toEqual([]);expect(await rows()).toEqual(before);
  }
  const accepted=await server.fetch('/api/rpc-policy/1',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
  expect(accepted.status).toBe(200);expect(await json(accepted,'API accepted')).toEqual({saved:1});
  for(const path of ['/api/rpc-policy/3','/rpc-policy/record/3']){
    const denied=await server.fetch(path,{headers});expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({code:'COSSACK_AUTH_FORBIDDEN',requestId:denied.headers.get('X-Cossack-Request-Id')});
  }
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext();const [name,value]=cookie.split(';')[0].split('=');
    await context.addCookies([{name,value,url:serverUrl.origin}]);const page=await context.newPage();
    for(const id of [1,2]){
      await page.goto(serverUrl.origin+'/rpc-policy/record/'+id);
      await browserExpect(page.getByRole('button',{name:'Edit owned record'})).toHaveCount(id===1?1:0);
    }
    for(const transport of ['http','sse']){
      await page.goto(serverUrl.origin+'/rpc-policy/'+transport);
      await page.waitForFunction(()=>window.__cossackReady===true);
      await page.getByRole('button',{name:'Edit owned record'}).click();
      await browserExpect(page.getByRole('status')).toHaveText('1');
      expect(await audit('browser-policy-'+transport)).toEqual([{kind:'policy',path:'/crpc',user:'u1'}]);
    }
    await context.close();
  } finally {await browser.close();}
}
