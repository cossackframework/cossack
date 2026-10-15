import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

export async function writeNavigationOwnershipAcceptance(root) {
  const write = async (file, code) => {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, code);
  };
  // Test-only identity source. This is not an authentication example.
  await write('src/bootstrap/middlewares.ts', `export default [async(c,next)=>{
    const user={id:c.req.query('viewer')??'alice'};
    c.set('user',user);
    c.set('ownership.request',crypto.randomUUID());
    c.set('cossack.captureRealtimeIdentity',async()=>({version:1,provider:'fixture.session',data:{reference:user.id}}));
    await next();
  }];`);
  await write('src/Ownership.ts', `
    import {Cossack,CossackService,Service,State,ClientStore,Client} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    @Service() export class RootService extends CossackService {
      marker=crypto.randomUUID(); open=true; @State() text='';
      @Client() onDispose(){this.open=false;((window as any).__ownershipDisposals??=[]).push(this.marker);}
    }
    @Service() export class LayoutService extends CossackService {
      marker=crypto.randomUUID(); @State() text='';
      @Client() onDispose(){((window as any).__ownershipDisposals??=[]).push(this.marker);}
    }
    export class Child extends Cossack {
      props={slot:''}; @ClientStore() draft={text:''};
      render(){return html\`<input id=\${this.props.slot} .value=\${this.draft.text}
        @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>\`;}
    }
  `);
  await write('src/OwnershipProbe.ts', `
    import {CossackService,Service,Server,getServiceMetadata} from '@cossackframework/core';
    export const disposalAudit:Array<{trace:string,marker:string,viewer:string|undefined,request:string,kind:string}>=[];
    @Service({scope:'transient'}) export class ProbeService extends CossackService {
      marker=crypto.randomUUID();
      @Server() async snapshot(){
        const before={marker:this.marker,viewer:this.user?.id,request:this.c.get('ownership.request' as any),
          envMatches:this.env===this.c.env,scope:getServiceMetadata(ProbeService)?.scope};
        await new Promise(resolve=>setTimeout(resolve,30));
        return {before,after:{marker:this.marker,viewer:this.user?.id,request:this.c.get('ownership.request' as any),envMatches:this.env===this.c.env}};
      }
      async onDispose(){
        if(typeof window!=='undefined')return;
        await new Promise(resolve=>setTimeout(resolve,20));
        disposalAudit.push({trace:this.c.req.query('trace')??'',marker:this.marker,viewer:this.user?.id,
          request:this.c.get('ownership.request' as any),kind:'probe'});
        if(this.c.req.query('cleanupFailure')==='yes')throw new Error('deliberate service cleanup failure');
      }
    }
    @Service() export class ProbeSibling extends CossackService {
      marker=crypto.randomUUID();
      async onDispose(){
        if(typeof window!=='undefined')return;
        await new Promise(resolve=>setTimeout(resolve,20));
        disposalAudit.push({trace:this.c.req.query('trace')??'',marker:this.marker,viewer:this.user?.id,
          request:this.c.get('ownership.request' as any),kind:'sibling'});
      }
    }
  `);
  await write('src/pages/probe/layout.ts', `
    import {Cossack,Page,Inject} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';import {ProbeService,ProbeSibling} from '../../OwnershipProbe';
    @Page({transport:'http',services:[ProbeService,ProbeSibling]}) export default class ProbeLayout extends Cossack {
      @Inject(ProbeService) service!:ProbeService;
      render(){return html\`<section data-probe-parent=\${this.service.marker}>\${this.children}</section>\`;}
    }
  `);
  await write('src/pages/probe/nested/layout.ts', `
    import {Page} from '@cossackframework/core';import ProbeLayout from '../layout';import {ProbeService} from '../../../OwnershipProbe';
    @Page({transport:'http',services:[ProbeService]}) export default class NestedProbeLayout extends ProbeLayout {}
  `);
  await write('src/pages/probe/nested/index.ts', `
    import {Cossack,Page,Inject,State,getServiceMetadata} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';import NestedProbeLayout from './layout';
    import {ProbeService,ProbeSibling} from '../../../OwnershipProbe';
    @Page({transport:'http'}) export default class ProbePage extends Cossack {
      @Inject(ProbeService) service!:ProbeService; @Inject(ProbeSibling) sibling!:ProbeSibling; @State() result:any;
      async init(){this.result={snapshot:await this.service.snapshot(),sibling:this.sibling.marker,
        declared:Reflect.getMetadata('page:options',NestedProbeLayout).services.map((token:any)=>
          ({token:token===ProbeService?'ProbeService':'unexpected',scope:getServiceMetadata(token)?.scope}))};}
      render(){return html\`<pre id="ownership-probe">\${JSON.stringify(this.result)}</pre>\`;}
    }
  `);
  await write('src/pages/api/ownership-audit.ts', `
    import {Cossack,Page} from '@cossackframework/core';import {disposalAudit} from '../../OwnershipProbe';
    @Page({transport:'http'}) export default class OwnershipAudit extends Cossack {
      get(){const traces=new Set((this.c.req.query('traces')??'').split(','));
        return this.c.json(disposalAudit.filter(entry=>traces.has(entry.trace)));}
    }
  `);
  await write('src/App.ts', `
    import {Cossack,Page,ClientStore,Client} from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';import {Child} from './Ownership';
    @Page({transport:'http'}) export class App extends Cossack {
      @ClientStore() draft={text:''};
      @Client() onMount(){(window as any).__ownershipApp=this;}
      render(){
        if(!this.isServer && this.c.req.query('space')==='broken') throw new Error('deliberate root failure');
        if(this.c.req.query('space')==='empty') return null;
        return html\`<header><span id="root-user">\${this.user?.id}</span>
        <input id="root-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        \${component(Child,{slot:'root-child'})}</header>\${this.children}\`;}
    }
  `);
  await write('src/pages/layout.ts', `
    import {Cossack,Page,Inject} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';import {RootService} from '../Ownership';
    @Page({transport:'http',services:[RootService]}) export default class RootLayout extends Cossack {
      @Inject(RootService) service!:RootService;
      async onCleanup(){
        if(this.isServer || (window as any).__holdOwnerCleanup!==this.service.marker)return;
        await new Promise<void>(resolve=>{(window as any).__releaseOwnerCleanup=resolve;});
        ((window as any).__ownershipCleanup??=[]).push({marker:this.service.marker,open:this.service.open,
          space:this.c.req.query('space'),viewer:this.user?.id});
      }
      render(){return html\`<section><span id="root-service-id">\${this.service.marker}</span>
        <input id="root-service" .value=\${this.service.text} @input=\${(event:Event)=>{this.service.text=(event.target as HTMLInputElement).value;}}>
        \${this.children}</section>\`;}
    }
  `);
  await write('src/pages/owner/layout.ts', `
    import {Cossack,Page,ClientStore,Inject} from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';import {LayoutService,Child} from '../../Ownership';
    @Page({transport:'http',services:[LayoutService]}) export default class Layout extends Cossack {
      @Inject(LayoutService) service!:LayoutService; @ClientStore() draft={text:''};
      render(){return html\`<section><span id="layout-user">\${this.user?.id}</span><span id="layout-service-id">\${this.service.marker}</span>
        <input id="layout-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        <input id="layout-service" .value=\${this.service.text} @input=\${(event:Event)=>{this.service.text=(event.target as HTMLInputElement).value;}}>
        \${component(Child,{slot:'layout-child'})}\${this.children}</section>\`;}
    }
  `);
  await write('src/pages/owner/index.ts', `
    import {Cossack,Page,ClientStore,Client} from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';import {Child} from '../../Ownership';
    @Page({transport:'http',scope:c=>'space:'+(c.req.query('space')??'one')}) export default class Owner extends Cossack {
      @ClientStore() draft={text:''};
      @Client() onMount(){(window as any).__ownershipPage=this;}
      render(){return html\`<main><span id="page-user">\${this.user?.id}</span>
        <input id="page-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        \${component(Child,{slot:'page-child'})}</main>\`;}
    }
  `);
  await write('src/pages/owner/socket/[space]/index.ts', `
    import {Page} from '@cossackframework/core';import Owner from '../../index';
    @Page({transport:'durable-object',stateful:false,scope:c=>'space:'+c.req.param('space')}) export default class SocketOwner extends Owner {}
  `);
  const configPath=path.join(root,'wrangler.jsonc');
  let config;
  try { config=JSON.parse(await fs.readFile(configPath,'utf8')); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  if(config) {
    config.durable_objects.bindings.push({name:'COSSACK_OBJECT',class_name:'NavigationObject'});
    config.migrations.push({tag:'navigation-v2',new_sqlite_classes:['NavigationObject']});
    await fs.writeFile(configPath,JSON.stringify(config));
    await fs.appendFile(path.join(root,'src/index.ts'), "\nexport { AppDurableObject as NavigationObject } from '@cossackframework/framework';\n");
  }
  await write('src/pages/owner/stream.ts', `
    import {Page} from '@cossackframework/core';import Owner from './index';
    @Page({transport:'sse',scope:c=>'space:'+(c.req.query('space')??'one')}) export default class Stream extends Owner {}
  `);
  await write('src/pages/api/inherited.ts', `
    import {Cossack,Page} from '@cossackframework/core';
    class BaseApi extends Cossack {
      async get(){return this.c.json({handler:'inherited-get'});}
      async post(){return this.c.json({handler:'inherited-post'});}
    }
    @Page({transport:'http'}) export default class InheritedApi extends BaseApi {}
  `);
  // Decorated subclasses preserve supported route metadata while reusing the
  // same child component classes and input structure under a different parent.
  await write('src/pages/other/layout.ts', `
    import {Page} from '@cossackframework/core';
    import Layout from '../owner/layout';import {LayoutService} from '../../Ownership';
    @Page({transport:'http',services:[LayoutService]}) export default class OtherLayout extends Layout {}
  `);
  await write('src/pages/other/index.ts', `
    import {Page} from '@cossackframework/core';import Owner from '../owner/index';
    @Page({transport:'http',scope:c=>'space:'+(c.req.query('space')??'one')}) export default class Other extends Owner {}
  `);
}

