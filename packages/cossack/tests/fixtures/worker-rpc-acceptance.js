import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, vi } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import { readRpcStream } from '../../../core/dist/index.js';
import { writeCounterCancellation, checkCounterCancellation } from './worker-counter-cancellation.js';
import { writeWorkerPolicyAcceptance, checkWorkerPolicyAcceptance } from './worker-policy-acceptance.js';
import { writeWorkerSchemaAcceptance, checkWorkerSchemaAcceptance } from './worker-schema-acceptance.js';
import { writeWorkerResourceAcceptance, checkWorkerResourceAcceptance } from './worker-resource-acceptance.js';

// These endpoints and D1 audit records exist only in the generated test app.
// The gate proves an early yield without depending on browser timing; audit
// writes prove the original request's ORM remains usable through disposal.
export async function writeWorkerRpcAcceptance(root) {
  const write = async (name, source) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), source);
  };
  await writeCounterCancellation(root);
  await writeWorkerPolicyAcceptance(root);
  await writeWorkerSchemaAcceptance(root);
  await writeWorkerResourceAcceptance(root);
  await write('src/rpc-audit.ts', `
    import { getRequestContext } from '@cossackframework/core';
    import { sql } from '@cossackframework/database';
    export async function audit(key: string, kind: string) {
      const c = getRequestContext()!;
      await sql\`INSERT INTO rpc_audit VALUES (\${key}, \${kind}, \${c.req.path}, \${c.get('user')?.id ?? 'anonymous'})\`;
    }
  `);
  await write('src/services/RpcAcceptance.ts', `
    import { CossackService, Service, Server, State, RateLimit, input, cookie, flash, flashInput, getRequestContext } from '@cossackframework/core';
    import { config } from '@cossackframework/framework/config';
    import { sql } from '@cossackframework/database';
    import { audit } from '../rpc-audit';
    @Service()
    export class RpcAcceptance extends CossackService {
      @State() visits = 0;
      private key = '';
      @Server() @RateLimit({ max: 100, backendTimeoutMs: 100, key: c => c.req.header('X-Counter-Case')! })
      async counterDeadline(key: string) { await audit(key, 'guarded'); return 'saved'; }
      @Server() @RateLimit({ max: 100, backendTimeoutMs: 10000, key: c => c.req.header('X-Counter-Case')! })
      async counterGuarded(key: string) {
        getRequestContext()!.res = new Response(null, { headers: { 'X-Counter-Context': 'set' } });
        await audit(key, 'guarded'); return 'saved';
      }
      @Server() @RateLimit({ max: 1, window: 60000 })
      async limited(key: string) { this.key = key; await audit(key, 'limited'); return 'saved'; }
      @Server() @RateLimit({ requires: { shared: true, atomicIncrement: true } })
      async requiresShared(key: string) { await audit(key, 'guarantee-denied'); return 'saved'; }
      @Server({ input: input.object({title:input.string({required:true}),key:input.string({required:true}),nested:input.object({files:input.array(input.file({maxBytes:1024}),{minItems:1,maxItems:4})})}) })
      files(input: { title: string; key: string; nested: { files: File[] } }) {
        this.key = input.key; this.visits++;
        cookie().set('upload_early', 'kept', { httpOnly: true, path: '/' });
        return (async function* () { try {
          yield await input.nested.files[0].text();
          const deadline = Date.now() + 10000;
          while (true) {
            const row = await sql\`SELECT released FROM rpc_gate WHERE id = \${input.key}\`;
            if (row.rows[0]?.released || getRequestContext()?.req.raw.signal.aborted) break;
            if (Date.now() > deadline) throw new Error('Test did not release upload');
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          const value = await sql\`SELECT 7 AS value\`;
          return { name: input.nested.files[0].name, db: value.rows[0].value,
            path: getRequestContext()?.req.path, user: getRequestContext()?.get('user')?.id, url: config('app.url') };
        } finally { await audit(input.key, 'generator'); } })();
      }
      @Server() native(key: string, kind = 'ndjson') {
        this.key = key;
        const headers = { 'X-Native': 'kept', 'Set-Cookie': 'native_body=kept; HttpOnly; Path=/' };
        if (kind === 'json') return Response.json({ _cossack_return: 'opaque', count: 999 }, { status: 201, headers });
        if (kind === 'binary') return new Response(new Uint8Array([0, 255, 128]), { status: 201, headers: { ...headers, 'Content-Type': 'application/octet-stream' } });
        if (kind === 'empty') return new Response(null, { status: 204, headers });
        let sent = false;
        return new Response(new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (sent) { controller.close(); return; }
            sent = true;
            const value = await sql\`SELECT 7 AS value\`;
            controller.enqueue(new TextEncoder().encode('opaque🙂/' + value.rows[0].value + '/' + getRequestContext()?.req.path + '\\n'));
          },
        }, { highWaterMark: 0 }), { status: 201, headers: {
          ...headers, 'Content-Type': 'application/x-cossack-rpc+ndjson',
        } });
      }
      @Server() complete(key: string) {
        this.key = key;
        cookie().set('context_cookie', 'kept', { httpOnly: true, path: '/' });
        flash('success', 'Saved'); flashInput({ title: 'Draft' }, { fields: ['title'] });
        const headers = new Headers({ Location: '/rpc-check/target' });
        headers.append('Set-Cookie', 'native_one=1; HttpOnly; Path=/');
        headers.append('Set-Cookie', 'native_two=2; HttpOnly; Path=/');
        return new Response(null, { status: 302, headers });
      }
      @Server() async *late() { yield 'first'; cookie().set('late_cookie', 'lost'); return 'unreachable'; }
      async onDispose() { if (this.key) await audit(this.key, 'service'); }
    }
  `);
  await write('src/pages/rpc-check/layout.ts', `
    import { Cossack, Page } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { RpcAcceptance } from '../../services/RpcAcceptance';
    @Page({ services: [RpcAcceptance], middlewares: [async (c, next) => {
      if (!c.get('user')) return c.text('RPC authentication required', 401);
      await next(); c.header('X-Rpc-Guard', 'ran');
    }] })
    export default class RpcLayout extends Cossack { render() { return html\`\${this.children}\`; } }
  `);
  for (const transport of ['http', 'sse']) {
    await write(`src/pages/rpc-check/${transport}/index.ts`, `
      import { Cossack, Page, Server, Client, ClientState, State, Inject, RateLimit, getRequestContext, rpc$, input } from '@cossackframework/core';
      import { html } from '@cossackframework/renderer';
      import { RpcAcceptance } from '../../../services/RpcAcceptance';
      import { audit } from '../../../rpc-audit';
      @Page({ transport: '${transport}' })
      export default class Rpc${transport.toUpperCase()}Page extends Cossack {
        @Inject(RpcAcceptance) acceptance!: RpcAcceptance;
        @State() count = 0;
        @ClientState() output = ''; @ClientState() failure = ''; @ClientState() filesProgress = 0;
        private key = '';
        @Server() @RateLimit({ max: 100, backendTimeoutMs: 100, key: c => c.req.header('X-Counter-Case')! })
      async counterDeadline(key: string) { await audit(key, 'guarded'); return 'saved'; }
      @Server() @RateLimit({ max: 100, backendTimeoutMs: 10000, key: c => c.req.header('X-Counter-Case')! })
      async counterGuarded(key: string) {
        getRequestContext()!.res = new Response(null, { headers: { 'X-Counter-Context': 'set' } });
        await audit(key, 'guarded'); return 'saved';
      }
      @Server() @RateLimit({ max: 1, window: 60000 })
        async limited(key: string) { this.key = key; await audit(key, 'limited'); return 'saved'; }
        @Server() @RateLimit({ requires: { shared: true, atomicIncrement: true } })
        async requiresShared(key: string) { await audit(key, 'guarantee-denied'); return 'saved'; }
        @Server({ input: input.object({title:input.string({required:true}),key:input.string({required:true}),nested:input.object({files:input.array(input.file({maxBytes:1024}),{minItems:1,maxItems:4})})}) })
        files(input: { title: string; key: string; nested: { files: File[] } }) {
          this.key = input.key; this.count++;
          const inner = this.acceptance.files(input); const page = this;
          return (async function* () { const result = yield* inner; page.count++; return result; })();
        }
        @Server() native(key: string, kind = 'ndjson') { this.key = key; return this.acceptance.native(key, kind); }
        @Server() complete(key: string) { this.key = key; return this.acceptance.complete(key); }
        @Server() async *late() { return yield* this.acceptance.late(); }
        async onCleanup() { if (typeof window === 'undefined' && this.key) await audit(this.key, 'page'); }
        @Client() async upload(service = false) {
          this.failure = ''; this.output = '';
          try {
            const input = { title: 'Draft', key: 'browser-${transport}-' + (service ? 'service' : 'page'),
              nested: { files: [new File(['привет🙂'], 'unicode.txt')] } };
            const call = service ? rpc$(this.acceptance.files(input)) : rpc$(this.files(input));
            for await (const value of call) this.output = 'first:' + value;
            const value = await call;
            this.output = 'done:' + value.name + '/' + value.db + '/' + value.user + '/' + (service ? 'service' : this.filesProgress);
          } catch (error) { this.failure = error instanceof Error ? error.message : String(error); }
        }
        @Client() async body() {
          this.failure = '';
          try {
            const response = await rpc$(this.native('browser-${transport}-native'));
            if (!response) throw new Error('Missing native response');
            this.output = response.status + '/' + response.headers.get('X-Native') + '/' + await response.text();
          } catch (error) { this.failure = error instanceof Error ? error.message : String(error); }
        }
        @Client() async finish(service = false) {
          const key = 'browser-${transport}-redirect-' + (service ? 'service' : 'page');
          await (service ? rpc$(this.acceptance.complete(key)) : rpc$(this.complete(key)));
        }
        render() { return html\`<main><button @click=\${() => this.upload()}>Page upload</button>
          <button @click=\${() => this.upload(true)}>Service upload</button><button @click=\${this.body}>Native body</button>
          <button @click=\${() => this.finish()}>Page redirect</button><button @click=\${() => this.finish(true)}>Service redirect</button>
          <output role="status">\${this.output}</output><p role="alert">\${this.failure}</p></main>\`; }
      }
    `);
  }
  await write('src/pages/rpc-check/target/index.ts', `
    import { Cossack, Page, State, flashed, old } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    @Page() export default class Target extends Cossack {
      @State() notice = ''; @State() title = '';
      async init() { this.notice = flashed<string>('success') ?? ''; this.title = old<string>('title') ?? ''; }
      render() { return html\`<main>\${this.notice}/\${this.title}</main>\`; }
    }
  `);
  await write('src/pages/api/rpc-check.ts', `
    import { sql } from '@cossackframework/database';
    export const POST = async c => {
      const body = await c.req.json();
      await sql\`CREATE TABLE IF NOT EXISTS rpc_audit (id TEXT, kind TEXT, path TEXT, user TEXT, PRIMARY KEY (id, kind))\`;
      await sql\`CREATE TABLE IF NOT EXISTS rpc_gate (id TEXT PRIMARY KEY, released INTEGER)\`;
      if (body.release) await sql\`INSERT OR REPLACE INTO rpc_gate VALUES (\${body.release}, 1)\`;
      return c.json({ ok: true });
    };
    export const GET = async c => {
      const result = await sql\`SELECT kind, path, user FROM rpc_audit WHERE id = \${c.req.query('key')} ORDER BY kind\`;
      return c.json(result.rows);
    };
  `);
}

