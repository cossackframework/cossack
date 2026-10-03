import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';
export async function writeUrlStateAcceptance(root) {
  const directory = path.join(root, 'src/pages/list'); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'index.ts'), `
    import {Cossack,Page,Client,server$,defineUrlState,url} from '@cossackframework/core';
    import {html} from '@cossackframework/renderer';
    const filters=defineUrlState({search:url.string(),page:url.integer({default:1,min:1}),sort:url.enum(['name','price']),tags:url.array(url.string())});
    @Page({transport:'http'}) export default class List extends Cossack {
      get filters(){return this.urlState(filters);}
      items=server$(async(search:string,page:number,sort:'name'|'price',tags:readonly string[])=>search+':'+page+':'+sort+':'+tags.join(','),
        {initial:'',deps:()=>[this.filters.search,this.filters.page,this.filters.sort,this.filters.tags] as const});
      @Client() change(){return this.navigate(filters.url(this.c.req.url,{search:'雪 & books',page:2,sort:'price',tags:['a','b']}));}
      @Client() replace(){return this.navigate(filters.url(this.c.req.url,{page:this.filters.page+1}),{history:'replace'});}
      render(){return html\`<main id="rows"><p id="query-values">\${JSON.stringify(this.filters)}</p><p id="query-items">\${this.items}</p>
        <button id="change-query" @click=\${this.change}>Change</button><button id="replace-query" @click=\${this.replace}>Replace</button></main>\`;}
    }
  `);
}
export async function checkUrlStateBrowser(browser, origin) {
  const page = await browser.newPage(); const rpc = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') rpc.push(request); });
  const settled = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    const initial = await page.goto(origin + '/list?search=old&utm=a%20b#rows');
    expect(initial.status()).toBe(200); expect(await initial.text()).toContain('old:1:name:');
    await browserExpect(page.locator('#query-items')).toHaveText('old:1:name:'); await settled(); expect(rpc).toHaveLength(0);
    await page.locator('#change-query').click(); await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:2:price:a,b');
    const changed = new URL(page.url()); expect(changed.searchParams.get('utm')).toBe('a b'); expect(changed.hash).toBe('#rows');
    await settled(); expect(rpc).toHaveLength(0); // Matching SSR data satisfies the same query-derived dependencies.
    await page.goBack(); await browserExpect(page.locator('#query-items')).toHaveText('old:1:name:');
    await page.goForward(); await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:2:price:a,b');
    const length = await page.evaluate(() => history.length);
    await page.locator('#replace-query').click(); await browserExpect(page.locator('#query-items')).toHaveText('雪 & books:3:price:a,b');
    expect(await page.evaluate(() => history.length)).toBe(length); await settled(); expect(rpc).toHaveLength(0);
    const copied = await browser.newPage();
    try {
      const response = await copied.goto(page.url()); expect(response.status()).toBe(200);
      await browserExpect(copied.locator('#query-items')).toHaveText('雪 & books:3:price:a,b');
      expect(JSON.parse(await copied.locator('#query-values').textContent())).toEqual({ search: '雪 & books', page: 3, sort: 'price', tags: ['a', 'b'] });
      await copied.goto(origin + '/list?page=0'); await browserExpect(copied.locator('#query-items')).toHaveText(':1:name:');
    } finally { await copied.close(); }
  } finally { await page.close(); }
}
