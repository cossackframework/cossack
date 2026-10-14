// Generated production apps: navigation ownership, shared Node/Cloudflare apps with
// additive fixtures, source boundaries, typed URLs and production lifecycle utilities.
// Split from one file so the four groups run in parallel; shared helpers live in
// fixtures/generated-app.js.
import { writeTestUtilitiesAcceptance, checkTestUtilitiesAcceptance } from './fixtures/test-utils-acceptance.js';
import { verifyDesktopTraceReaders } from './fixtures/desktop-trace-readers.js';
import { writeAuthPrimitivesAcceptance, checkAuthPrimitives } from './fixtures/auth-primitives-acceptance.js';
import { writeSessionDashboardAcceptance, checkSessionDashboard } from './fixtures/session-dashboard-acceptance.js';
import { writeOldInputAcceptance, checkOldInputAcceptance } from './fixtures/old-input-acceptance.js';
import { writeAuthSseAcceptance, checkAuthSseAcceptance } from './fixtures/auth-sse-acceptance.js';
import { writeAuthFormsAcceptance, checkAuthFormsAcceptance } from './fixtures/auth-forms-acceptance.js';
import { createOAuthFixtureProvider, writeOAuthReplayAcceptance, checkOAuthReplay } from './fixtures/oauth-replay-acceptance.js';
import { verifyNodeDevelopmentApplication } from './fixtures/node-development-acceptance.js';
import { verifyDevelopmentTraceApplication } from './fixtures/development-trace-acceptance.js';
import { verifyApplicationGuidance } from './fixtures/application-guidance-acceptance.js';
import { createDataTableBackend, writeDataTableAcceptance, checkDataTableBrowser } from './fixtures/data-table-acceptance.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { chromium, expect as browserExpect } from '@playwright/test';
import { writeWorkerOptimisticRecovery, checkWorkerOptimisticRecovery } from './fixtures/worker-optimistic-recovery.js';
import { writeWorkerOptimisticSse, checkWorkerOptimisticSse } from './fixtures/worker-optimistic-sse.js';
import { writeWorkerOptimisticStreams, checkWorkerOptimisticStreams } from './fixtures/worker-optimistic-streams.js';
import { writeApiContractAcceptance, checkApiContractAcceptance, checkApiContractAssets } from './fixtures/api-contract-acceptance.js';
import { createTestHarness } from 'wrangler';
import { writeRouteBoundaryAcceptance, checkRouteBoundaryAcceptance, checkRouteBoundaryBrowser } from './fixtures/route-boundary-acceptance.js';
import { checkSameUrlHistory } from './fixtures/same-url-history-acceptance.js';
import { writeUrlStateAcceptance, checkUrlStateBrowser, createUrlStateBackend } from './fixtures/url-state-acceptance.js';
import { createRuntimeProxy, checkRuntimeOwnership } from './fixtures/runtime-owner-acceptance.js';
import { writeNavigationOwnershipAcceptance, checkNavigationOwnershipBrowser } from './fixtures/navigation-ownership-acceptance.js';
import { cleanupRoots, project, sharedApps, run, cossack, typecheck, vite, assertPortableChunks, productionServer, repository, writeStateExample, checkStateExample } from './fixtures/generated-app.js';

afterEach(cleanupRoots);

