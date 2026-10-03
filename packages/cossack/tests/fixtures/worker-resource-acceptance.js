import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';

export async function writeWorkerResourceAcceptance(root) {
  const write = async (name, source) => {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source);
  };
  await write('src/private-resource.ts', `
    import { getRequestContext } from '@cossackframework/core';
    import { sql } from '@cossackframework/database';
    export async function readResource(id: number) {
      if (id === -1) throw new Error('PRIVATE_RESOURCE_FAILURE_SENTINEL');
      // Return intentionally invalid values behind normal JSON method types.
      if (id === 4) return new Date() as unknown as {id:number;actor:string};
      if (id === 5) return {toJSON:()=>({id:5,actor:'unsafe'})} as unknown as {id:number;actor:string};
      const query = await sql<{id:number}>\`SELECT \${id} AS id\`;
      return {id:query.rows[0].id, actor:(getRequestContext()!.get('user') as {id:string}|undefined)?.id ?? 'anonymous'};
    }
  `);
  for (const transport of ['http', 'sse']) {
    await write(`src/pages/resource-check/${transport}/index.ts`, `
      import { Client, ClientState, Cossack, Page, server$ } from '@cossackframework/core';
      import { html } from '@cossackframework/renderer';
      import { readResource } from '../../../private-resource';
      @Page({transport:'${transport}'})
      export default class ResourcePage extends Cossack<{}, {Resources:'record'}> {
        @ClientState() id = 1;
        record = server$(async (id:number) => readResource(id), {deps:()=>[this.id] as const, initial:{id:0,actor:''}});
        onMount() { (window as any).__resourceReady = true; }
        @Client() select(event:Event) { this.id = Number((event.currentTarget as HTMLSelectElement).value); }
        @Client() async refresh() { await this.refresh$('record'); }
        render() {
          const status = this.resourceStatus$('record');
          return html\`<main>
            <h1>Native resource</h1>
            <select aria-label="Record" .value=\${String(this.id)} @change=\${this.select}>
              <option value="1">One</option><option value="2">Two</option><option value="3">Three</option><option value="-1">Fail</option>
            </select>
            <span id="resource-value">\${status.hasValue ? status.value.id + '/' + status.value.actor : 'missing'}</span>
            <output role="status">\${status.state}</output>
            <p role="alert">\${status.state === 'error' ? 'Resource failed; retry.' : ''}</p>
            <button @click=\${this.refresh} ?disabled=\${status.state === 'pending'}>Refresh</button>
          </main>\`;
        }
      }
    `);
  }
}

export async function checkWorkerResourceAcceptance(server, serverUrl, sessionCookie, readHydration) {
  const origin = serverUrl.origin;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const transport of ['http', 'sse']) {
      const response = await server.fetch('/resource-check/' + transport, { headers: { cookie: sessionCookie } });
      const rendered = await response.text();
      expect(response.status, transport + '/' + rendered).toBe(200);
      expect(readHydration(rendered).serverResources).toEqual({ record: { argsKey: '[1]', value: {id:1,actor:'u1'} } });
      const context = await browser.newContext();
      await context.addCookies([{ name:'session_id', value:sessionCookie.split(';')[0].slice('session_id='.length), url:origin, httpOnly:true }]);
      const page = await context.newPage();
      const calls = [];
      const errors = [];
      page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') calls.push(request.postDataJSON()); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/resource-check/' + transport);
      await page.waitForFunction(() => window.__resourceReady === true);
      await browserExpect(page.locator('#resource-value')).toHaveText('1/u1');
      await browserExpect(page.getByRole('status')).toHaveText('ready');
      expect(calls).toEqual([]);
      const selected = page.getByLabel('Record');
      await selected.selectOption('2');
      await browserExpect(page.locator('#resource-value')).toHaveText('2/u1');
      await browserExpect(page.getByRole('status')).toHaveText('ready');
      expect(calls).toHaveLength(1);
      // Reuse the browser's real compiled target/action for direct forged calls.
      for (const id of [4,5]) {
        const rejected = await server.fetch('/crpc', {method:'POST', headers:{origin,cookie:sessionCookie,'content-type':'application/json'},
          body:JSON.stringify({...calls[0],payload:[id]})});
        expect(rejected.status).toBe(500);
        expect(await rejected.json()).toMatchObject({error:'Internal Server Error'});
      }
      await selected.selectOption('-1');
      await browserExpect(page.getByRole('alert')).toHaveText('Resource failed; retry.');
      await browserExpect(page.locator('#resource-value')).toHaveText('2/u1');
      expect(await page.locator('main').textContent()).not.toContain('PRIVATE_RESOURCE_FAILURE_SENTINEL');
      await selected.selectOption('3');
      await browserExpect(page.locator('#resource-value')).toHaveText('3/u1');
      await browserExpect(page.getByRole('status')).toHaveText('ready');
      expect(calls).toHaveLength(3);
      await page.getByRole('button', {name:'Refresh',exact:true}).click();
      await browserExpect(page.getByRole('status')).toHaveText('ready');
      await browserExpect.poll(() => calls.length).toBe(4);
      await browserExpect(page.locator('#resource-value')).toHaveText('3/u1');
      expect(calls.map(call => call.payload)).toEqual([[2], [-1], [3], [3]]);
      for (const call of calls) expect(call.state?.public ?? {}).not.toHaveProperty('id');
      expect(errors).toEqual([]);
      await context.close();
    }
  } finally { await browser.close(); }
}
