import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
export async function writeUrlStateAcceptance(root) {
  const directory = path.join(root, 'src/pages/list'); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(root, 'src/filters.ts'), `
    import {defineUrlState,url} from '@cossackframework/core';
    export const filters=defineUrlState({search:url.string(),page:url.integer({default:1,min:1}),sort:url.enum(['name','price']),tags:url.array(url.string())});
  `);
  await fs.writeFile(path.join(directory, 'layout.ts'), `
    import {Cossack,CossackService,Page,Service,State,Inject,ClientStore,server$} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    import {filters} from '../../filters';
    @Service() class DraftService extends CossackService { @State() text=''; }
    @Page({transport:'http',services:[DraftService]}) export default class Layout extends Cossack {
      @Inject(DraftService) service!:DraftService;
      @ClientStore() draft={text:''};
      summary=server$(async(search:string,page:number)=>search+':'+page,{initial:'',deps:()=>[this.urlState(filters).search,this.urlState(filters).page] as const});
      render(){return html\`<section><p id="layout-summary">\${this.summary}</p>
        <input id="layout-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        <input id="service-draft" .value=\${this.service.text} @input=\${(event:Event)=>{this.service.text=(event.target as HTMLInputElement).value;}}>
        \${this.children}</section>\`;}
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
    import {html} from '@cossackframework/renderer';
    import {filters} from '../../filters';
    @Page({transport:'http'}) export default class List extends Cossack {
      @ClientState() blocked=false;
      @ClientState() outcome='';
      @PreventNavigation() prevent(){return this.blocked;}
      @ClientState() file:File|undefined=undefined;
      @ClientStore() draft={text:''};
      get filters(){return this.urlState(filters);}
      items=server$(async(search:string,page:number,sort:'name'|'price',tags:readonly string[])=>search+':'+page+':'+sort+':'+tags.join(','),
        {initial:'',deps:()=>[this.filters.search,this.filters.page,this.filters.sort,this.filters.tags] as const});
      @Client() change(){return this.updateUrlState(filters,{search:'雪 & books',page:2,sort:'price',tags:['a','b']});}
      @Client() replace(){return this.updateUrlState(filters,{page:this.filters.page+1},{history:'replace'});}
      @Client() rapid(){return Promise.all([this.updateUrlState(filters,{page:4}),this.updateUrlState(filters,{search:'rapid'})]);}
      @Client() async pageOnly(){this.outcome=(await this.updateUrlState(filters,{page:5})).outcome;}
      @Client() async searchOnly(){this.outcome=(await this.updateUrlState(filters,{search:'latest'})).outcome;}
      @Client() async fail(){this.outcome=(await this.updateUrlState(filters,{search:'failing'})).outcome;}
      @Client() leave(){return this.navigate('/plain');}
      render(){return html\`<main id="rows"><p id="query-values">\${JSON.stringify(this.filters)}</p><p id="query-items">\${this.items}</p>
        <input id="page-draft" .value=\${this.draft.text} @input=\${(event:Event)=>{this.draft.text=(event.target as HTMLInputElement).value;}}>
        <input id="draft-file" type="file" @change=\${(event:Event)=>{this.file=(event.target as HTMLInputElement).files?.[0];}}><span id="file-name">\${this.file?.name??''}</span>
        <button id="page-only" @click=\${this.pageOnly}>Page</button><button id="search-only" @click=\${this.searchOnly}>Search</button>
        <button id="fail-query" @click=\${this.fail}>Fail</button><button id="toggle-guard" @click=\${()=>{this.blocked=!this.blocked;}}>Guard</button>
        <span id="query-outcome">\${this.outcome}</span>
        <button id="rapid-query" @click=\${this.rapid}>Rapid</button><button id="leave-list" @click=\${this.leave}>Leave</button>
        <button id="change-query" @click=\${this.change}>Change</button><button id="replace-query" @click=\${this.replace}>Replace</button></main>\`;}
    }
  `);
}
export async function checkUrlStateBrowser(browser, origin) {
  const page = await browser.newPage(); const rpc = []; let release;
  page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') rpc.push(request); });
  const settled = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    const initial = await page.goto(origin + '/list?search=old&utm=a%20b#rows');
    expect(initial.status()).toBe(200); expect(await initial.text()).toContain('old:1:name:');
    await browserExpect(page.locator('#query-items')).toHaveText('old:1:name:'); await settled(); expect(rpc).toHaveLength(0);
    await page.locator('#page-draft').fill('unsaved page'); await page.locator('#layout-draft').fill('unsaved layout'); await page.locator('#service-draft').fill('unsaved service');
    await page.locator('#draft-file').setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('draft')});
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    await page.locator('#change-query').click(); await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:2:price:a,b');
    await browserExpect(page.locator('#page-draft')).toHaveValue('unsaved page');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('unsaved layout');
    await browserExpect(page.locator('#service-draft')).toHaveValue('unsaved service');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    await browserExpect(page.locator('#layout-summary')).toHaveText('雪 & books:2');
    const changed = new URL(page.url()); expect(changed.searchParams.get('utm')).toBe('a b'); expect(changed.hash).toBe('#rows');
    await settled(); expect(rpc).toHaveLength(0); // Matching SSR data satisfies the same query-derived dependencies.
    await page.goBack(); await browserExpect(page.locator('#query-items')).toHaveText('old:1:name:');
    await page.goForward(); await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:2:price:a,b');
    await browserExpect(page.locator('#page-draft')).toHaveValue('unsaved page');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt');
    const length = await page.evaluate(() => history.length);
    await page.locator('#replace-query').click(); await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:3:price:a,b');
    expect(await page.evaluate(() => history.length)).toBe(length); await settled(); expect(rpc).toHaveLength(0);
    const copied = await browser.newPage();
    try {
      const response = await copied.goto(page.url()); expect(response.status()).toBe(200);
      await browserExpect(copied.locator('#query-items')).toHaveText('雪 & books:3:price:a,b');
      expect(JSON.parse(await copied.locator('#query-values').textContent())).toEqual({ search: '雪 & books', page: 3, sort: 'price', tags: ['a', 'b'] });
      await browserExpect(copied.locator('#page-draft')).toHaveValue(''); await browserExpect(copied.locator('#file-name')).toHaveText('');
      await copied.goto(origin + '/list?page=0'); await browserExpect(copied.locator('#query-items')).toHaveText(':1:name:');
    } finally { await copied.close(); }
    await page.locator('#rapid-query').click(); await browserExpect(page.locator('#query-items')).toHaveText('rapid:4:price:a,b');
    await browserExpect(page.locator('#layout-summary')).toHaveText('rapid:4');
    await browserExpect(page.locator('#page-draft')).toHaveValue('unsaved page');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('unsaved layout');
    await browserExpect(page.locator('#service-draft')).toHaveValue('unsaved service');
    await settled(); expect(rpc).toHaveLength(0);
    const beforePrevented = page.url();
    await page.locator('#toggle-guard').click(); await page.locator('#page-only').click();
    await browserExpect(page.locator('#query-outcome')).toHaveText('canceled'); expect(page.url()).toBe(beforePrevented);
    await browserExpect(page.locator('#query-items')).toHaveText('rapid:4:price:a,b');
    await page.locator('#toggle-guard').click();
    await page.evaluate(() => document.addEventListener('cossack:navigation-error', event => event.preventDefault()));
    const failedQuery = url => url.pathname === '/list' && url.searchParams.get('search') === 'failing';
    await page.route(failedQuery, route => route.fulfill({status:503,body:'unavailable'}));
    await page.locator('#fail-query').click(); await browserExpect(page.locator('#query-outcome')).toHaveText('failed');
    expect(page.url()).toBe(beforePrevented); await page.unroute(failedQuery);
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
    await page.locator('#page-draft').fill('edited while pending');
    await page.locator('#search-only').click(); await browserExpect(page.locator('#query-items')).toHaveText('latest:5:price:a,b');
    await browserExpect(page.locator('#layout-summary')).toHaveText('latest:5');
    release(); await page.unrouteAll({behavior:'wait'}); await settled();
    await browserExpect(page.locator('#query-items')).toHaveText('latest:5:price:a,b');
    await browserExpect(page.locator('#page-draft')).toHaveValue('edited while pending');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('unsaved layout');
    await browserExpect(page.locator('#service-draft')).toHaveValue('unsaved service');
    await browserExpect(page.locator('#file-name')).toHaveText('draft.txt'); expect(rpc).toHaveLength(0);
    await page.locator('#leave-list').click(); await page.locator('#return-list').click();
    await browserExpect(page.locator('#query-items')).toHaveText(':1:name:');
    await browserExpect(page.locator('#page-draft')).toHaveValue('');
    await browserExpect(page.locator('#layout-draft')).toHaveValue('');
    await browserExpect(page.locator('#service-draft')).toHaveValue('');
    await browserExpect(page.locator('#file-name')).toHaveText('');
  } finally { release?.(); await page.unrouteAll({behavior:'wait'}); await page.close(); }
}