describe('navigation ownership in generated production Node and workerd apps', () => {
  const shared = sharedApps();
  let nodeRoot, workerRoot;
  beforeAll(async () => {
    [nodeRoot, workerRoot] = await Promise.all([shared('node'), shared('cloudflare')]);
    await writeNavigationOwnershipAcceptance(nodeRoot); await writeNavigationOwnershipAcceptance(workerRoot);
    await vite(nodeRoot, []); await vite(nodeRoot, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    await vite(workerRoot, []);
  }, 240000);
  it('replaces navigation owners when a browser moves between production Node and workerd', async () => {
    const node=await productionServer(nodeRoot);
    try {
      const harness=createTestHarness({root:workerRoot,workers:[{configPath:path.join(workerRoot,'dist/ssr/wrangler.json')}]});
      try {
        const {url}=await harness.listen();
        const proxy=await createRuntimeProxy(node.origin);
        try {
          const browser=await chromium.launch({headless:true});
          try { await checkRuntimeOwnership(browser,proxy,node.origin,new URL(url).origin); }
          finally { await browser.close(); }
        } finally { await proxy.close(); }
      } finally { await harness.close(); }
    } finally { await node.close(); }
  },120000);
  it.each(['node', 'cloudflare'])('isolates navigation ownership in a generated production %s app', async adapter => {
    const root = adapter === 'node' ? nodeRoot : workerRoot;
    const browser = await chromium.launch({ headless: true });
    try {
      if (adapter === 'node') {
        const runtime = await productionServer(root);
        try { await checkNavigationOwnershipBrowser(browser, runtime.origin); }
        finally { await runtime.close(); }
      } else {
        const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
        try { const { url } = await harness.listen(); await checkNavigationOwnershipBrowser(browser, new URL(url).origin); }
        finally { await harness.close(); }
      }
    } finally { await browser.close(); }
  }, 120000);
});

// Additive fixtures for the shared generated production Node app below.
async function writeRpcViews(root) {
  const write = async (relative, source) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), source);
  };
  await write('src/services/rpc-report.ts', `
    import { Server, Service, CossackService, input } from '@cossackframework/core';
    @Service() export class ReportService extends CossackService {
      @Server({ input: input.object({title:input.string({required:true}),nested:input.object({files:input.array(input.file({maxBytes:1024}),{minItems:1,maxItems:4})})}) }) async *files(input: { title: string; nested: { files: File[] } }) {
        yield await input.nested.files[0].text(); await new Promise(resolve => setTimeout(resolve, 500)); return input.nested.files[0].name;
      }
      @Server() native() { return new Response(new Uint8Array([0, 255, 128]), { headers: { 'Content-Type': 'application/octet-stream', 'X-Native': 'service' } }); }
      @Server({input:input.string({required:true})}) report = async function* (label: string) {
        const serverMarker = 'private-service-generator-marker';
        yield { label };
        return { length: label.length, marker: serverMarker };
      };
    }
  `);
  await write('src/pages/rpc/layout.ts', `
    import { Cossack, Page } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { ReportService } from '../../services/rpc-report';
    @Page({ transport: 'http', services: [ReportService] })
    export default class RpcLayout extends Cossack { render() { return html\`\${this.children}\`; } }
  `);
  for (const transport of ['http', 'sse']) await write(`src/pages/rpc/${transport}/index.ts`, `
    import { Cossack, Page, Server, Client, ClientState, Inject, rpc$, input } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { ReportService } from '../../../services/rpc-report';
    @Page({ transport: '${transport}' })
    export default class RpcPage extends Cossack {
      @Inject(ReportService) private report!: ReportService;
      @ClientState() output = '';
      @ClientState() failure = '';
      @ClientState() pending = false;
      @ClientState() uploadFilesProgress = 0;
      @Server({ input: input.object({title:input.string({required:true}),nested:input.object({files:input.array(input.file({maxBytes:1024}),{minItems:1,maxItems:4})})}) }) async *uploadFiles(input: { title: string; nested: { files: File[] } }) {
        yield await input.nested.files[0].text(); await new Promise(resolve => setTimeout(resolve, 500)); return input.nested.files[0].name;
      }
      @Client() async readFiles(service: boolean) {
        this.failure = ''; this.output = '';
        const input = { title: 'valid', nested: { files: [new File(['привет🙂'], 'nested.txt')] } };
        try {
          const call = service ? rpc$(this.report.files(input)) : rpc$(this.uploadFiles(input));
          for await (const value of call) this.output = 'first:' + value;
          this.output = 'done:' + await call + '/' + (service ? 'service' : this.uploadFilesProgress);
        } catch (error) { this.failure = error instanceof Error ? error.message : 'Upload failed'; }
      }
      @Client() readPageFiles() { return this.readFiles(false); }
      @Client() readServiceFiles() { return this.readFiles(true); }
      @Server() async *steps(limit: number) {
        for (let step = 1; step <= limit; step++) yield { step };
        return { total: limit };
      }
      @Server({input:input.number({integer:true,min:1})}) field = async function* (amount: number) {
        const marker = 'private-page-generator-marker';
        yield { amount };
        return { amount, marker };
      };
      @Server() async native() { return new Response('native page', { status: 202, headers: { 'X-Native': 'page' } }); }
      @Server() async ordinary(amount: number) { return { amount }; }
      @Server() async *serialized() {
        yield { when: new Date('2026-10-03'), list: [undefined] };
        return { toJSON() { return { when: new Date('2026-10-03'), count: 3 }; } };
      }
      @Client() async run() {
        this.pending = true; this.failure = ''; this.output = '';
        try {
          const values: string[] = [];
          const steps = rpc$(this.steps(2));
          for await (const value of steps) values.push('step:' + value.step);
          const first = await steps;
          const repeated = await steps;
          if (first.total !== repeated.total) throw new Error('Changed terminal result');
          const field = rpc$(this.field(3));
          for await (const value of field) values.push('field:' + value.amount);
          const second = await field;
          const report = rpc$(this.report.report('report'));
          for await (const value of report) values.push('service:' + value.label);
          const third = await report;
          const ordinary = rpc$(this.ordinary(7));
          for await (const value of ordinary) values.push('unexpected ordinary yield:' + value);
          const fourth = await ordinary;
          const serialized = rpc$(this.serialized());
          for await (const value of serialized) values.push('wire:' + value.when.split('T')[0] + '/' + String(value.list[0]));
          const fifth = await serialized;
          const nativePage = await rpc$(this.native());
          if (!nativePage) throw new Error('Missing page response');
          values.push('native:' + nativePage.status + '/' + nativePage.headers.get('X-Native') + '/' + await nativePage.text());
          const nativeService = await rpc$(this.report.native());
          if (!nativeService) throw new Error('Missing service response');
          values.push('binary:' + [...new Uint8Array(await nativeService.arrayBuffer())].join('/'));
          this.output = values.join(',') + '|done:' + [first.total, second.amount, third.length, fourth.amount, fifth.count].join('/');
        } catch (error) { this.failure = error instanceof Error ? error.message : 'RPC failed'; }
        finally { this.pending = false; }
      }
      render() { return html\`<main><h1>Typed ${transport} RPC</h1>
        <button @click=\${this.run} ?disabled=\${this.pending}>Run</button>
        <button @click=\${this.readPageFiles}>Page files</button><button @click=\${this.readServiceFiles}>Service files</button>
        <p role="status">\${this.output}</p><p role="alert">\${this.failure}</p></main>\`; }
    }
  `);
  await write('src/pages/native-upload/index.ts', `
    import { Cossack, Page, Server, Client, ClientState, rpc$ } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    @Page({ transport: 'http' }) export default class NativeUpload extends Cossack {
      @ClientState() output = ''; @ClientState() failure = ''; @ClientState() uploadProgress = 0;
      @Server() async upload(file: File) {
        return new Response(await file.arrayBuffer(), { status: 201, headers: { 'Content-Type': 'application/octet-stream', 'X-Native': file.name } });
      }
      @Client() async run() {
        try {
          const response = await rpc$(this.upload(new File([new Uint8Array([0, 255, 128])], 'binary.dat')));
          if (!response) throw new Error('Missing upload response');
          this.output = response.status + '/' + response.headers.get('Content-Type') + '/' + response.headers.get('X-Native') + '/' + [...new Uint8Array(await response.arrayBuffer())].join('/');
        } catch (error) { this.failure = error instanceof Error ? error.message : 'Upload failed'; }
      }
      render() { return html\`<main><button @click=\${this.run}>Upload</button><p role="status">\${this.output}</p><p role="alert">\${this.failure}</p></main>\`; }
    }
  `);
}
async function writeCookieRpc(root) {
  const write = async (relative, source) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), source);
  };
  await write('src/services/cookie-result.ts', `
    import { cookie, flash, flashInput, Server, Service, CossackService, input } from '@cossackframework/core';
    export function cookieResult() {
      cookie().set('context_cookie', 'from_action', { httpOnly: true, path: '/' });
      flash('success', 'Saved'); flashInput({ title: 'Draft' }, { fields: ['title'] });
      const headers = new Headers({ Location: '/cookie-rpc/target' });
      headers.append('Set-Cookie', 'native_one=1; HttpOnly; Path=/');
      headers.append('Set-Cookie', 'native_two=2; HttpOnly; Path=/');
      return new Response(null, { status: 303, headers });
    }
    @Service() export class CookieService extends CossackService {
      @Server() complete() { return cookieResult(); }
    }
  `);
  await write('src/pages/cookie-rpc/layout.ts', `
    import { Cossack, Page } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { CookieService } from '../../services/cookie-result';
    @Page({ transport: 'http', services: [CookieService] })
    export default class CookieLayout extends Cossack { render() { return html\`\${this.children}\`; } }
  `);
  await write('src/pages/cookie-rpc/index.ts', `
    import { Cossack, Page, Server, Client, ClientState, Inject, cookie, rpc$ } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { cookieResult, CookieService } from '../../services/cookie-result';
    @Page({ transport: 'http' }) export default class CookiePage extends Cossack {
      @Inject(CookieService) private service!: CookieService;
      @ClientState() failure = '';
      @ClientState() progress = '';
      @Server() complete() { return cookieResult(); }
      @Server() async *late() { yield 'first'; cookie().set('late_cookie', 'lost'); return 'unreachable'; }
      @Server() async early() {
        cookie().set('early_cookie', 'kept', { httpOnly: true, path: '/' });
        return (async function* () { yield 'first'; return 'finished'; })();
      }
      @Client() async savePage() { await rpc$(this.complete()); }
      @Client() async saveService() { await rpc$(this.service.complete()); }
      @Client() async readLate() {
        this.failure = ''; this.progress = '';
        try { for await (const value of rpc$(this.late())) this.progress = value; }
        catch (error) { this.failure = (error as { code?: string }).code ?? 'failed'; }
      }
      @Client() async readEarly() {
        this.failure = ''; this.progress = '';
        const call = rpc$(this.early());
        for await (const value of call) this.progress = value;
        this.progress = await call;
      }
      render() { return html\`<main><h1>Cookie RPC</h1>
        <button @click=\${this.savePage}>Save page</button><button @click=\${this.saveService}>Save service</button>
        <button @click=\${this.readLate}>Late cookie</button><button @click=\${this.readEarly}>Early cookie</button>
        <p role="status">\${this.progress}</p><p role="alert">\${this.failure}</p></main>\`; }
    }
  `);
  await write('src/pages/cookie-rpc/target/index.ts', `
    import { Cossack, Page, State, flashed, old } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    @Page({ transport: 'http' }) export default class Target extends Cossack {
      @State() notice = ''; @State() title = '';
      async init() { this.notice = flashed<string>('success') ?? ''; this.title = old<string>('title') ?? ''; }
      render() { return html\`<main><h1>Saved target</h1><p role="status">\${this.notice}:\${this.title}</p></main>\`; }
    }
  `);
}
async function writeOptimisticRollback(root) {
  for (const transport of ['http', 'sse']) {
    const directory = path.join(root, 'src/pages/optimistic', transport);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'index.ts'), `
      import { Cossack, Page, State, Store, ClientState, ClientStore, Server, Client, Optimistic, optimistic, input } from '@cossackframework/core';
      import { html } from '@cossackframework/renderer';
      @Page({ transport: '${transport}' }) export default class OptimisticPage extends Cossack {
        @State() count = 0;
        @Store() cart = { rows: [1] };
        @ClientState() local = 0;
        @ClientState() accepted = 0;
        @ClientStore() items: string[] = [];
        @Optimistic('append') previewAppend(value: { value: number; label: string }) {
          const edits = optimistic<OptimisticPage>(this); edits.increment('accepted', 1); edits.append('items', value.label);
        }
        @Server({ input: input.object({ value: input.number({ min: 0 }), label: input.string(), delay: input.number({ min: 0 }) }) })
        async append(value: { value: number; label: string; delay: number }) { await new Promise(resolve => setTimeout(resolve, value.delay)); return value.label; }
        @Optimistic('edit') preview(value: { value: number }) { this.count = value.value; this.cart.rows.push(value.value); this.local = value.value; }
        @Server({ input: input.object({ value: input.number({ min: 0 }), delay: input.number({ min: 0 }) }) })
        async edit(value: { value: number; delay: number }) {
          await new Promise(resolve => setTimeout(resolve, value.delay));
          this.count = value.value * 10; this.cart.rows.push(this.count); return this.count;
        }
        @Client() onMount() { (window as any).__optimistic = this; }
        @Client() editLocal(value: number) { this.count = value; }
        render() { return html\`<main><span data-testid="count">\${this.count}</span><span data-testid="rows">\${this.cart.rows.join(',')}</span><span data-testid="local">\${this.local}</span><span data-testid="loading">\${this.loading.edit || 0}</span><span data-testid="accepted">\${this.accepted}</span><span data-testid="items">\${this.items.join(',')}</span><span data-testid="append-loading">\${this.loading.append || 0}</span></main>\`; }
      }
    `);
  }
}
async function writeNodeOptimisticRecovery(root) {
  await writeWorkerOptimisticRecovery(root);
  // Process-owned records survive the fresh component instances for HTTP RPC.
  // Native Worker acceptance uses the same UI against actual D1 records.
  await fs.writeFile(path.join(root, 'src/private-optimistic-recovery.ts'), `
    const records = new Map<string, {count:number;mutations:number;reads:number}>();
    function record(scope:string) {
      let value = records.get(scope);
      if (!value) { value = {count:0,mutations:0,reads:0}; records.set(scope,value); }
      return value;
    }
    export async function readCounter(scope:string) { const value=record(scope); value.reads++; return {count:value.count}; }
    export async function incrementCounter(scope:string) { const value=record(scope); value.count++; value.mutations++; return {count:value.count}; }
    export async function auditCounter(scope:string) { return {...record(scope)}; }
  `);
}
async function writeNodeOptimisticSse(root) {
  await writeWorkerOptimisticSse(root);
  await fs.writeFile(path.join(root,'src/private-sse-optimistic.ts'), `
    let count=0; const operations:Array<{id:string}>=[];
    export async function read(_db?:unknown) { return {count}; }
    export async function commit(_db:unknown,id:string) { operations.push({id}); count++; return {count}; }
    export async function replace(_db:unknown,value:number) { count=value; return count; }
    export async function waitForRelease(_db:unknown,_id:string) { throw new Error('Node test only uses the failure stream'); }
    export async function audit(_db?:unknown) { return {count,operations:operations.map(row=>({...row}))}; }
  `);
  const pageFile=path.join(root,'src/pages/resource-check/optimistic-sse/index.ts');
  await fs.writeFile(pageFile,(await fs.readFile(pageFile,'utf8')).replaceAll('this.env.DB','undefined').replace('Cossack<Env>','Cossack'));
  await fs.writeFile(path.join(root,'src/pages/api/rpc-check/optimistic-sse.ts'), `
    import type {Context} from 'hono';
    import {audit} from '../../../private-sse-optimistic';
    export const GET=async(c:Context)=>c.json(await audit());
  `);
}
async function writeNodeOptimisticStreams(root) {
  await writeWorkerOptimisticStreams(root);
  await fs.writeFile(path.join(root,'src/private-optimistic-streams.ts'), `
    const records=new Map<string,{count:number;mutations:number;released:number}>();
    function record(scope:string) {
      let value=records.get(scope);if(!value){value={count:0,mutations:0,released:0};records.set(scope,value);}return value;
    }
    export async function audit(scope:string){return {...record(scope)};}
    export async function commit(scope:string){const value=record(scope);value.count++;value.mutations++;return {count:value.count};}
    export async function commitBound(_db:unknown,scope:string){return commit(scope);}
    export async function waitForReleaseBound(_db:unknown,scope:string){return waitForRelease(scope);}
    export async function release(scope:string){record(scope).released=1;}
    export async function waitForRelease(scope:string){
      const deadline=Date.now()+15000;
      while(!record(scope).released){if(Date.now()>deadline)throw new Error('Test did not release stream');await new Promise(resolve=>setTimeout(resolve,10));}
    }
  `);
  for(const transport of ['http','sse','durable-object']) {
    const pageFile=path.join(root,'src/pages/resource-check/optimistic-streams',transport,'index.ts');
    await fs.writeFile(pageFile,(await fs.readFile(pageFile,'utf8')).replaceAll('this.env.DB','undefined').replace('Cossack<Env>','Cossack'));
  }
  await fs.writeFile(path.join(root,'src/private/optimistic-stream.server.ts'), `
    import {audit,commit} from '../private-optimistic-streams';
    export async function readCounter(){return {count:(await audit('docs-example')).count};}
    export async function incrementCounter(){return commit('docs-example');}
  `);
}
async function writeNodeLivePage(root) {
  await fs.mkdir(path.join(root, 'src/pages/live'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/live/index.ts'), `import { Cossack, Page, State } from '@cossackframework/core'; @Page({ transport: 'durable-object', stateful: false }) export default class Live extends Cossack { @State() count = 7; }`);
}
async function checkApiContractRoutes(root) {
  const cli = await cossack(root, ['routes', '--json']);
  const inspected = JSON.parse(cli.stdout).data;
  expect(inspected.routes.find(route => route.name === '/api/declared/[id]').apiContracts.methods).toEqual([
    expect.objectContaining({ method: 'POST', declaration: 'defineApi', inputLocations: ['params', 'query', 'body'], output: 'json', authorization: 'declared' }),
    expect.objectContaining({ method: 'GET', output: 'response', authorization: 'none' }),
  ]);
  expect(inspected.routes.find(route => route.name === '/api/native').routeStyle).toBe('http-handlers');
  await checkApiContractAssets(root);
}
async function oldInputRouteId(root) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const routeId = manifest.filePathToId['/src/pages/old-input-rpc/index.ts'];
  expect(routeId).toBeTruthy();
  for (const file of (await fs.readdir(path.join(root, 'dist/client/assets'))).filter(file => file.endsWith('.js'))) {
    expect(await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8')).not.toContain('PRIVATE_OLD_INPUT_FAILED_ACTION');
  }
  return routeId;
}
const oldInputEnvironment = { APP_SECRET: 'old-input-native-application-secret' };

// One generated Node app carries every additive (non-conflicting) fixture: one
// scaffold, one Vite build, one typecheck, then a fresh production server per case.
describe('shared generated production Node app', () => {
  const shared = sharedApps();
  let root, urlBackend;
  beforeAll(async () => {
    urlBackend = await createUrlStateBackend();
    root = await shared('node');
    await writeApiContractAcceptance(root);
    await writeOldInputAcceptance(root, repository);
    await writeRpcViews(root);
    await writeCookieRpc(root);
    await writeOptimisticRollback(root);
    await writeStateExample(root);
    await writeNodeOptimisticRecovery(root);
    await writeNodeOptimisticSse(root);
    await writeNodeOptimisticStreams(root);
    // Same as the generated `typecheck` script: route types first, then tsc.
    await cossack(root, ['routes', '--generate', '--json']);
    await typecheck(root, 'Generated shared Node app types');
    // These fixtures were never part of a typecheck; they join after it.
    await writeUrlStateAcceptance(root, urlBackend.origin);
    await writeNodeLivePage(root);
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  }, 300000);
  afterAll(async () => { await urlBackend?.close(); });
  it('parses and navigates typed URL state in a generated production node app', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const runtime = await productionServer(root);
      try { await checkUrlStateBrowser(browser, runtime.origin, urlBackend); await checkSameUrlHistory(browser, runtime.origin, urlBackend); }
      finally { await runtime.close(); }
    } finally { await browser.close(); }
  }, 120000);
  it('executes declared API contracts in a generated production node app', async () => {
    await checkApiContractRoutes(root);
    const runtime = await productionServer(root);
    try { await checkApiContractAcceptance((url, options) => fetch(runtime.origin + url, options)); }
    finally { await runtime.close(); }
  }, 120000);
  it('excludes private old input through native form and RPC redirects on node', async () => {
    const routeId = await oldInputRouteId(root);
    const server = await productionServer(root, oldInputEnvironment);
    const request = (url, options = {}) => fetch(server.origin + url, { redirect: 'manual', ...options });
    try { await checkOldInputAcceptance(request, routeId); }
    catch (error) { throw new Error(`${error.stack ?? error}\n${server.diagnostics()}`); }
    finally { await server.close(); }
  }, 120000);
  it('builds a generated node app through its real Vite configuration', async () => {
    await assertPortableChunks(path.join(root, 'dist/server'));
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
      `const { app, env } = await import('./dist/server/index.js'); const response = await app.request('/', {}, env); if (response.status !== 200) throw new Error('HTTP ' + response.status); const body = await response.text(); if (!body.includes('<html')) throw new Error('Missing rendered document'); console.log('NODE_SSR_OK');`],
      { cwd: root, env: { ...process.env, APP_URL: 'http://localhost:3000' }, maxBuffer: 1024 * 1024 });
    expect(result.stdout).toContain('NODE_SSR_OK');
    const websocket = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import { createServer } from 'node:http';
      import { WebSocket } from 'ws';
      const { app, env, runtime } = await import('./dist/server/index.js');
      const server = createServer();
      runtime.attach(server, request => app.fetch(request, env));
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = 'http://127.0.0.1:' + server.address().port;
      env.APP_URL = origin;
      const rendered = await app.request('/live', {}, env);
      const html = rendered.status === 200 ? await rendered.text() : '';
      const initial = html.match(/window\\.__INITIAL_STATE__ = (.*?)<\\/script>/s);
      if (!initial) throw new Error('WebSocket page SSR failed');
      // Connect to the target SSR emitted, encoded as one path segment, as the browser does.
      const target = JSON.parse(initial[1]).providerTargets.page;
      if (typeof target !== 'string' || !target.startsWith('page:')) throw new Error('Unexpected WebSocket target ' + target);
      const query = new URLSearchParams({ routePath: '/live', pathname: '/live', params: '{}' });
      const url = origin.replace('http:', 'ws:') + '/ws/page/' + encodeURIComponent(target) + '?' + query;
      const rejectUpgrade = (target, requestOrigin) => new Promise((resolve, reject) => {
        const socket = new WebSocket(target, { headers: { origin: requestOrigin } });
        socket.on('error', () => {});
        socket.once('open', () => { socket.terminate(); reject(new Error('Forbidden upgrade accepted')); });
        socket.once('unexpected-response', (_request, response) => {
          response.resume(); socket.terminate();
          if (response.statusCode !== 403) reject(new Error('Expected 403, got ' + response.statusCode));
          else resolve();
        });
      });
      try {
        await rejectUpgrade(url, 'https://untrusted.example');
        await new Promise((resolve, reject) => {
          const denied = new WebSocket(url.replace(encodeURIComponent(target), encodeURIComponent('user:other')), { headers: { origin } });
          const frames = [];
          denied.on('message', data => frames.push(JSON.parse(String(data))));
          denied.once('error', reject);
          denied.once('close', code => {
            if (code !== 1008 || frames.length !== 1 || frames[0].type !== 'authorization-error'
              || frames[0].code !== 'COSSACK_REALTIME_AUTH_CHANGED') {
              reject(new Error('Incorrect scope rejection: ' + JSON.stringify({ code, frames })));
            } else resolve();
          });
        });
        const socket = new WebSocket(url, { headers: { origin } });
        const state = await new Promise((resolve, reject) => {
          socket.once('message', data => resolve(JSON.parse(String(data))));
          socket.once('close', (code, reason) => reject(new Error('Closed before snapshot: ' + code + ' ' + reason)));
          socket.once('error', reject);
        });
        if (state.type !== 'state-update' || state.state.count !== 7) throw new Error('Incorrect WebSocket snapshot: ' + JSON.stringify(state));
        console.log('NODE_WS_GUARDS_OK');
      } finally {
        await runtime.dispose();
        await new Promise(resolve => server.close(resolve));
      }
    `], { cwd: root, timeout: 20000, maxBuffer: 1024 * 1024 });
    expect(websocket.stdout).toContain('NODE_WS_GUARDS_OK');
    expect(await fs.readdir(path.join(root, 'dist/client/assets'))).not.toHaveLength(0);
  }, 120000);
  it('runs inferred client RPC views for HTTP/SSE methods, function fields, and scoped services', async () => {
    await assertPortableChunks(path.join(root, 'dist/server'));
    for (const file of (await fs.readdir(path.join(root, 'dist/client/assets'))).filter(file => file.endsWith('.js'))) {
      const code = await fs.readFile(path.join(root, 'dist/client/assets', file), 'utf8');
      expect(code).not.toContain('private-service-generator-marker');
      expect(code).not.toContain('private-page-generator-marker');
    }
    const server = await productionServer(root);
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      for (const transport of ['http', 'sse']) {
        const page = await browser.newPage();
        const errors = [];
        const actions = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (new URL(request.url()).pathname === '/crpc') actions.push(request.postDataJSON()); });
        await page.goto(server.origin + '/rpc/' + transport);
        await browserExpect(page.getByRole('heading', { name: 'Typed ' + transport + ' RPC' })).toBeVisible();
        await page.getByRole('button', { name: 'Run', exact: true }).click();
        await browserExpect(page.getByRole('status')).toHaveText('step:1,step:2,field:3,service:report,wire:2026-10-03/null,native:202/page/native page,binary:0/255/128|done:2/3/6/7/3');
        await browserExpect(page.getByRole('alert')).toHaveText('');
        expect(actions.map(action => action.action)).toEqual(['steps', 'field', 'report', 'ordinary', 'serialized', 'native', 'native']);
        expect(actions[2]).toMatchObject({ service: { slot: '0' }, payload: ['report'] });
        for (const label of ['Page files', 'Service files']) {
          await page.getByRole('button', { name: label, exact: true }).click();
          await browserExpect(page.getByRole('status')).toHaveText('first:привет🙂');
          await browserExpect(page.getByRole('status')).toHaveText('done:nested.txt/' + (label === 'Page files' ? '100' : 'service'));
          await browserExpect(page.getByRole('alert')).toHaveText('');
        }
        expect(errors).toEqual([]);
        await page.close();
      }
      const uploadPage = await browser.newPage();
      await uploadPage.goto(server.origin + '/native-upload');
      await uploadPage.getByRole('button', { name: 'Upload', exact: true }).click();
      await browserExpect(uploadPage.getByRole('status')).toHaveText('201/application/octet-stream/binary.dat/0/255/128');
      await browserExpect(uploadPage.getByRole('alert')).toHaveText('');
      await uploadPage.close();
    } finally { await browser?.close(); await server.close(); }
  }, 120000);
  it('preserves native RPC cookies and consumes flash after a real browser redirect', async () => {
    const server = await productionServer(root, { APP_SECRET: 'generated-cookie-rpc-test-secret' });
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const label of ['Save page', 'Save service']) {
        await page.goto(server.origin + '/cookie-rpc');
        const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/crpc');
        await page.getByRole('button', { name: label, exact: true }).click();
        const response = await responsePromise;
        expect(response.status(), response.status() === 200 ? undefined : await response.text()).toBe(200);
        const setCookies = (await response.headersArray()).filter(header => header.name.toLowerCase() === 'set-cookie');
        expect(setCookies.map(header => header.value.split('=')[0]).sort()).toEqual(['context_cookie', 'cossack_flash', 'native_one', 'native_two'].sort());
        await browserExpect(page).toHaveURL(server.origin + '/cookie-rpc/target');
        await browserExpect(page.getByRole('status')).toHaveText('Saved:Draft');
        const cookies = await context.cookies();
        for (const name of ['context_cookie', 'native_one', 'native_two']) expect(cookies.find(cookie => cookie.name === name)).toMatchObject({ httpOnly: true });
        expect(cookies.some(cookie => cookie.name === 'cossack_flash')).toBe(false);
        await page.reload();
        await browserExpect(page.getByRole('status')).toHaveText(':');
      }
      await page.goto(server.origin + '/cookie-rpc');
      await page.getByRole('button', { name: 'Late cookie', exact: true }).click();
      await browserExpect(page.getByRole('alert')).toHaveText('COSSACK_RESPONSE_HEADERS_COMMITTED');
      await browserExpect(page.getByRole('status')).toHaveText('first');
      expect((await context.cookies()).some(cookie => cookie.name === 'late_cookie')).toBe(false);
      await page.getByRole('button', { name: 'Early cookie', exact: true }).click();
      await browserExpect(page.getByRole('status')).toHaveText('finished');
      await browserExpect(page.getByRole('alert')).toHaveText('');
      expect((await context.cookies()).find(cookie => cookie.name === 'early_cookie')).toMatchObject({ value: 'kept', httpOnly: true });
      expect(errors).toEqual([]);
    } finally { await browser?.close(); await server.close(); }
  }, 120000);
  it('owns optimistic rollback across overlapping HTTP/SSE browser calls', async () => {
    const server = await productionServer(root);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      for (const transport of ['http', 'sse']) {
        await page.goto(`${server.origin}/optimistic/${transport}`);
        await page.waitForFunction(() => !!window.__optimistic);
        if (transport === 'sse') await page.waitForFunction(() => window.__optimistic.realtime.sse.state === 'open');
        const dispatched = [];
        let release;
        const held = new Promise(resolve => { release = resolve; });
        await page.route('**/crpc**', async route => {
          const body = route.request().postDataJSON(); dispatched.push(body);
          if (body.action === 'edit' && body.payload[0].value < 0) await held;
          await route.continue();
        });
        await page.evaluate(() => {
          window.__old = window.__optimistic.edit({ value: -1, delay: 0 }).catch(error => { window.__oldError = error.code; });
          window.__next = window.__optimistic.edit({ value: 2, delay: 30 });
        });
        await browserExpect(page.getByTestId('count')).toHaveText('20');
        await browserExpect(page.getByTestId('loading')).toHaveText('1');
        expect(dispatched.map(body => body.state.count)).toEqual([0, 0]);
        for (const body of dispatched) expect(body.state).not.toHaveProperty('local');
        release();
        await page.evaluate(async () => { await window.__old; await window.__next; });
        expect(await page.evaluate(() => window.__oldError)).toBe('COSSACK_VALIDATION_FAILED');
        await browserExpect(page.getByTestId('count')).toHaveText('20');
        await browserExpect(page.getByTestId('rows')).toHaveText('1,20');
        await browserExpect(page.getByTestId('local')).toHaveText('2');
        await browserExpect(page.getByTestId('loading')).toHaveText('0');
        await page.unroute('**/crpc**');
        await page.evaluate(() => {
          window.__pending = window.__optimistic.edit({ value: 3, delay: 75 });
          window.__optimistic.editLocal(99);
        });
        await page.evaluate(async () => { await window.__pending; });
        await browserExpect(page.getByTestId('count')).toHaveText('99');
        await browserExpect(page.getByTestId('loading')).toHaveText('0');
        for (const [iteration, order] of [['1', 'old-first'], ['2', 'new-first']]) {
          let releaseOld, releaseNext;
          const oldHeld = new Promise(resolve => { releaseOld = resolve; });
          const nextHeld = new Promise(resolve => { releaseNext = resolve; });
          const sent = [];
          await page.route('**/crpc**', async route => {
            const body = route.request().postDataJSON(); sent.push(body);
            if (body.action === 'append') await (body.payload[0].value < 0 ? oldHeld : nextHeld);
            await route.continue();
          });
          await page.evaluate(() => {
            window.__oldAppend = window.__optimistic.append({ value: -1, label: 'old', delay: 0 }).catch(error => { window.__appendError = error.code; });
            window.__nextAppend = window.__optimistic.append({ value: 1, label: 'next', delay: 0 });
          });
          await expect.poll(() => sent.length).toBe(2);
          await browserExpect(page.getByTestId('accepted')).toHaveText(String(Number(iteration) + 1));
          await browserExpect(page.getByTestId('append-loading')).toHaveText('2');
          for (const body of sent) { expect(body.state).not.toHaveProperty('accepted'); expect(body.state).not.toHaveProperty('items'); }
          if (order === 'old-first') {
            releaseOld(); await page.evaluate(async () => { await window.__oldAppend; });
            await browserExpect(page.getByTestId('accepted')).toHaveText(iteration);
            await browserExpect(page.getByTestId('items')).toHaveText('next');
            await browserExpect(page.getByTestId('append-loading')).toHaveText('1');
            releaseNext(); await page.evaluate(async () => { await window.__nextAppend; });
          } else {
            releaseNext(); await page.evaluate(async () => { await window.__nextAppend; });
            await browserExpect(page.getByTestId('accepted')).toHaveText('3');
            await browserExpect(page.getByTestId('append-loading')).toHaveText('1');
            releaseOld(); await page.evaluate(async () => { await window.__oldAppend; });
          }
          expect(await page.evaluate(() => window.__appendError)).toBe('COSSACK_VALIDATION_FAILED');
          await browserExpect(page.getByTestId('accepted')).toHaveText(iteration);
          await browserExpect(page.getByTestId('items')).toHaveText(Array(Number(iteration)).fill('next').join(','));
          await browserExpect(page.getByTestId('append-loading')).toHaveText('0');
          await page.unroute('**/crpc**');
        }
      }
      expect(errors).toEqual([]);
    } finally { await browser.close(); await server.close(); }
  }, 120000);
  it('runs state documentation examples and diagnostics in a published production app', async () => {
    await checkStateExample('production', await productionServer(root));
  }, 120000);
  it('reconciles component and service mutations after their committed replies are lost', async () => {
    const server = await productionServer(root);
    try {
      await checkWorkerOptimisticRecovery({fetch:(path, init)=>fetch(server.origin+path,init)}, new URL(server.origin), 'session_id=test');
    } finally { await server.close(); }
  }, 120000);
  it('orders SSE action broadcasts and delayed replies against newer server snapshots', async () => {
    await assertPortableChunks(path.join(root,'dist/server'));
    await assertPortableChunks(path.join(root,'dist/server'));
    const server=await productionServer(root);
    try { await checkWorkerOptimisticSse({fetch:(route,init)=>fetch(server.origin+route,init)},new URL(server.origin),'session_id=test',{native:false}); }
    finally { await server.close(); }
  }, 120000);
  it('retains confirmed optimistic component and service yields through failures and cancellation', async () => {
    await assertPortableChunks(path.join(root,'dist/server'));
    await assertPortableChunks(path.join(root,'dist/server'));
    const server=await productionServer(root);
    try {await checkWorkerOptimisticStreams({fetch:(route,init)=>fetch(server.origin+route,init)},new URL(server.origin),'session_id=test');}
    finally {await server.close();}
  }, 120000);
});

describe('shared generated production Cloudflare app', () => {
  const shared = sharedApps();
  let root, urlBackend;
  beforeAll(async () => {
    urlBackend = await createUrlStateBackend();
    root = await shared('cloudflare');
    await writeApiContractAcceptance(root);
    const configPath = path.join(root, 'wrangler.jsonc');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.d1_databases = [{ binding: 'DB', database_name: 'native-api-test' }];
    await fs.writeFile(configPath, JSON.stringify(config));
    await writeOldInputAcceptance(root, repository);
    await run(process.execPath, [path.join(repository, 'node_modules/wrangler/bin/wrangler.js'), 'types'], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, timeout: 30000 });
    // Same as the generated `typecheck` script: route types first, then tsc.
    await cossack(root, ['routes', '--generate', '--json']);
    await typecheck(root, 'Generated shared Cloudflare app types');
    // The URL state fixture was never part of a typecheck; it joins after it.
    await writeUrlStateAcceptance(root, urlBackend.origin);
    await vite(root, []);
  }, 300000);
  afterAll(async () => { await urlBackend?.close(); });
  it('parses and navigates typed URL state in a generated production cloudflare app', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
      try { const { url } = await harness.listen(); await checkUrlStateBrowser(browser, new URL(url).origin, urlBackend); await checkSameUrlHistory(browser, new URL(url).origin, urlBackend); }
      finally { await harness.close(); }
    } finally { await browser.close(); }
  }, 120000);
  it('executes declared API contracts in a generated production cloudflare app', async () => {
    await checkApiContractRoutes(root);
    const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
    // Exercise the same HTTP listener browsers use, including rejected bodies
    // followed by fresh requests, rather than Miniflare's synthetic dispatch.
    try { const { url: origin } = await harness.listen(); await checkApiContractAcceptance((url, options) => fetch(new URL(url, origin), options)); }
    finally { await harness.close(); }
  }, 120000);
  it('excludes private old input through native form and RPC redirects on cloudflare', async () => {
    const routeId = await oldInputRouteId(root);
    const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json'), secrets: oldInputEnvironment }] });
    const close = () => harness.close();
    try { await harness.listen(); } catch (error) { await close(); throw error; }
    const request = (url, options = {}) => harness.fetch(url, { redirect: 'manual', ...options });
    try { await checkOldInputAcceptance(request, routeId); }
    catch (error) { throw new Error(`${error.stack ?? error}\n${JSON.stringify(harness.getLogs())}`); }
    finally { await close(); }
  }, 120000);
});

it.each(['node', 'cloudflare'])('selects and hydrates source boundaries in a generated production %s app', async adapter => {
  const root = await project(adapter); await writeRouteBoundaryAcceptance(root);
  await vite(root, []);
  if (adapter === 'node') await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const cli = await promisify(execFile)(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'routes', '--json'], { cwd: root, timeout: 30000 });
  const inspected = JSON.parse(cli.stdout).data;
  expect(inspected.manifest).toEqual(manifest);
  const checkInspection = states => {
    for (const state of states) {
      expect(manifest.filePathToId[state.componentPath]).toBe(state.componentRouteId);
      const page = inspected.routes.find(route => route.filePath === state.componentPath);
      expect(page.routeId).toBe(state.componentRouteId);
      expect(page.layoutAndPageMiddlewareCount).toBe(state.public.order.split(',').length - 1);
      expect(page.middlewareStack.map(entry => entry.source.split(':')[0])).toEqual([
        ...page.layouts, state.componentPath,
      ]);
    }
  };
  const browser = await chromium.launch({ headless: true });
  if (adapter === 'node') {
    const runtime = await productionServer(root);
    try {
      const states = await checkRouteBoundaryAcceptance((url, options) => fetch(runtime.origin + url, options));
      checkInspection(states);
      await checkRouteBoundaryBrowser(browser, runtime.origin);
    } finally { await browser.close(); await runtime.close(); }
  } else {
    const harness = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] });
    try {
      const { url } = await harness.listen();
      const states = await checkRouteBoundaryAcceptance((path, options) => harness.fetch(path, options));
      checkInspection(states);
      await checkRouteBoundaryBrowser(browser, new URL(url).origin);
    } finally { await browser.close(); await harness.close(); }
  }
}, 120000);
it('generates typed URLs that execute real grouped, dynamic, catch-all and API handlers in production', async () => {
  const root = await project('node');
  const write = async (file, source) => {
    const absolute = path.join(root, file); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, source);
  };
  await write('src/pages/index.ts', `
    import { Cossack, Page as View } from '@cossackframework/core';
    import { html } from '@cossackframework/renderer';
    import { routes } from 'virtual:cossack-routes';
    @View() class Home extends Cossack {
      render() { return html\`<a id="user-link" href=\${routes('/users/[id]', {id:'雪/a?b#c'})}>User</a>
        <a id="docs-link" href=\${routes('/docs/[...path]', {path:['intro','雪/?#%']})}>Docs</a>\`; }
    }
    export { Home as default };
  `);
  // The minimal recipe uses pages/index/index.ts. Keep one resolved owner.
  await fs.rm(path.join(root, 'src/pages/index'), { recursive: true, force: true });
  for (const [file, label] of [['layout.ts', 'root'], ['(account)/layout.ts', 'group']]) {
    await write('src/pages/' + file, `
      import { Cossack, Page } from '@cossackframework/core'; import { html } from '@cossackframework/renderer';
      @Page({middlewares:[async(c,next)=>{c.set('urlTrace',[...(c.get('urlTrace')??[]),'${label}']);await next();}]})
      export default class Layout extends Cossack { render(){return html\`<section>\${this.children}</section>\`;} }
    `);
  }
  await write('src/pages/(account)/users/[id]/index.ts', `
    import { Cossack, Page as View, State } from '@cossackframework/core'; import { html } from '@cossackframework/renderer';
    @View({middlewares:[async(c,next)=>{c.set('urlTrace',[...(c.get('urlTrace')??[]),'page']);await next();}]})
    class User extends Cossack {
      @State() id=''; @State() order='';
      async init(){this.id=this.c.req.param('id')??'';this.order=(this.c.get('urlTrace') as string[]).join(',');if(this.id==='fail')throw new Error('private-url-error');}
      render(){return html\`<main><p id="user-id">\${this.id}</p><p id="order">\${this.order}</p></main>\`;}
    }
    export {User as default};
  `);
  await write('src/pages/docs/[...path]/index.ts', `
    import { Cossack, Page, State } from '@cossackframework/core'; import { html } from '@cossackframework/renderer';
    @Page() export default class Docs extends Cossack {
      @State() path=''; async init(){this.path=this.c.req.param('path')??'';}
      render(){return html\`<p id="doc-path">\${this.path}</p>\`;}
    }
  `);
  await write('src/pages/(account)/api/items/[id].ts', `import type {Context} from 'hono';
    export const GET=(c:Context)=>c.json({handler:'functional',id:c.req.param('id')});
  `);
  await write('src/pages/api/init/[id].ts', `import {Cossack,Page} from '@cossackframework/core';
    @Page() export default class InitApi extends Cossack { async init(){return this.c.json({handler:'class-init',id:this.c.req.param('id')});} }
  `);
  for (const [file, marker] of [['(account)/error/index.ts', 'GROUP_ERROR'], ['error/index.ts', 'ROOT_ERROR'], ['404/index.ts', 'ROOT_NOT_FOUND']]) {
    await write('src/pages/' + file, `import {Cossack,Page} from '@cossackframework/core';import {html} from '@cossackframework/renderer';
      @Page() export default class Boundary extends Cossack{render(){return html\`<p>${marker}</p>\`;}}
    `);
  }
  // This source is checked through the generated virtual import and published declarations.
  // It lives outside the route tree so its negative examples never become handlers.
  await write('src/route-types.ts', `import {routes} from 'virtual:cossack-routes';
    routes('/users/[id]',{id:'ok'});routes('/docs/[...path]',{path:['intro']});routes('/');
    // @ts-expect-error required parameter
    routes('/users/[id]');
    // @ts-expect-error invalid ordinary parameter
    routes('/users/[id]',{id:2});
    const extra={id:'ok',extra:'bad'};
    // @ts-expect-error extra variable parameter
    routes('/users/[id]',extra);
    // @ts-expect-error empty catch-all
    routes('/docs/[...path]',{path:[]});
    // @ts-expect-error boundaries do not have addressable routes
    routes('/error');
  `);
  await vite(root, []);
  await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8'));
  const user = manifest.routes.find(route => route.name === '/users/[id]');
  expect(user).toMatchObject({ pattern: '/users/:id', layoutPaths: ['/src/pages/layout.ts', '/src/pages/(account)/layout.ts'], errorBoundary: '/src/pages/(account)/error/index.ts' });
  expect(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).scripts.typecheck).toBe('cossack routes --generate && tsc --noEmit');
  await fs.rm(path.join(root, '.cossack/routes.ts'));
  const cli = await promisify(execFile)(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'routes', '--generate', '--json'], { cwd: root, timeout: 30000 });
  const inspected = JSON.parse(cli.stdout).data;
  expect(inspected.manifest).toEqual(manifest);
  expect(inspected.routes.find(route => route.name === '/users/[id]').middlewareStack).toEqual([
    { source: '/src/pages/layout.ts:3', count: 1 },
    { source: '/src/pages/(account)/layout.ts:3', count: 1 },
    { source: '/src/pages/(account)/users/[id]/index.ts:3', count: 1 },
  ]);
  expect(inspected.routes.find(route => route.name === '/api/items/[id]').layouts).toEqual([]);
  const typecheck = await promisify(execFile)(process.execPath, [path.join(repository, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: root, timeout: 30000 })
    .catch(error => { throw new Error(`${error.stdout}\n${error.stderr}`); });
  expect(typecheck.stderr).toBe('');
  const runtime = await productionServer(root);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.goto(runtime.origin);
    const url = await page.locator('#user-link').getAttribute('href');
    expect(url).toBe('/users/%E9%9B%AA%2Fa%3Fb%23c');
    await page.locator('#user-link').click();
    await browserExpect(page.locator('#user-id')).toHaveText('雪/a?b#c');
    await browserExpect(page.locator('#order')).toHaveText('root,group,page');
    await page.goto(runtime.origin); await page.locator('#docs-link').click();
    await browserExpect(page.locator('#doc-path')).toHaveText('intro/雪/?#%');
    for (const [name, handler] of [['items', 'functional'], ['init', 'class-init']]) {
      const response = await fetch(runtime.origin + '/api/' + name + '/%E9%9B%AA%2Fa%3Fb%23c');
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ handler, id: '雪/a?b#c' });
    }
    const failed = await fetch(runtime.origin + '/users/fail');
    expect(failed.status).toBe(500); const body = await failed.text();
    expect(body).toContain('GROUP_ERROR'); expect(body).not.toContain('ROOT_ERROR'); expect(body).not.toContain('private-url-error');
    const missing = await fetch(runtime.origin + '/unknown'); expect(missing.status).toBe(404); expect(await missing.text()).toContain('ROOT_NOT_FOUND');
    const assets = path.join(root, 'dist/client/assets');
    for (const file of await fs.readdir(assets)) if (file.endsWith('.js')) {
      const body = await fs.readFile(path.join(assets, file), 'utf8');
      expect(body).not.toContain('node:fs'); expect(body).not.toContain('private-url-error');
    }
  } finally { await browser.close(); await runtime.close(); }
}, 120000);

it.each(['node','cloudflare'])('matches production lifecycle through test utilities in generated %s app',async adapter=>{
  const root=await project(adapter);await writeTestUtilitiesAcceptance(root);await vite(root,[]);
  if(adapter==='node')await vite(root,['--ssr','src/index.ts','--outDir','dist/server']);
  const browser=await chromium.launch({headless:true});
  try {if(adapter==='node'){
    const runtime=await productionServer(root);try{await checkTestUtilitiesAcceptance(browser,runtime.origin,root);}finally{await runtime.close();}
  }else{
    const harness=createTestHarness({root,workers:[{configPath:path.join(root,'dist/ssr/wrangler.json')}]});
    try{const {url}=await harness.listen();await checkTestUtilitiesAcceptance(browser,new URL(url).origin,root);}finally{await harness.close();}
  }}finally{await browser.close();}
},120000);
