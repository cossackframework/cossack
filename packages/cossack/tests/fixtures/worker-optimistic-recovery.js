import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';

export async function writeWorkerOptimisticRecovery(root) {
  const write = async (name, source) => {
    const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, source);
  };
  await write('src/private-optimistic-recovery.ts', `
    import { getRequestContext } from '@cossackframework/core';
    import { sql } from '@cossackframework/database';
    function key(scope: string) { return (getRequestContext()!.get('user') as {id:string}).id + ':' + scope; }
    async function ensure(scope: string) {
      await sql\`CREATE TABLE IF NOT EXISTS optimistic_recovery (id TEXT PRIMARY KEY, count INTEGER NOT NULL, mutations INTEGER NOT NULL, reads INTEGER NOT NULL)\`;
      await sql\`INSERT OR IGNORE INTO optimistic_recovery VALUES (\${key(scope)}, 0, 0, 0)\`;
    }
    export async function readCounter(scope: string) {
      await ensure(scope);
      await sql\`UPDATE optimistic_recovery SET reads = reads + 1 WHERE id = \${key(scope)}\`;
      const rows = await sql<{count:number}>\`SELECT count FROM optimistic_recovery WHERE id = \${key(scope)}\`;
      return rows.rows[0]!;
    }
    export async function incrementCounter(scope: string) {
      await ensure(scope);
      await sql\`UPDATE optimistic_recovery SET count = count + 1, mutations = mutations + 1 WHERE id = \${key(scope)}\`;
      const rows = await sql<{count:number}>\`SELECT count FROM optimistic_recovery WHERE id = \${key(scope)}\`;
      return rows.rows[0]!;
    }
    export async function auditCounter(scope: string) {
      await ensure(scope);
      const rows = await sql<{count:number;mutations:number;reads:number}>\`SELECT count, mutations, reads FROM optimistic_recovery WHERE id = \${key(scope)}\`;
      return rows.rows[0]!;
    }
  `);
  await write('src/services/RecoveryCounter.ts', `
    import { Service, Server, ClientState, Optimistic, optimistic, CossackService, input } from '@cossackframework/core';
    import { incrementCounter } from '../private-optimistic-recovery';
    @Service() export default class RecoveryCounter extends CossackService {
      @ClientState() previewCount = 0;
      @Optimistic('incrementService') preview() { optimistic<RecoveryCounter>(this).increment('previewCount', 1); }
      @Server({input:input.object({scope:input.enum(['http','sse'] as const)})})
      async incrementService(value:{scope:'http'|'sse'}) { return incrementCounter(value.scope); }
    }
  `);
  await write('src/pages/resource-check/recovery/layout.ts', `
    import { Cossack, Page, Inject } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import RecoveryCounter from '../../../services/RecoveryCounter';
    @Page({services:[RecoveryCounter]}) export default class RecoveryLayout extends Cossack {
      @Inject(RecoveryCounter) service!: RecoveryCounter;
      render() { return html\`<nav><a href="/resource-check/recovery/watch">Watch retained service</a>
        <a href="/resource-check/recovery/http">HTTP recovery</a><a href="/resource-check/recovery/sse">SSE recovery</a></nav>
        <span id="layout-preview">\${this.service.previewCount}</span>
        <span id="layout-loading">\${this.loading.incrementService ?? 0}</span>\${this.children}\`; }
    }
  `);
  await write('src/pages/resource-check/recovery/watch/index.ts', `
    import { Cossack, Page, Component, Inject, Client } from '@cossackframework/core';
    import { html, component } from '@cossackframework/renderer';
    import RecoveryCounter from '../../../../services/RecoveryCounter';
    @Component({transport:'http'}) class NestedWatcher extends Cossack {
      @Inject(RecoveryCounter) service!: RecoveryCounter;
      render() { return html\`<span id="nested-preview">\${this.service.previewCount}</span>
        <span id="nested-loading">\${this.loading.incrementService ?? 0}</span>\`; }
    }
    @Page({transport:'http'}) export default class ServiceWatcher extends Cossack {
      @Inject(RecoveryCounter) service!: RecoveryCounter;
      @Client() onMount() { (window as any).__watcher = this; }
      render() { return html\`<main><span id="watcher-preview">\${this.service.previewCount}</span>
        <span id="watcher-loading">\${this.loading.incrementService ?? 0}</span>\${component(NestedWatcher)}</main>\`; }
    }
  `);
  await write('src/pages/api/rpc-check/recovery.ts', `
    import type { Context } from 'hono';
    import { auditCounter } from '../../../private-optimistic-recovery';
    export const GET = async (c:Context) => c.json(await auditCounter(c.req.query('scope') ?? 'http'));
  `);
  for (const transport of ['http', 'sse']) {
    await write(`src/pages/resource-check/recovery/${transport}/index.ts`, `
      import { Cossack, Page, Client, ClientState, Server, Optimistic, Inject, input, server$ } from '@cossackframework/core';
      import { html } from '@cossackframework/renderer';
      import { readCounter, incrementCounter } from '../../../../private-optimistic-recovery';
      import RecoveryCounter from '../../../../services/RecoveryCounter';
      @Page({transport:'${transport}'}) export default class RecoveryPage extends Cossack<{}, {Resources:'counter'}> {
        @ClientState() scope = '${transport}' as 'http'|'sse';
        @ClientState() previewCount = 0;
        @ClientState() failure = '';
        @ClientState() recovery = '';
        @Inject(RecoveryCounter) service!: RecoveryCounter;
        counter = server$(async (scope:string) => readCounter(scope), {deps:()=>[this.scope] as const, initial:{count:0}});
        @Optimistic('incrementPersisted') preview() { this.previewCount = this.counter.count + 1; }
        @Server({input:input.object({scope:input.enum(['http','sse'] as const)})})
        async incrementPersisted(value:{scope:'http'|'sse'}) { return incrementCounter(value.scope); }
        @Client() onMount() { (window as any).__recovery = this; }
        @Client() async incrementAndRecover(useService:boolean) {
          try {
            await (useService ? this.service.incrementService({scope:this.scope}) : this.incrementPersisted({scope:this.scope}));
          } catch (error) {
            this.failure = (error as {code:string}).code;
            const result = await this.reconcile$(error, 'counter');
            this.recovery = result.state;
          }
        }
        render() {
          const status = this.resourceStatus$('counter');
          return html\`<main><span id="counter">\${status.value?.count ?? 0}</span><span id="read-state">\${status.state}</span>
            <span id="preview">\${this.previewCount}</span><span id="service-preview">\${this.service.previewCount}</span>
            <span id="mutation-loading">\${(this.loading.incrementPersisted || 0) + (this.loading.incrementService || 0)}</span>
            <span id="uncertainty">\${this.failure}</span><span id="recovery">\${this.recovery}</span></main>\`;
        }
      }
    `);
  }
}

