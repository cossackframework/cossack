import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
// A real HTTP boundary counts resource reads independently of browser RPC logs.
export async function createUrlStateBackend() {
  const reads = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const kind = url.pathname.slice(1);
    if (!['page','layout'].includes(kind)) { response.writeHead(404); response.end(); return; }
    const search = url.searchParams.get('search') ?? '';
    const page = Number(url.searchParams.get('page'));
    reads.push({kind,search,page});
    response.setHeader('Content-Type','text/plain; charset=utf-8');
    response.end(kind==='layout' ? search+':'+page : search+':'+page+':'+url.searchParams.get('sort')+':'+url.searchParams.get('tags'));
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  return {origin:'http://127.0.0.1:'+server.address().port,reads,
    close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}

export async function writeUrlStateAcceptance(root, backendOrigin) {
  const directory = path.join(root, 'src/pages/list'); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(root, 'src/NestedDraft.ts'), `
    import {Cossack,ClientStore,ClientState,Client} from '@cossackframework/core';
    import {html,component,cache} from '@cossackframework/renderer';
    class Leaf extends Cossack {
      props={slot:''};
      @ClientStore() draft={text:''};
      @ClientState() file:File|undefined=undefined;
      @Client() onMount(){
        const events=(window as any).__nestedMounts??=[];
        events.push({slot:this.props.slot,text:this.draft.text,file:this.file?.name??''});
        if(this.props.slot==='cache-a' && !(window as any).__lateCachedDraft){const draft=this.draft;(window as any).__lateCachedDraft=()=>{draft.text='obsolete hidden owner';};}
      }
      render(){return html\`<input id=\${this.props.slot+'-leaf'} .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        <input type="file" id=\${this.props.slot+'-file'} @change=\${(event:Event)=>{this.file=(event.target as HTMLInputElement).files?.[0];}}>
        <span id=\${this.props.slot+'-filename'}>\${this.file?.name??''}</span>\`;}
    }
    export class NestedDraft extends Cossack {
      props={slot:''};
      @ClientStore() draft={text:''};
      render(){return html\`<aside><input id=\${this.props.slot+'-outer'} .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        \${component(Leaf,{slot:this.props.slot})}</aside>\`;}
    }
    export class CachedDraft extends Cossack {
      @ClientState() branch='a';
      render(){return html\`<div>
        <button id="show-cache-a" @click=\${()=>{this.branch='a';}}>A</button>
        <button id="show-cache-b" @click=\${()=>{this.branch='b';}}>B</button>
        <button id="hide-cache" @click=\${()=>{this.branch='hidden';}}>Hide</button>
        \${cache(this.branch==='a'?html\`<section>\${component(NestedDraft,{slot:'cache-a'})}</section>\`:
          this.branch==='b'?html\`<aside>\${component(NestedDraft,{slot:'cache-b'})}</aside>\`:null)}</div>\`;}
    }
  `);
  await fs.writeFile(path.join(root, 'src/App.ts'), `
    import {Cossack,Page,Client} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    @Page({transport:'http'}) export class App extends Cossack {
      @Client() onMount(){(window as any).__queryTestApp=this;}
      @Client() updated(){if(this.c.req.path==='/retire' && !(window as any).__allowRetire) throw new Error('deliberate post-render failure');}
      render(){
        if(!this.isServer && this.c.req.query('search')==='render-failing') throw new Error('deliberate render failure');
        return html\`\${this.children}\`;
      }
    }
  `);
  await fs.mkdir(path.join(root,'src/pages/retire'),{recursive:true});
  await fs.writeFile(path.join(root,'src/pages/retire/layout.ts'), `
    import {Cossack,CossackService,Page,Service,Inject,Client} from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';
    @Service() class Resource extends CossackService {
      open=true;
      @Client() onDispose(){this.open=false;(window as any).__scopeEvents.push('disposed');}
    }
    class Child extends Cossack {
      @Inject(Resource) resource!:Resource;
      async onCleanup(){
        if(this.isServer)return;
        await new Promise<void>(resolve=>{(window as any).__finishScopeCleanup=resolve;});
        (window as any).__scopeEvents.push(this.resource.open?'cleanup-open':'cleanup-closed');
      }
      render(){return html\`<p id="transient-child">Transient child</p>\`;}
    }
    @Page({transport:'http',services:[Resource]}) export default class Layout extends Cossack {
      render(){return html\`<section>\${component(Child)}\${this.children}</section>\`;}
    }
  `);
  await fs.writeFile(path.join(root,'src/pages/retire/index.ts'), `
    import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
    @Page({transport:'http'}) export default class Retire extends Cossack {render(){return html\`<p>Retire</p>\`;}}
  `);
  await fs.writeFile(path.join(root, 'src/filters.ts'), `
    import {defineUrlState,url} from '@cossackframework/core';
    export const filters=defineUrlState({search:url.string(),page:url.integer({default:1,min:1}),sort:url.enum(['name','price']),tags:url.array(url.string())});
  `);
  await fs.writeFile(path.join(directory, 'layout.ts'), `
    import {Cossack,CossackService,Page,Service,State,Inject,ClientStore,server$} from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';
    import {filters} from '../../filters';
    import {NestedDraft} from '../../NestedDraft';
    @Service() class DraftService extends CossackService { @State() text=''; }
    @Page({transport:'http',services:[DraftService]}) export default class Layout extends Cossack {
      @Inject(DraftService) service!:DraftService;
      @ClientStore() draft={text:''};
      summary=server$(async(search:string,page:number)=>{
        const response=await fetch(${JSON.stringify(backendOrigin)}+'/layout?'+new URLSearchParams({search,page:String(page)}));
        if(!response.ok)throw new Error('layout backend failed');return response.text();
      },{initial:'',deps:()=>[this.urlState(filters).search,this.urlState(filters).page] as const});
      render(){return html\`<section><p id="layout-summary">\${this.summary}</p>
        <input id="layout-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        <input id="service-draft" .value=\${this.service.text} @input=\${(event:Event)=>{this.service.text=(event.target as HTMLInputElement).value;}}>
        \${component(NestedDraft,{slot:'layout-child'})}\${this.children}</section>\`;}
    }
  `);
  await fs.writeFile(path.join(directory, 'loading.ts'), `
    import {Cossack,Page} from '@cossackframework/core'; import {html} from '@cossackframework/renderer';
    @Page({transport:'http'}) export default class Loading extends Cossack {render(){return html\`<p id="query-loading">Loading</p>\`;}}
  `);
  await fs.mkdir(path.join(root,'src/pages/plain'),{recursive:true});
  await fs.writeFile(path.join(root,'src/pages/plain/index.ts'), `
    import {Cossack,Page,Client} from '@cossackframework/core'; import {html} from '@cossackframework/renderer';
    @Page({transport:'http'}) export default class Plain extends Cossack {
      @Client() back(){return this.navigate('/list');}
      render(){return html\`<button id="return-list" @click=\${this.back}>List</button>\`;}
    }
  `);
  await fs.writeFile(path.join(directory, 'index.ts'), `
    import {Cossack,Page,Client,ClientState,ClientStore,PreventNavigation,server$} from '@cossackframework/core';
    import {html,component} from '@cossackframework/renderer';
    import {filters} from '../../filters';
    import {NestedDraft,CachedDraft} from '../../NestedDraft';
    @Page({transport:'http'}) export default class List extends Cossack {
      @ClientState() blocked=false;
      @ClientState() guardChecks=0;
      @ClientState() outcome='';
      @ClientState() revision=0;
      @PreventNavigation() prevent(){this.guardChecks++;return this.blocked;}
      @ClientState() file:File|undefined=undefined;
      @ClientStore() draft={text:''};
      get filters(){return this.urlState(filters);}
      items=server$(async(search:string,page:number,sort:'name'|'price',tags:readonly string[])=>{
        const response=await fetch(${JSON.stringify(backendOrigin)}+'/page?'+new URLSearchParams({search,page:String(page),sort,tags:tags.join(',')}));
        if(!response.ok)throw new Error('page backend failed');return response.text();
      },
        {initial:'',deps:()=>[this.filters.search,this.filters.page,this.filters.sort,this.filters.tags] as const});
      @Client() change(){return this.updateUrlState(filters,{search:'雪 & books',page:2,sort:'price',tags:['a','b']});}
      @Client() replace(){return this.updateUrlState(filters,{page:this.filters.page+1},{history:'replace'});}
      @Client() rapid(){return Promise.all([this.updateUrlState(filters,{page:4}),this.updateUrlState(filters,{search:'rapid'})]);}
      @Client() async pageOnly(){this.outcome=(await this.updateUrlState(filters,{page:5})).outcome;}
      @Client() async searchOnly(){this.outcome=(await this.updateUrlState(filters,{search:'latest'})).outcome;}
      @Client() async fail(){this.outcome=(await this.updateUrlState(filters,{search:'failing'})).outcome;}
      @Client() leave(){return this.navigate('/plain');}
      @Client() async renderFailure(){this.outcome=(await this.updateUrlState(filters,{search:'render-failing'})).outcome;}
      @Client() async retireFailure(){this.outcome=(await this.navigate('/retire')).outcome;}
      @Client() rememberDraft(){const draft=this.draft;(window as any).__lateDraftWrite=()=>{draft.text='obsolete owner';};}
      render(){return html\`<main id="rows"><p id="query-values">\${JSON.stringify(this.filters)}</p><p id="query-items">\${this.items}</p>
        <input id="page-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        <input id="draft-file" type="file" @change=\${(event:Event)=>{this.file=(event.target as HTMLInputElement).files?.[0];}}><span id="file-name">\${this.file?.name??''}</span>
        <button id="page-only" @click=\${this.pageOnly}>Page</button><button id="search-only" @click=\${this.searchOnly}>Search</button>
        <button id="fail-query" @click=\${this.fail}>Fail</button><button id="toggle-guard" @click=\${()=>{this.blocked=!this.blocked;}}>Guard</button>
        <button id="confirm-history" @click=\${()=>this.confirmNavigation(true)}>Confirm</button><span id="guard-checks">\${this.guardChecks}</span>
        <button id="fail-render" @click=\${this.renderFailure}>Fail render</button>
        <button id="fail-retire" @click=\${this.retireFailure}>Fail after rendering</button>
        <button id="remember-draft" @click=\${this.rememberDraft}>Remember draft</button>
        <button id="redraw-draft" @click=\${()=>{this.revision++;}}>Redraw</button><span id="draft-revision">\${this.revision}</span>
        <span id="query-outcome">\${this.outcome}</span>
        <button id="rapid-query" @click=\${this.rapid}>Rapid</button><button id="leave-list" @click=\${this.leave}>Leave</button>
        <button id="change-query" @click=\${this.change}>Change</button><button id="replace-query" @click=\${this.replace}>Replace</button>
        \${component(NestedDraft,{slot:'page-child'})}\${component(CachedDraft)}</main>\`;}
    }
  `);
}
export async function checkUrlStateBrowser(browser, origin, backend) {
  let observed = backend.reads.length;
  const expectReads = (...queries) => {
    const actual = backend.reads.slice(observed); observed = backend.reads.length;
    const expected = queries.flatMap(([search,page])=>['layout','page'].map(kind=>({kind,search,page})));
    const order = values => values.map(value=>JSON.stringify(value)).sort();
    expect(order(actual)).toEqual(order(expected));
  };
  const page = await browser.newPage(); const rpc = []; let release;
  page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') rpc.push(request); });
  const settled = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const checkNestedDrafts = async () => {
    for (const owner of ['page-child','layout-child']) {
      await browserExpect(page.locator('#'+owner+'-outer')).toHaveValue(owner+' outer draft');
      await browserExpect(page.locator('#'+owner+'-leaf')).toHaveValue(owner+' leaf draft');
    }
    await browserExpect(page.locator('#page-child-filename')).toHaveText('nested.txt');
  };
  try {
    const initial = await page.goto(origin + '/list?search=old&utm=a%20b#rows');
    expect(initial.status()).toBe(200); expect(await initial.text()).toContain('old:1:name:');
    await browserExpect(page.locator('#query-items')).toHaveText('old:1:name:'); await settled(); expect(rpc).toHaveLength(0); expectReads(['old',1]);
    await page.locator('#page-draft').fill('unsaved page'); await page.locator('#layout-draft').fill('unsaved layout'); await page.locator('#service-draft').fill('unsaved service');
    await page.locator('#draft-file').setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('draft')});
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    for (const owner of ['page-child','layout-child']) {
      await page.locator('#'+owner+'-outer').fill(owner+' outer draft');
      await page.locator('#'+owner+'-leaf').fill(owner+' leaf draft');
    }
    await page.locator('#page-child-file').setInputFiles({name:'nested.txt',mimeType:'text/plain',buffer:Buffer.from('nested draft')});
    await checkNestedDrafts();
    await page.locator('#cache-a-outer').fill('cached A outer');
    await page.locator('#cache-a-leaf').fill('cached A leaf');
    await page.locator('#cache-a-file').setInputFiles({name:'cached.txt',mimeType:'text/plain',buffer:Buffer.from('cached draft')});
    await page.locator('#show-cache-b').click();
    await page.locator('#cache-b-outer').fill('cached B outer');
    await page.locator('#cache-b-leaf').fill('cached B leaf');
    await page.locator('#hide-cache').click();
    await browserExpect(page.locator('#cache-a-leaf')).toHaveCount(0);
    await browserExpect(page.locator('#cache-b-leaf')).toHaveCount(0);
    await page.locator('#remember-draft').click();
    await page.locator('#change-query').click(); await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:2:price:a,b');
    await page.evaluate(() => window.__lateCachedDraft());
    // An old closure still holds the disposed page's proxy. Force a new-owner
    // render so shared raw-target corruption cannot hide behind stale DOM.
    await page.evaluate(() => { window.__lateDraftWrite(); delete window.__lateDraftWrite; });
    await page.locator('#redraw-draft').click();
    await browserExpect(page.locator('#draft-revision')).toHaveText('1');
    await browserExpect(page.locator('#page-draft')).toHaveValue('unsaved page');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('unsaved layout');
    await browserExpect(page.locator('#service-draft')).toHaveValue('unsaved service');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    await browserExpect(page.locator('#layout-summary')).toHaveText('雪 & books:2');
    await checkNestedDrafts();
    const changed = new URL(page.url()); expect(changed.searchParams.get('utm')).toBe('a b'); expect(changed.hash).toBe('#rows');
    await settled(); expect(rpc).toHaveLength(0); expectReads(['雪 & books',2]); // Matching SSR data satisfies the same query-derived dependencies.
    await page.goBack(); await browserExpect(page.locator('#query-items')).toHaveText('old:1:name:');
    await page.goForward(); await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:2:price:a,b');
    await browserExpect(page.locator('#page-draft')).toHaveValue('unsaved page');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    await settled(); expectReads();
    const length = await page.evaluate(() => history.length);
    const beforeRenderFailure = page.url();
    await page.evaluate(() => document.addEventListener('cossack:navigation-error', event => {
      if(['deliberate render failure','deliberate post-render failure'].includes(event.detail.error?.message)) event.preventDefault();
    }));
    await page.locator('#fail-render').click();
    await browserExpect(page.locator('#query-outcome')).toHaveText('failed');
    expect(page.url()).toBe(beforeRenderFailure);
    await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:2:price:a,b');
    await browserExpect(page.locator('#layout-summary')).toHaveText('雪 & books:2');
    await browserExpect(page.locator('#page-draft')).toHaveValue('unsaved page');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('unsaved layout');
    await browserExpect(page.locator('#service-draft')).toHaveValue('unsaved service');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    await settled(); expectReads(['render-failing',2]);
    await page.evaluate(() => { window.__scopeEvents=[]; });
    await page.evaluate(() => { window.__nestedMounts=[]; });
    await page.locator('#fail-retire').click();
    await browserExpect.poll(() => page.evaluate(() => typeof window.__finishScopeCleanup)).toBe('function');
    expect(await page.evaluate(() => window.__scopeEvents)).toEqual([]);
    await page.evaluate(() => { window.__finishScopeCleanup(); delete window.__finishScopeCleanup; });
    await browserExpect.poll(() => page.evaluate(() => window.__scopeEvents)).toEqual(['cleanup-open','disposed']);
    expect(page.url()).toBe(beforeRenderFailure);
    await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:2:price:a,b');
    await browserExpect(page.locator('#page-draft')).toHaveValue('unsaved page');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('unsaved layout');
    await browserExpect(page.locator('#service-draft')).toHaveValue('unsaved service');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    await checkNestedDrafts();
    expect(await page.evaluate(() => window.__nestedMounts)).toEqual(expect.arrayContaining([
      {slot:'page-child',text:'page-child leaf draft',file:'nested.txt'},
      {slot:'layout-child',text:'layout-child leaf draft',file:''},
    ]));
    await settled(); expectReads();
    // The actual App owns an unrelated promise that never settles. Navigation
    // must render through its own completion path and release the stale cache.
    await page.evaluate(() => { window.__queryTestApp.__updatePromise=new Promise(()=>{}); });
    await page.locator('#replace-query').click(); await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:3:price:a,b');
    expect(await page.evaluate(() => history.length)).toBe(length); await settled(); expect(rpc).toHaveLength(0); expectReads(['雪 & books',3]);
    await page.locator('#show-cache-a').click();
    await browserExpect(page.locator('#cache-a-outer')).toHaveValue('cached A outer');
    await browserExpect(page.locator('#cache-a-leaf')).toHaveValue('cached A leaf');
    await browserExpect(page.locator('#cache-a-filename')).toHaveText('cached.txt');
    await page.locator('#show-cache-b').click();
    await browserExpect(page.locator('#cache-b-outer')).toHaveValue('cached B outer');
    await browserExpect(page.locator('#cache-b-leaf')).toHaveValue('cached B leaf');
    await page.locator('#hide-cache').click();
    const copied = await browser.newPage();
    try {
      const response = await copied.goto(page.url()); expect(response.status()).toBe(200);
      await browserExpect(copied.locator('#query-items')).toHaveText('雪 & books:3:price:a,b');
      expect(JSON.parse(await copied.locator('#query-values').textContent())).toEqual({ search: '雪 & books', page: 3, sort: 'price', tags: ['a', 'b'] });
      await browserExpect(copied.locator('#page-draft')).toHaveValue(''); await browserExpect(copied.locator('#file-name')).toHaveText('');
      await copied.goto(origin + '/list?page=0'); await browserExpect(copied.locator('#query-items')).toHaveText(':1:name:');
    } finally { await copied.close(); }
    expectReads(['雪 & books',3],['',1]);
    await page.locator('#rapid-query').click(); await browserExpect(page.locator('#query-items')).toHaveText('rapid:4:price:a,b');
    await browserExpect(page.locator('#layout-summary')).toHaveText('rapid:4');
    await browserExpect(page.locator('#page-draft')).toHaveValue('unsaved page');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('unsaved layout');
    await browserExpect(page.locator('#service-draft')).toHaveValue('unsaved service');
    await settled(); expect(rpc).toHaveLength(0);
    expectReads(['rapid',4]);
    const beforePrevented = page.url();
    await page.locator('#toggle-guard').click(); await page.locator('#page-only').click();
    await browserExpect(page.locator('#query-outcome')).toHaveText('canceled'); expect(page.url()).toBe(beforePrevented);
    await browserExpect(page.locator('#query-items')).toHaveText('rapid:4:price:a,b');
    // The guard must restore the exact history entry after browser back has
    // already changed the address. Confirmation resumes that original entry.
    await page.evaluate(() => history.replaceState({...history.state,applicationKey:'kept'},'',location.href));
    const checks = Number(await page.locator('#guard-checks').textContent());
    const historyLength = await page.evaluate(() => history.length);
    await page.evaluate(() => history.back());
    await browserExpect.poll(async () => Number(await page.locator('#guard-checks').textContent())).toBeGreaterThan(checks);
    await browserExpect.poll(() => page.url()).toBe(beforePrevented);
    await browserExpect(page.locator('#query-items')).toHaveText('rapid:4:price:a,b');
    expect(await page.evaluate(() => history.state.applicationKey)).toBe('kept');
    await page.locator('#confirm-history').click();
    await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:3:price:a,b');
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await browserExpect(page.locator('#page-draft')).toHaveValue('unsaved page');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    await page.locator('#toggle-guard').click(); await page.evaluate(() => history.forward());
    await browserExpect(page.locator('#query-items')).toHaveText('rapid:4:price:a,b');
    await browserExpect.poll(() => page.url()).toBe(beforePrevented);
    await page.evaluate(() => document.addEventListener('cossack:navigation-error', event => {window.__urlErrors=(window.__urlErrors??0)+1;event.preventDefault();}));
    const failedQuery = url => url.pathname === '/list' && url.searchParams.get('search') === 'failing';
    await page.route(failedQuery, route => route.fulfill({status:503,body:'unavailable'}));
    await page.locator('#fail-query').click(); await browserExpect(page.locator('#query-outcome')).toHaveText('failed');
    expect(page.url()).toBe(beforePrevented); await page.unroute(failedQuery);
    const errorsBeforeBack = await page.evaluate(() => window.__urlErrors);
    const failedBack = url => url.pathname === '/list' && url.searchParams.get('search') === '雪 & books' && url.searchParams.get('page') === '3';
    await page.route(failedBack, route => route.fulfill({status:503,body:'unavailable'}));
    await page.evaluate(() => {window.__cossack_invalidatePageCache();history.back();});
    await browserExpect.poll(() => page.evaluate(() => window.__urlErrors)).toBe(errorsBeforeBack+1);
    await browserExpect.poll(() => page.url()).toBe(beforePrevented);
    await browserExpect(page.locator('#query-items')).toHaveText('rapid:4:price:a,b');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    await page.unroute(failedBack); await settled(); expectReads();
    // Hold an actual SSR response, edit the still-active drafts, then commit a
    // newer query before releasing the obsolete response.
    let capturedResolve;
    const captured = new Promise(resolve => { capturedResolve = resolve; });
    const held = url => url.pathname === '/list' && url.searchParams.get('page') === '5' && url.searchParams.get('search') === 'rapid';
    await page.route(held, async route => {
      const response = await route.fetch();
      const gate = new Promise(resolve => { release = resolve; }); capturedResolve();
      await gate; await route.fulfill({response});
    });
    await page.locator('#page-only').click();
    await browserExpect.poll(() => Boolean(release)).toBe(true); await captured;
    expect(page.url()).toBe(beforePrevented); await browserExpect(page.locator('#query-loading')).toHaveCount(0);
    expectReads(['rapid',5]);
    // Back supersedes the pending page-5 intent. Replace the restored entry,
    // then traverse forward while the obsolete response remains held.
    await page.evaluate(() => history.back());
    await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:3:price:a,b');
    await settled(); expectReads(['雪 & books',3]);
    const pendingHistoryLength = await page.evaluate(() => history.length);
    await page.locator('#page-draft').fill('edited while pending');
    await page.locator('#replace-query').click();
    await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:4:price:a,b');
    expect(await page.evaluate(() => history.length)).toBe(pendingHistoryLength); await settled(); expectReads(['雪 & books',4]);
    await page.evaluate(() => history.forward());
    await browserExpect(page.locator('#query-items')).toHaveText('rapid:4:price:a,b');
    await browserExpect(page.locator('#page-draft')).toHaveValue('edited while pending');
    await settled(); expectReads(['rapid',4]);
    await page.locator('#search-only').click(); await browserExpect(page.locator('#query-items')).toHaveText('latest:4:price:a,b');
    await browserExpect(page.locator('#layout-summary')).toHaveText('latest:4');
    await settled(); expectReads(['latest',4]);
    release(); await page.unrouteAll({behavior:'wait'}); await settled();
    await browserExpect(page.locator('#query-items')).toHaveText('latest:4:price:a,b');
    await browserExpect(page.locator('#page-draft')).toHaveValue('edited while pending');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('unsaved layout');
    await browserExpect(page.locator('#service-draft')).toHaveValue('unsaved service');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt'); expect(rpc).toHaveLength(0);
    expectReads();
    await page.locator('#leave-list').click(); await page.locator('#return-list').click();
    await browserExpect(page.locator('#query-items')).toHaveText(':1:name:');
    await browserExpect(page.locator('#page-draft')).toHaveValue('');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('');
    await browserExpect(page.locator('#service-draft')).toHaveValue('');
    await browserExpect(page.locator('#file-name')).toHaveText('');
    await browserExpect(page.locator('#page-child-outer')).toHaveValue('');
    await browserExpect(page.locator('#page-child-leaf')).toHaveValue('');
    await browserExpect(page.locator('#layout-child-leaf')).toHaveValue('');
    await browserExpect(page.locator('#cache-a-outer')).toHaveValue('');
    await browserExpect(page.locator('#cache-a-leaf')).toHaveValue('');
    await browserExpect(page.locator('#cache-a-filename')).toHaveText('');
    await settled(); expectReads(['',1]);
    await page.evaluate(async () => {
      window.__scopeEvents=[];
      window.__allowRetire=true;
      await window.__queryTestApp.navigate('/retire');
    });
    await browserExpect(page.locator('#transient-child')).toHaveText('Transient child');
    await page.evaluate(() => window.__queryTestApp.navigate('/plain'));
    await browserExpect(page.locator('#return-list')).toHaveCount(1);
    await browserExpect.poll(() => page.evaluate(() => typeof window.__finishScopeCleanup)).toBe('function');
    expect(await page.evaluate(() => window.__scopeEvents)).toEqual([]);
    await page.evaluate(() => { window.__finishScopeCleanup(); delete window.__finishScopeCleanup; });
    await browserExpect.poll(() => page.evaluate(() => window.__scopeEvents)).toEqual(['cleanup-open','disposed']);
    await settled(); expectReads();
  } finally { release?.(); await page.unrouteAll({behavior:'wait'}); await page.close(); }
}
