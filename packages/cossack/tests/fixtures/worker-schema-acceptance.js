import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import { readRpcStream } from '../../../core/dist/index.js';

// Generated acceptance only: private read-only refinements use the real request
// and D1 scope. Mutation/audit writes occur exclusively after both RPC guards.
export async function writeWorkerSchemaAcceptance(root) {
  const write = async (name, source) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), source);
  };
  await write('src/schema-contract.ts', `
    import {input,getRequestContext,ClientVisibleError,ActionValidationError,type InputOf} from '@cossackframework/core';
    import {sql} from '@cossackframework/database';
    import {save} from './post-policy';
    const privateMarker='PRIVATE_SCHEMA_REFINEMENT_SENTINEL';
    export const contract=input.object({
      id:input.number({coerce:true,integer:true,min:1}),key:input.string({required:true}),
      profile:input.object({
        count:input.number({coerce:true,integer:true,min:1}),enabled:input.boolean({coerce:true}),
        strictNumber:input.number(),strictBoolean:input.boolean(),
      }).refine(async(value,{signal})=>{
        const c=getRequestContext()!;
        const row=await sql\`SELECT owner FROM policy_posts WHERE id=1\`;
        if(row.rows[0]?.owner!==c.get('user')?.id || !['/crpc','/upload'].includes(c.req.path))throw new Error(privateMarker);
        if(value.count===14)throw new Error(privateMarker);
        if(value.count===15)return 'invalid decision' as any;
        if(value.count===17)throw new ClientVisibleError(privateMarker);
        if(value.count===18)throw new ActionValidationError({secret:privateMarker});
        if(value.count===16)await new Promise<void>(resolve=>{
          signal!.addEventListener('abort',()=>resolve(),{once:true});
          if(signal!.aborted)resolve();
        });
        return value.count!==13;
      },'Disallowed count.'),
      when:input.date({coerce:true}),strictDate:input.date().optional(),
      status:input.enum(['draft','published']),kind:input.literal('record'),
      note:input.string().optional(),nullable:input.string().nullable(),
      tags:input.array(input.enum(['small','large']),{maxItems:2}),
      file:input.file({maxBytes:16}).optional(),
    });
    export type Data=InputOf<typeof contract>;
    export async function persist(value:Data){
      const id=await save(value);
      return {id,count:value.profile.count,enabled:value.profile.enabled,
        strictNumber:value.profile.strictNumber,strictBoolean:value.profile.strictBoolean,
        whenIsDate:value.when instanceof Date,when:value.when,note:value.note,
        nullable:value.nullable,status:value.status,kind:value.kind,tags:value.tags,
        fileName:value.file?.name};
    }
  `);
  await write('src/services/SchemaActions.ts', `
    import {CossackService,Service,createTypedDecorators,ClientVisibleError} from '@cossackframework/core';
    import {contract,persist,type Data} from '../schema-contract';
    import {policy,lookup} from '../post-policy';
    const channel=createTypedDecorators<{Channels:'team'}>();
    @Service()export class SchemaActions extends CossackService{
      @channel.Server({input:contract,authorize:policy.action('edit',lookup)})
      edit=(value:Data)=>persist(value);
      @channel.Server({input:contract,authorize:()=>{throw new ClientVisibleError('PRIVATE_PUBLIC_POLICY_EXCEPTION');}})
      policyException=(value:Data)=>persist(value);
      @channel.Server({input:contract,authorize:policy.action('edit',lookup)})
      stream=async function*(value:Data){yield {count:value.profile.count};return await persist(value);};
    }
  `);
  await write('src/pages/rpc-policy/schema/layout.ts', `
    import {Cossack,Page} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    import {SchemaActions} from '../../../services/SchemaActions';
    @Page({services:[SchemaActions]})export default class SchemaLayout extends Cossack{render(){return html\`\${this.children}\`;}}
  `);
  for(const transport of ['http','sse'])await write(`src/pages/rpc-policy/schema/${transport}/index.ts`, `
    import {Cossack,Page,Server,Client,ClientState,Inject,rpc$,ClientVisibleError} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    import {contract,persist,type Data} from '../../../../schema-contract';
    import {policy,lookup} from '../../../../post-policy';
    import {SchemaActions} from '../../../../services/SchemaActions';
    @Page({transport:'${transport}'})export default class SchemaPage extends Cossack{
      @Inject(SchemaActions) actions!:SchemaActions;
      @ClientState() count='13';@ClientState() result='';@ClientState() failure='';
      @Server({input:contract,authorize:policy.action('edit',lookup)})
      edit=(value:Data)=>persist(value);
      @Server({input:contract,authorize:()=>{throw new ClientVisibleError('PRIVATE_PUBLIC_POLICY_EXCEPTION');}})
      policyException=(value:Data)=>persist(value);
      @Server({input:contract,authorize:policy.action('edit',lookup)})
      stream=async function*(value:Data){yield {count:value.profile.count};return await persist(value);};
      @Client()async submit(service=false){
        this.failure='';this.result='';
        const value:Data={id:1,key:'browser-schema-${transport}-'+service,
          profile:{count:Number(this.count),enabled:false,strictNumber:2,strictBoolean:true},
          when:new Date('2026-10-03T00:00:00.000Z'),status:'draft',kind:'record',nullable:null,tags:['small']};
        try{const result=await(service?rpc$(this.actions.edit(value)):rpc$(this.edit(value)));
          this.result=result.count+'/'+result.enabled+'/'+result.whenIsDate;
        }catch(error){const fields=(error as {fieldErrors?:{profile?:string}}).fieldErrors;
          this.failure=fields?.profile??'Unexpected failure';}
      }
      render(){return html\`<main><input aria-label="Count" .value=\${this.count} @input=\${e=>this.count=e.target.value}>
        <button @click=\${()=>this.submit()}>Save page schema</button><button @click=\${()=>this.submit(true)}>Save service schema</button>
        <output role="status">\${this.result}</output><p role="alert">\${this.failure}</p></main>\`;}
    }
  `);
}