export async function checkWorkerOptimisticRecovery(server, serverUrl, sessionCookie) {
  const origin = serverUrl.origin, browser = await chromium.launch({ headless: true });
  const audit = async scope => {
    const response = await server.fetch('/api/rpc-check/recovery?scope=' + scope, {headers:{cookie:sessionCookie}});
    expect(response.status).toBe(200); return response.json();
  };
  try {
    for (const transport of ['http', 'sse']) {
      const context = await browser.newContext();
      await context.addCookies([{ name:'session_id', value:sessionCookie.split(';')[0].slice('session_id='.length), url:origin, httpOnly:true }]);
      const page = await context.newPage(); const requests = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') requests.push(request.postDataJSON()); });
      await page.goto(origin + '/resource-check/recovery/' + transport);
      await page.waitForFunction(() => !!window.__recovery);
      if (transport === 'sse') await page.waitForFunction(() => window.__recovery.realtime.sse.state === 'open');
      await browserExpect(page.locator('#counter')).toHaveText('0');
      await browserExpect(page.locator('#read-state')).toHaveText('ready');
      const initial = await audit(transport); expect(initial).toEqual({count:0,mutations:0,reads:1});
      for (const service of [false, true]) {
        requests.length = 0; const before = await audit(transport);
        let consumed;
        await page.route('**/crpc**', async route => {
          const body = route.request().postDataJSON();
          if (body.action === (service ? 'incrementService' : 'incrementPersisted')) {
            // The real server finished, its D1 write committed, and the whole
            // response was consumed before the browser deliberately loses it.
            const response = await route.fetch({maxRedirects:0,maxRetries:0});
            expect(response.status()).toBe(200); consumed = await response.json();
            expect(await audit(transport)).toMatchObject({count:before.count+1,mutations:before.mutations+1});
            await route.abort('failed');
          } else await route.continue();
        });
        await page.evaluate(async service => { await window.__recovery.incrementAndRecover(service); }, service);
        expect(consumed).toBeTruthy();
        await browserExpect(page.locator('#uncertainty')).toHaveText('COSSACK_RPC_NETWORK_FAILED');
        await browserExpect(page.locator('#recovery')).toHaveText('recovered');
        await browserExpect(page.locator('#counter')).toHaveText(String(before.count + 1));
        await browserExpect(page.locator('#read-state')).toHaveText('ready');
        await browserExpect(page.locator('#mutation-loading')).toHaveText('0');
        await browserExpect(page.locator(service ? '#service-preview' : '#preview')).toHaveText('0');
        expect(requests).toHaveLength(2);
        expect(requests.filter(body => body.action === (service ? 'incrementService' : 'incrementPersisted'))).toHaveLength(1);
        expect(requests.filter(body => body.action !== (service ? 'incrementService' : 'incrementPersisted'))).toHaveLength(1);
        if (service) expect(requests[0].service).toBeTruthy();
        expect(await audit(transport)).toEqual({count:before.count+1,mutations:before.mutations+1,reads:before.reads+1});
        expect(errors).toEqual([]); await page.unroute('**/crpc**');
      }
      // Consume a real committed service response, but hold browser delivery
      // until the originating page exits and new consumers inject the service.
      requests.length = 0;
      const beforeRetained = await audit(transport);
      let release, committed;
      const held = new Promise(resolve => { release = resolve; });
      const committedReply = new Promise(resolve => { committed = resolve; });
      await page.route('**/crpc**', async route => {
        if (route.request().postDataJSON().action !== 'incrementService') return route.continue();
        const response = await route.fetch({maxRedirects:0,maxRetries:0});
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({_cossack_return:{count:beforeRetained.count+1}});
        committed(); await held; await route.fulfill({response});
      });
      await page.evaluate(scope => {
        window.__retainedFailure = '';
        window.__retainedCall = window.__recovery.service.incrementService({scope});
        window.__retainedDone = Promise.resolve(window.__retainedCall).catch(error => { window.__retainedFailure = error.code; });
      }, transport);
      await committedReply;
      expect(await audit(transport)).toEqual({count:beforeRetained.count+1,mutations:beforeRetained.mutations+1,reads:beforeRetained.reads});
      await browserExpect(page.locator('#layout-loading')).toHaveText('1');
      await page.getByRole('link', {name:'Watch retained service',exact:true}).click();
      await page.waitForFunction(() => !!window.__watcher);
      for (const name of ['layout','watcher','nested']) {
        await browserExpect(page.locator('#' + name + '-loading')).toHaveText('1');
        await browserExpect(page.locator('#' + name + '-preview')).toHaveText('1');
      }
      release(); await page.evaluate(() => window.__retainedDone);
      for (const name of ['layout','watcher','nested']) {
        await browserExpect(page.locator('#' + name + '-loading')).toHaveText('0');
        await browserExpect(page.locator('#' + name + '-preview')).toHaveText('1');
      }
      expect(await page.evaluate(() => window.__retainedFailure)).toBe('');
      expect(requests.filter(body => body.action === 'incrementService')).toHaveLength(1);
      await page.unroute('**/crpc**');

      // A real server input rejection never writes D1. Its preview is removed
      // after returning to a page that did not start the invocation.
      let releaseInvalid;
      const invalidGate = new Promise(resolve => { releaseInvalid = resolve; });
      await page.route('**/crpc**', async route => { await invalidGate; await route.continue(); });
      await page.evaluate(() => {
        window.__retainedCall = window.__watcher.service.incrementService({scope:'invalid'});
        window.__retainedDone = Promise.resolve(window.__retainedCall).catch(error => { window.__retainedFailure = error.code; });
      });
      await browserExpect(page.locator('#watcher-preview')).toHaveText('2');
      await page.getByRole('link', {name:transport === 'http' ? 'HTTP recovery' : 'SSE recovery',exact:true}).click();
      if (transport === 'sse') await page.waitForFunction(() => window.__recovery.realtime.sse.state === 'open');
      await browserExpect(page.locator('#mutation-loading')).toHaveText('1');
      await browserExpect(page.locator('#service-preview')).toHaveText('2');
      releaseInvalid(); await page.evaluate(() => window.__retainedDone);
      await browserExpect(page.locator('#mutation-loading')).toHaveText('0');
      await browserExpect(page.locator('#layout-loading')).toHaveText('0');
      await browserExpect(page.locator('#service-preview')).toHaveText('1');
      expect(await page.evaluate(() => window.__retainedFailure)).toBe('COSSACK_VALIDATION_FAILED');
      expect(requests.filter(body => body.action === 'incrementService')).toHaveLength(2);
      const afterRetained = await audit(transport);
      expect(afterRetained).toMatchObject({count:beforeRetained.count+1,mutations:beforeRetained.mutations+1});
      expect(errors).toEqual([]); await page.unroute('**/crpc**');
      await context.close();
    }
  } finally { await browser.close(); }
}