export async function checkWorkerRpcAcceptance(server, serverUrl, sessionCookie, readHydration) {
  const origin = serverUrl.origin;
  const headers = { origin, cookie: sessionCookie };
  const release = key => server.fetch('/api/rpc-check', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ release: key }) });
  expect((await release()).status).toBe(200);
  const audit = async key => (await server.fetch('/api/rpc-check?key=' + encodeURIComponent(key), { headers })).json();
  await checkWorkerResourceAcceptance(server,serverUrl,sessionCookie,readHydration);
  await checkWorkerPolicyAcceptance(server,serverUrl,sessionCookie,readHydration);
  await checkWorkerSchemaAcceptance(server,serverUrl,sessionCookie,readHydration);
  await checkCounterCancellation(server, serverUrl, sessionCookie, readHydration);
  const expectClosed = async (key, service, path = '/upload') => {
    await vi.waitFor(async () => expect(await audit(key)).toEqual((service ? ['generator', 'service'] : ['generator', 'page', 'service'])
      .map(kind => ({ kind, path, user: 'u1' }))), { timeout: 3000 });
  };
  for (const transport of ['http', 'sse']) {
    const page = await server.fetch('/rpc-check/' + transport, { headers });
    expect(page.status).toBe(200);
    const state = readHydration(await page.text());
    const owner = state._layout_stack.at(-1).componentRouteId;
    const invoke = (action, input, service = false, requestHeaders = headers) => {
      const form = new FormData();
      form.set('componentRouteId', state.componentRouteId); form.set('scopeKey', state.scopeKey);
      if (service) form.set('service', JSON.stringify({ ownerRouteId: owner, slot: '0' }));
      form.set('action', action); form.set('state', JSON.stringify({ count: 0 }));
      form.set('payload', JSON.stringify(input)); form.set('file_0', new File(['привет🙂'], 'unicode.txt'));
      return fetch(new URL('/upload', serverUrl), { method: 'POST', headers: requestHeaders, body: form });
    };
    for (const service of [false, true]) {
      const limitedKey = `limited-${transport}-${service}`;
      const guaranteeKey = `guarantee-${transport}-${service}`;
      const deniedGuarantee = await invoke('requiresShared', [guaranteeKey], service);
      expect(deniedGuarantee.status).toBe(500);
      expect(await deniedGuarantee.json()).toMatchObject({ code: 'COSSACK_RPC_INTERNAL_ERROR',
        requestId: deniedGuarantee.headers.get('X-Cossack-Request-Id') });
      expect(await audit(guaranteeKey)).toEqual([]);
      const envelope = { componentRouteId: state.componentRouteId, scopeKey: state.scopeKey,
        ...(service ? { service: { ownerRouteId: owner, slot: '0' } } : {}), action: 'limited', payload: [limitedKey] };
      const limited = await server.fetch('/crpc', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
      // The same layout service owns one budget across both page routes.
      if (service && transport === 'sse') {
        expect(limited.status).toBe(429);
        expect(await limited.json()).toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED', requestId: limited.headers.get('X-Cossack-Request-Id') });
        expect(await audit(limitedKey)).toEqual([]);
      } else {
        expect(limited.status).toBe(200); expect(await limited.json()).toMatchObject({ _cossack_return: 'saved' });
        await vi.waitFor(async () => expect(await audit(limitedKey)).toEqual(['limited', service ? 'service' : 'page']
          .map(kind => ({ kind, path: '/crpc', user: 'u1' }))));
      }
      const limitedAgainKey = limitedKey + '-denied';
      const limitedAgain = await invoke('limited', [limitedAgainKey], service);
      expect(limitedAgain.status).toBe(429); expect(limitedAgain.headers.get('Retry-After')).toMatch(/^\d+$/);
      expect(await limitedAgain.json()).toMatchObject({ code: 'COSSACK_RPC_RATE_LIMITED', requestId: limitedAgain.headers.get('X-Cossack-Request-Id') });
      expect(await audit(limitedAgainKey)).toEqual([]);
      const key = `direct-${transport}-${service}`;
      const input = { title: 'Draft', key, nested: { files: [{ _cossack_file_id: 'file_0' }] } };
      const denied = await invoke('files', [input], service, { origin });
      expect(denied.status).toBe(401); expect(await denied.text()).toBe('RPC authentication required');
      expect(await audit(key)).toEqual([]);
      const invalid = await invoke('files', [{ ...input, title: '' }], service);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ code: 'COSSACK_VALIDATION_FAILED', requestId: invalid.headers.get('X-Cossack-Request-Id'), fieldErrors: { title: expect.any(String) } });
      expect(await audit(key)).toEqual([]);
      for(const forged of [
        {...input,canEdit:true},
        {...input,nested:{files:[{name:'fake.txt',size:1,type:'text/plain'}]}},
        {...input,nested:{files:[]}},
      ]) {
        const rejected=await invoke('files',[forged],service);
        expect(rejected.status).toBe(400);
        expect(await rejected.json()).toMatchObject({code:'COSSACK_VALIDATION_FAILED',requestId:rejected.headers.get('X-Cossack-Request-Id'),fieldErrors:expect.any(Object)});
        expect(await audit(key)).toEqual([]);
      }
      const response = await invoke('files', [input], service);
      expect(response.status).toBe(200); expect(response.headers.get('X-Rpc-Guard')).toBe('ran');
      expect(response.headers.getSetCookie().some(value => value.startsWith('upload_early=kept'))).toBe(true);
      const iterator = readRpcStream(response)[Symbol.asyncIterator]();
      expect(await iterator.next()).toMatchObject({ value: { type: 'yield', value: 'привет🙂', requestId: response.headers.get('X-Cossack-Request-Id') } });
      expect(await audit(key)).toEqual([]);
      await release(key);
      expect(await iterator.next()).toMatchObject({ value: { type: 'done', value: { name: 'unicode.txt', db: 7, path: '/upload', user: 'u1', url: 'https://staging.example.test' } } });
      await iterator.next(); await expectClosed(key, service);
      const nativeKey = key + '-native';
      const native = await invoke('native', [nativeKey], service);
      expect(native.status).toBe(201); expect(native.headers.get('X-Cossack-Rpc-Response')).toBe('native');
      expect(native.headers.get('X-Native')).toBe('kept'); expect(await native.text()).toBe('opaque🙂/7//upload\n');
      await vi.waitFor(async () => expect(await audit(nativeKey)).toEqual((service ? ['service'] : ['page', 'service']).map(kind => ({ kind, path: '/upload', user: 'u1' }))));
      for (const kind of ['json', 'binary', 'empty']) {
        const key = nativeKey + '-' + kind;
        const response = await invoke('native', [key, kind], service);
        expect(response.status).toBe(kind === 'empty' ? 204 : 201);
        expect(response.headers.get('X-Cossack-Rpc-Response')).toBe('native'); expect(response.headers.get('X-Native')).toBe('kept');
        if (kind === 'json') expect(await response.json()).toEqual({ _cossack_return: 'opaque', count: 999 });
        else if (kind === 'binary') expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 128]);
        else { expect(response.body).toBeNull(); expect(await response.text()).toBe(''); }
        await vi.waitFor(async () => expect(await audit(key)).toEqual((service ? ['service'] : ['page', 'service']).map(kind => ({ kind, path: '/upload', user: 'u1' }))));
      }
      const late = await invoke('late', [], service);
      const lateFrames = [];
      for await (const frame of readRpcStream(late)) lateFrames.push(frame);
      expect(lateFrames).toMatchObject([{ type: 'yield', value: 'first' }, { type: 'error', code: 'COSSACK_RESPONSE_HEADERS_COMMITTED', requestId: late.headers.get('X-Cossack-Request-Id') }]);
      expect(late.headers.getSetCookie().some(value => value.startsWith('late_cookie='))).toBe(false);
    }
    const cancelledKey = 'cancelled-' + transport;
    const response = await invoke('files', [{ title: 'Draft', key: cancelledKey, nested: { files: [{ _cossack_file_id: 'file_0' }] } }]);
    const reader = response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('привет🙂');
    await reader.cancel(); await release(cancelledKey); await expectClosed(cancelledKey, false);
    if (transport === 'sse') {
      const refreshed = await server.fetch('/rpc-check/sse', { headers });
      expect(readHydration(await refreshed.text()).public.count).toBeGreaterThanOrEqual(2);
    }
  }
  const browser = await chromium.launch({ headless: true });
  try {
    for (const transport of ['http', 'sse']) {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'session_id', value: sessionCookie.split(';')[0].slice('session_id='.length), url: origin, httpOnly: true }]);
      const page = await context.newPage();
      const errors = [];
      const calls = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('requestfailed', request => errors.push(request.url() + ': ' + request.failure()?.errorText));
      page.on('response', response => { if (response.request().resourceType() === 'script' || response.url().includes('/upload') || response.url().includes('/crpc')) calls.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'] }); });
      const ready = async () => {
        try { await page.waitForFunction(() => window.__cossackReady === true, undefined, { timeout: 5000 }); }
        catch (error) { throw new Error(JSON.stringify({ errors, calls, scripts: await page.locator('script[src]').evaluateAll(scripts => scripts.map(script => ({ src: script.src, type: script.type }))) }) + '\n' + error.message); }
      };
      for (const service of [false, true]) {
        await page.goto(origin + '/rpc-check/' + transport);
        await ready();
        await page.getByRole('button', { name: service ? 'Service upload' : 'Page upload', exact: true }).click();
        try { await browserExpect(page.getByRole('status')).toHaveText('first:привет🙂'); }
        catch (error) { throw new Error(`${transport}/${service ? 'service' : 'page'}: ${JSON.stringify({ errors, calls, failure: await page.getByRole('alert').textContent() })}\n${error.message}`); }
        const key = `browser-${transport}-${service ? 'service' : 'page'}`;
        expect(await audit(key)).toEqual([]); await release(key);
        await browserExpect(page.getByRole('status')).toHaveText('done:unicode.txt/7/u1/' + (service ? 'service' : '100'));
        await browserExpect(page.getByRole('alert')).toHaveText(''); await expectClosed(key, service);
      }
      await page.getByRole('button', { name: 'Native body', exact: true }).click();
      await browserExpect(page.getByRole('status')).toHaveText('201/kept/opaque🙂/7//crpc');
      await browserExpect(page.getByRole('alert')).toHaveText('');
      for (const service of [false, true]) {
        await page.goto(origin + '/rpc-check/' + transport);
        await ready();
        const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/crpc');
        await page.getByRole('button', { name: service ? 'Service redirect' : 'Page redirect', exact: true }).click();
        const completed = await pending;
        // Chromium may discard the RPC body once location.assign replaces the
        // document. Headers, destination and consumed flash prove the redirect.
        expect(completed.status()).toBe(200);
        expect((await completed.headersArray()).filter(header => header.name.toLowerCase() === 'set-cookie').map(header => header.value.split('=')[0]).sort()).toEqual(['context_cookie', 'cossack_flash', 'native_one', 'native_two'].sort());
        await browserExpect(page).toHaveURL(origin + '/rpc-check/target');
        await browserExpect(page.locator('main')).toHaveText('Saved/Draft');
        const cookies = await context.cookies();
        for (const name of ['context_cookie', 'native_one', 'native_two', 'native_body']) expect(cookies.find(cookie => cookie.name === name)).toMatchObject({ httpOnly: true });
        expect(cookies.some(cookie => cookie.name === 'cossack_flash')).toBe(false);
        await page.reload(); await browserExpect(page.locator('main')).toHaveText('/');
      }
      await context.close();
    }
  } finally { await browser.close(); }
}