export async function checkWorkerSchemaAcceptance(server,serverUrl,cookie,readHydration){
  const headers={origin:serverUrl.origin,cookie};
  const when='2026-10-03T00:00:00.000Z';
  const correlation=response=>{
    const requestId=response.headers.get('X-Cossack-Request-Id');
    expect(requestId).toEqual(expect.any(String));expect(requestId.length).toBeGreaterThan(0);return requestId;
  };
  const valid=key=>({id:'1',key,profile:{count:'3',enabled:'false',strictNumber:2,strictBoolean:true},
    when,status:'draft',kind:'record',nullable:null,tags:['small']});
  const rows=async()=> (await server.fetch('/api/rpc-policy/setup',{headers})).json();
  const audit=async key=>(await server.fetch('/api/rpc-check?key='+encodeURIComponent(key),{headers})).json();
  for(const transport of ['http','sse']){
    const state=readHydration(await(await server.fetch('/rpc-policy/schema/'+transport,{headers})).text());
    const owner=state._layout_stack.at(-1).componentRouteId;
    for(const service of [false,true])for(const upload of [false,true]){
      const invoke=(value,{stream=false,cancel=false,policyException=false,extraArgs=[]}={})=>{
        const envelope={componentRouteId:state.componentRouteId,scopeKey:state.scopeKey,
          ...(service?{service:{ownerRouteId:owner,slot:'0'},pageParams:state.metadata.params}:{}),action:policyException?'policyException':stream?'stream':'edit',
          state:{canEdit:true,user:{id:'u1'}},payload:[value,...extraArgs]};
        const cancellation=cancel?{'X-Counter-Abort':'explicit'}:{};
        if(upload){
          value.file={_cossack_file_id:'file_0'};const form=new FormData();
          for(const[name,value]of Object.entries(envelope))form.set(name,typeof value==='string'?value:JSON.stringify(value));
          form.set('file_0',new File(['ok'],'schema.txt'));
          return fetch(new URL('/upload',serverUrl),{method:'POST',headers:{...headers,...cancellation},body:form});
        }
        return server.fetch('/crpc',{method:'POST',headers:{...headers,...cancellation,'Content-Type':'application/json'},body:JSON.stringify(envelope)});
      };
      const cases=[
        [value=>value.profile.count='NaN',{profile:{count:'Expected a safe integer.'}}],
        [value=>value.profile.count='1.5',{profile:{count:'Expected a safe integer.'}}],
        [value=>value.profile.enabled='maybe',{profile:{enabled:'Expected a boolean.'}}],
        [value=>value.profile.strictNumber='2',{profile:{strictNumber:'Expected a finite number.'}}],
        [value=>value.profile.strictBoolean='true',{profile:{strictBoolean:'Expected a boolean.'}}],
        [value=>value.when='2026-02-30T00:00:00.000Z',{when:'Expected a valid date.'}],
        [value=>value.when='2026-10-03',{when:'Expected a valid date.'}],
        [value=>value.strictDate=when,{strictDate:'Expected a valid date.'}],
        [value=>value.status='admin',{status:'Unexpected value.'}],
        [value=>value.kind='owner',{kind:'Unexpected value.'}],
        [value=>value.note=null,{note:'Expected a string.'}],
        [value=>delete value.nullable,{nullable:'Expected a string.'}],
        [value=>value.tags=['small','invalid'],{tags:{1:'Unexpected value.'}}],
        [value=>value.profile.canEdit=true,{profile:{canEdit:'Unknown field.'}}],
        [value=>value.canEdit=true,{canEdit:'Unknown field.'}],
        [value=>value.profile.count='13',{profile:'Disallowed count.'}],
      ];
      for(const[index,[change,fieldErrors]]of cases.entries()){
        const key=`schema-invalid-${transport}-${service}-${upload}-${index}`,value=valid(key);
        change(value);const before=await rows();const response=await invoke(value);
        expect(response.status,key).toBe(400);
        expect(await response.json(),key).toMatchObject({code:'COSSACK_VALIDATION_FAILED',fieldErrors,
          requestId:correlation(response)});
        expect(await audit(key),key).toEqual([]);expect(await rows(),key).toEqual(before);
      }
      for(const count of ['14','15','17','18','20']){
        const key=`schema-private-${transport}-${service}-${upload}-${count}`,value=valid(key);
        value.profile.count=count;const before=await rows();const response=await invoke(value,{policyException:count==='20'});
        expect(response.status,key).toBe(500);
        const body=await response.json();expect(body,key).toMatchObject({code:'COSSACK_RPC_INTERNAL_ERROR',error:'Internal Server Error',
          requestId:correlation(response)});
        expect(JSON.stringify(body)).not.toContain('PRIVATE_');expect(body).not.toHaveProperty('fieldErrors');expect(body).not.toHaveProperty('stack');
        expect(await audit(key)).toEqual([]);expect(await rows()).toEqual(before);
      }
      const extraKey=`schema-extra-${transport}-${service}-${upload}`;
      const excess=await invoke(valid(extraKey),{extraArgs:['forged']});expect(excess.status).toBe(400);
      expect(await excess.json()).toMatchObject({code:'COSSACK_VALIDATION_FAILED',fieldErrors:{_:'This action accepts one input argument.'}});
      expect(await audit(extraKey)).toEqual([]);
      const key=`schema-valid-${transport}-${service}-${upload}`;
      const response=await invoke(valid(key));expect(response.status,key).toBe(200);
      expect((await response.json())._cossack_return).toEqual({id:1,count:3,enabled:false,strictNumber:2,strictBoolean:true,
        whenIsDate:true,when,nullable:null,status:'draft',kind:'record',tags:['small'],...(upload?{fileName:'schema.txt'}:{})});
      expect(await audit(key)).toEqual([{kind:'policy',path:upload?'/upload':'/crpc',user:'u1'}]);
      const streamKey=key+'-stream';const stream=await invoke(valid(streamKey),{stream:true});expect(stream.status).toBe(200);
      const frames=[];for await(const frame of readRpcStream(stream))frames.push(frame);
      expect(frames[0]).toMatchObject({type:'yield',value:{count:3}});
      expect(frames.at(-1)).toMatchObject({type:'done',value:{id:1,count:3,enabled:false,whenIsDate:true,when}});
      expect(await audit(streamKey)).toEqual([{kind:'policy',path:upload?'/upload':'/crpc',user:'u1'}]);
      const cancelledKey=key+'-cancelled',waiting=valid(cancelledKey);waiting.profile.count='16';
      const before=await rows();const cancelled=await invoke(waiting,{cancel:true});expect(cancelled.status).toBe(499);
      expect(await cancelled.json()).toMatchObject({code:'COSSACK_RPC_CANCELLED',requestId:correlation(cancelled)});
      expect(await audit(cancelledKey)).toEqual([]);expect(await rows()).toEqual(before);
      // A successor proves the request/SSE queue can advance after refinement abort.
      const successor=await invoke(valid(key+'-next'));expect(successor.status).toBe(200);await successor.json();
      expect(await audit(cancelledKey)).toEqual([]);
    }
  }
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext();const[name,value]=cookie.split(';')[0].split('=');
    await context.addCookies([{name,value,url:serverUrl.origin}]);const page=await context.newPage();
    for(const transport of ['http','sse'])for(const service of [false,true]){
      await page.goto(serverUrl.origin+'/rpc-policy/schema/'+transport);
      await page.waitForFunction(()=>window.__cossackReady===true);
      const key='browser-schema-'+transport+'-'+service,button=page.getByRole('button',{name:service?'Save service schema':'Save page schema'});
      const before=await rows();await button.click();await browserExpect(page.getByRole('alert')).toHaveText('Disallowed count.');
      expect(await audit(key)).toEqual([]);expect(await rows()).toEqual(before);
      await page.getByRole('textbox',{name:'Count'}).fill('3');await button.click();
      await browserExpect(page.getByRole('status')).toHaveText('3/false/true');await browserExpect(page.getByRole('alert')).toBeEmpty();
      expect(await audit(key)).toEqual([{kind:'policy',path:'/crpc',user:'u1'}]);
    }
    await context.close();
  }finally{await browser.close();}
}