export async function checkNavigationOwnershipBrowser(browser, origin) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__navigationDiagnostics = [];
    document.addEventListener('cossack:navigation-diagnostic', event => window.__navigationDiagnostics.push(event.detail));
  });
  const fields = ['root-draft','root-service','root-child','layout-draft','layout-service','layout-child','page-draft','page-child'];
  const navigate = (viewer, space, revision) => page.evaluate(async ({viewer,space,revision}) => {
    return (await window.__ownershipApp.navigate('/owner?'+new URLSearchParams({viewer,space,revision}))).outcome;
  }, {viewer,space,revision});
  const fill = async label => { for (const id of fields) await page.locator('#'+id).fill(label+' '+id); };
  const check = async label => { for (const id of fields) await browserExpect(page.locator('#'+id)).toHaveValue(label ? label+' '+id : ''); };
  const ids = async () => [await page.locator('#root-service-id').textContent(),await page.locator('#layout-service-id').textContent()];
  try {
    // Overlapping production SSR requests must retain their own service facilities
    // after awaits, and finish every service hook before publishing the response.
    const traces = ['alice','bob'].map(viewer=>({viewer,trace:crypto.randomUUID()}));
    const probes = await Promise.all(traces.map(async ({viewer,trace})=>{
      const response=await page.request.get(origin+'/probe/nested?'+new URLSearchParams({viewer,trace,cleanupFailure:'yes'}));
      expect(response.status()).toBe(200);
      const html=await response.text();
      return page.evaluate(html=>{
        const document=new DOMParser().parseFromString(html,'text/html');
        return {result:JSON.parse(document.querySelector('#ownership-probe').textContent),
          owners:[...document.querySelectorAll('[data-probe-parent]')].map(node=>node.getAttribute('data-probe-parent'))};
      },html);
    }));
    const auditResponse=await page.request.get(origin+'/api/ownership-audit?'+new URLSearchParams({traces:traces.map(x=>x.trace).join(',')}));
    expect(auditResponse.status()).toBe(200);
    const audit=await auditResponse.json();
    for(let index=0;index<probes.length;index++){
      const {result,owners}=probes[index]; const {before,after}=result.snapshot;
      expect(before).toMatchObject({viewer:traces[index].viewer,envMatches:true,scope:'transient'});
      expect(after).toEqual({marker:before.marker,viewer:before.viewer,request:before.request,envMatches:true});
      expect(result.declared).toEqual([{token:'ProbeService',scope:'transient'}]);
      expect(owners).toHaveLength(2); expect(owners[0]).not.toBe(owners[1]); expect(before.marker).toBe(owners[1]);
      const completed=audit.filter(entry=>entry.trace===traces[index].trace);
      expect(completed).toHaveLength(3);
      expect(completed.map(entry=>entry.marker).sort()).toEqual([...owners,result.sibling].sort());
      for(const entry of completed)expect(entry).toMatchObject({viewer:before.viewer,request:before.request});
    }
    expect(probes[0].result.snapshot.before.request).not.toBe(probes[1].result.snapshot.before.request);
    expect(probes[0].owners.some(marker=>probes[1].owners.includes(marker))).toBe(false);
    const manifestResponse=await page.request.get(origin+'/cossack-routes.json');
    expect(manifestResponse.status()).toBe(200);
    const manifest=await manifestResponse.json();
    const ownerRouteId=manifest.filePathToId['/src/pages/probe/nested/layout.ts'];
    const pageRouteId=manifest.filePathToId['/src/pages/probe/nested/index.ts'];
    expect(ownerRouteId).toBeTruthy();expect(pageRouteId).toBeTruthy();
    const rpcTraces=traces.map(({viewer})=>({viewer,trace:crypto.randomUUID()}));
    const rpcSnapshots=await Promise.all(rpcTraces.map(async({viewer,trace})=>{
      const response=await page.request.post(origin+'/crpc?'+new URLSearchParams({viewer,trace}),{
        headers:{origin},data:{service:{ownerRouteId,slot:'0'},componentRouteId:pageRouteId,pageParams:{},action:'snapshot',payload:[],state:{}}});
      expect(response.status()).toBe(200);
      return (await response.json())._cossack_return;
    }));
    const rpcAudit=await (await page.request.get(origin+'/api/ownership-audit?'+new URLSearchParams({traces:rpcTraces.map(x=>x.trace).join(',')}))).json();
    for(let index=0;index<rpcSnapshots.length;index++){
      const {before,after}=rpcSnapshots[index];
      expect(before).toMatchObject({viewer:rpcTraces[index].viewer,envMatches:true,scope:'transient'});
      expect(after).toEqual({marker:before.marker,viewer:before.viewer,request:before.request,envMatches:true});
      const completed=rpcAudit.filter(entry=>entry.trace===rpcTraces[index].trace);
      expect(completed).toHaveLength(3);
      expect(completed.some(entry=>entry.marker===before.marker)).toBe(true);
      expect(new Set(completed.map(entry=>entry.marker)).size).toBe(3);
      for(const entry of completed)expect(entry).toMatchObject({viewer:before.viewer,request:before.request});
    }
    expect(rpcSnapshots[0].before.request).not.toBe(rpcSnapshots[1].before.request);
    expect(rpcSnapshots[0].before.marker).not.toBe(rpcSnapshots[1].before.marker);
    for (const method of ['GET','POST']) {
      const response = await page.request.fetch(origin+'/api/inherited', {method});
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({handler:'inherited-'+method.toLowerCase()});
    }
    await page.goto(origin+'/owner?viewer=alice&space=one&revision=1');
    await browserExpect.poll(() => page.evaluate(() => window.__cossackReady)).toBe(true);
    await fill('private'); const first = await ids();
    expect(await navigate('alice','one','2')).toBe('completed');
    await check('private'); expect(await ids()).toEqual(first);
    expect(await page.evaluate(() => window.__ownershipDisposals??[])).toEqual([]);
    const originalUrl = page.url();
    await page.evaluate(() => document.addEventListener('cossack:navigation-error', event => {
      if(event.detail.error?.message==='deliberate root failure') event.preventDefault();
    }));
    expect(await navigate('alice','broken','failure')).toBe('failed');
    expect(page.url()).toBe(originalUrl); await check('private'); expect(await ids()).toEqual(first);
    await page.evaluate(async () => { window.__ownershipApp.draft.text='late failed root'; await window.__ownershipApp.requestUpdate(); });
    await check('private');
    await browserExpect.poll(() => page.evaluate(() => (window.__ownershipDisposals??[]).length)).toBe(2);
    const abandoned = await page.evaluate(() => window.__ownershipDisposals);
    expect(abandoned.some(id => first.includes(id))).toBe(false);
    await page.evaluate(marker => { window.__holdOwnerCleanup=marker; }, first[0]);
    expect(await navigate('alice','two','3')).toBe('completed');
    await check(''); const second = await ids();
    expect(second[0]).not.toBe(first[0]); expect(second[1]).not.toBe(first[1]);
    await browserExpect.poll(() => page.evaluate(() => typeof window.__releaseOwnerCleanup)).toBe('function');
    expect(await page.evaluate(marker => (window.__ownershipDisposals??[]).includes(marker), first[0])).toBe(false);
    await page.evaluate(() => window.__releaseOwnerCleanup());
    await browserExpect.poll(() => page.evaluate(() => window.__ownershipCleanup)).toEqual([
      {marker:first[0],open:true,space:'one',viewer:'alice'},
    ]);
    await browserExpect.poll(() => page.evaluate(() => window.__ownershipDisposals??[])).toEqual(expect.arrayContaining(first));
    await fill('second');
    expect(await navigate('bob','two','4')).toBe('completed');
    await check(''); const third = await ids();
    for (const level of ['root','layout','page']) await browserExpect(page.locator('#'+level+'-user')).toHaveText('bob');
    expect(third[0]).not.toBe(second[0]); expect(third[1]).not.toBe(second[1]);
    await browserExpect.poll(() => page.evaluate(() => window.__ownershipDisposals??[])).toEqual(expect.arrayContaining([...first,...second]));
    const disposed = await page.evaluate(() => window.__ownershipDisposals);
    for (const id of [...abandoned,...first,...second]) expect(disposed.filter(value => value===id)).toHaveLength(1);


    await fill('parent');
    expect(await page.evaluate(async () => { const result=await window.__ownershipApp.navigate('/other?viewer=bob&space=two&revision=parent'); return {outcome:result.outcome,error:result.error?.message}; })).toEqual({outcome:'completed',error:undefined});
    for (const id of fields) await browserExpect(page.locator('#'+id)).toHaveValue(id.startsWith('root-') ? 'parent '+id : '');
    const other = await ids();
    expect(other[0]).toBe(third[0]); expect(other[1]).not.toBe(third[1]);
    await browserExpect.poll(() => page.evaluate(id => (window.__ownershipDisposals??[]).filter(value => value===id).length, third[1])).toBe(1);
    expect(await page.evaluate(id => (window.__ownershipDisposals??[]).includes(id), third[0])).toBe(false);
    await fill('other');
    expect(await navigate('bob','two','return')).toBe('completed');
    for (const id of fields) await browserExpect(page.locator('#'+id)).toHaveValue(id.startsWith('root-') ? 'other '+id : '');
    const returned = await ids();
    expect(returned[0]).toBe(third[0]); expect(returned[1]).not.toBe(third[1]); expect(returned[1]).not.toBe(other[1]);
    await browserExpect.poll(() => page.evaluate(id => (window.__ownershipDisposals??[]).filter(value => value===id).length, other[1])).toBe(1);

    await fill('transport');
    expect(await page.evaluate(async () => (await window.__ownershipApp.navigate('/owner/stream?viewer=bob&space=two')).outcome)).toBe('completed');
    await page.waitForFunction(()=>window.__ownershipPage?.realtime.sse?.state==='open');
    expect(await ids()).toEqual(returned);
    for (const id of fields) await browserExpect(page.locator('#'+id)).toHaveValue(id.startsWith('page-') ? '' : 'transport '+id);
    await page.evaluate(()=>{window.__oldStreamOwner=window.__ownershipPage;});
    await fill('stream');
    expect(await navigate('bob','two','http-return')).toBe('completed');
    expect(await ids()).toEqual(returned);
    for (const id of fields) await browserExpect(page.locator('#'+id)).toHaveValue(id.startsWith('page-') ? '' : 'stream '+id);
    await browserExpect.poll(()=>page.evaluate(()=>window.__oldStreamOwner.realtime.sse.state)).toBe('closed');
    for (const id of returned) expect(await page.evaluate(marker=>(window.__ownershipDisposals??[]).includes(marker),id)).toBe(false);

    await fill('before socket');
    expect(await page.evaluate(async()=>(await window.__ownershipApp.navigate('/owner/socket/two?viewer=bob')).outcome)).toBe('completed');
    await page.waitForFunction(()=>window.__ownershipPage?.realtime.websocket?.state==='open');
    expect(await ids()).toEqual(returned);
    for(const id of fields) await browserExpect(page.locator('#'+id)).toHaveValue(id.startsWith('page-')?'':'before socket '+id);
    const oldTarget=await page.evaluate(()=>window.__INITIAL_STATE__.realtimeTarget);
    expect(typeof oldTarget).toBe('string');
    await page.evaluate(()=>{window.__oldSocketOwner=window.__ownershipPage;});
    await fill('socket');
    expect(await page.evaluate(async()=>(await window.__ownershipApp.navigate('/owner/socket/three?viewer=bob')).outcome)).toBe('completed');
    await page.waitForFunction(()=>window.__ownershipPage?.realtime.websocket?.state==='open');
    expect(await page.evaluate(()=>window.__INITIAL_STATE__.realtimeTarget)).not.toBe(oldTarget);
    await check('');
    const socketIds=await ids(); expect(socketIds[0]).not.toBe(returned[0]); expect(socketIds[1]).not.toBe(returned[1]);
    expect(await page.evaluate(()=>window.__oldSocketOwner.realtime.websocket.state)).toBe('closed');
    for(const id of returned) await browserExpect.poll(()=>page.evaluate(marker=>(window.__ownershipDisposals??[]).filter(value=>value===marker).length,id)).toBe(1);
    await fill('socket return');
    const stableTarget=await page.evaluate(()=>window.__INITIAL_STATE__.realtimeTarget);
    await page.evaluate(()=>{window.__oldSocketOwner=window.__ownershipPage;});
    expect(await page.evaluate(async()=>(await window.__ownershipApp.navigate('/owner/socket/three?viewer=bob&revision=repeat')).outcome)).toBe('completed');
    await page.waitForFunction(()=>window.__ownershipPage?.realtime.websocket?.state==='open');
    expect(await page.evaluate(()=>window.__INITIAL_STATE__.realtimeTarget)).toBe(stableTarget);
    await check('socket return'); expect(await ids()).toEqual(socketIds);
    expect(await page.evaluate(()=>window.__oldSocketOwner.realtime.websocket.state)).toBe('closed');
    await page.evaluate(()=>{window.__oldSocketOwner=window.__ownershipPage;});
    expect(await navigate('bob','three','socket-return')).toBe('completed');
    expect(await ids()).toEqual(socketIds);
    for(const id of fields) await browserExpect(page.locator('#'+id)).toHaveValue(id.startsWith('page-')?'':'socket return '+id);
    expect(await page.evaluate(()=>window.__oldSocketOwner.realtime.websocket.state)).toBe('closed');

    await fill('private before empty');
    expect(await navigate('bob','empty','5')).toBe('completed');
    await browserExpect(page.locator('#root-draft')).toHaveCount(0);
    await browserExpect(page.locator('#page-draft')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('private before empty');
    expect(await page.evaluate(() => window.__navigationDiagnostics)).toEqual([]);
  } finally { await page.evaluate(() => window.__releaseOwnerCleanup?.()).catch(() => {}); await page.close(); }
}
