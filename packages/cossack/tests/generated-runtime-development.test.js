// Generated development servers: Node dev WebSockets/HMR, state docs, DataTable,
// browser RPC traces shared with the CLI and MCP, cossack dev, and Deno runtimes.
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
import { skipWithoutDeno } from './fixtures/deno.js';

afterEach(cleanupRoots);

it.each(['script', 'vite'])('runs generated Node development WebSockets through %s, preserves HMR, and replaces runtime state on source reload', async mode => {
  await verifyNodeDevelopmentApplication(await project('node'), mode);
}, 60000);

async function developmentServer(root) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from 'vite';
    const server = await createServer({ root: process.cwd(), server: { port: 0, host: '127.0.0.1' } });
    await server.listen();
    console.log('STATE_DEV_ORIGIN=http://127.0.0.1:' + server.httpServer.address().port);
    process.on('message', async message => { if (message === 'STOP') { await server.close(); process.exit(0); } });
  `], { cwd: root, env: { ...process.env, NODE_ENV: 'development', VITEST: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  const close = async () => {
    if (child.connected) child.send('STOP');
    else child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited;
    clearTimeout(kill);
    expect({ code, signal }, output).toEqual({ code: 0, signal: null });
  };
  try {
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      return /STATE_DEV_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
    }, { timeout: 20000 }).toBeTruthy();
  } catch (error) { await close(); throw error; }
  return { origin: /STATE_DEV_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1], close, output: () => output };
}



it('runs state documentation examples and diagnostics in a published development app', async () => {
  const root = await project('node');
  await writeStateExample(root);
  await typecheck(root, 'Generated state types');
  await checkStateExample('development', await developmentServer(root));
}, 120000);




it.each(['node', 'cloudflare'])('integrates the DataTable with URL state and server resources in generated %s', async adapter => {
  const backend=await createDataTableBackend();
  try {
    const root=await project(adapter,['ui']);await writeDataTableAcceptance(root,backend.origin);
    try { await promisify(execFile)('pnpm',['exec','tsc','--noEmit'],{cwd:root,timeout:30000,maxBuffer:1024*1024}); }
    catch(error){throw new Error(`Generated DataTable types: ${error.stdout}\n${error.stderr}`);}
    await vite(root,[]);
    if(adapter==='node')await vite(root,['--ssr','src/index.ts','--outDir','dist/server']);
    const browser=await chromium.launch({headless:true});
    try {
      if(adapter==='node'){
        const runtime=await productionServer(root);
        try{await checkDataTableBrowser(browser,runtime.origin,backend);}finally{await runtime.close();}
      }else{
        const harness=createTestHarness({root,workers:[{configPath:path.join(root,'dist/ssr/wrangler.json')}]});
        try{const {url}=await harness.listen();await checkDataTableBrowser(browser,new URL(url).origin,backend);}finally{await harness.close();}
      }
    }finally{await browser.close();}
  }finally{await backend.close();}
},120000);

// HTTP and SSE pages share the client HTTP proxy and the /crpc evidence path;
// SSE only diverges server-side through the Cloudflare coordinator Durable
// Object. Every runtime keeps its own WebSocket host (durable-object). HTTPS
// only affects the Deno development proxy (URL protocol and wss upgrade), so
// one Deno case runs over TLS through the socket transport.
const traceRuntimeCases = [
  ['cloudflare', 'http', false], ['cloudflare', 'sse', false], ['cloudflare', 'durable-object', false],
  ['node', 'http', false], ['node', 'durable-object', false],
  ...(skipWithoutDeno ? [] : [['deno', 'http', false], ['deno', 'durable-object', true]]),
];
it.each(traceRuntimeCases)('shares a generated %s development browser RPC trace over %s with the CLI and MCP (HTTPS: %s)', async (runtime, transport, https) => {
  const {Client}=await import('@modelcontextprotocol/client');
  const {StdioClientTransport}=await import('@modelcontextprotocol/client/stdio');
  const root=await project(runtime);
  await verifyDevelopmentTraceApplication(root,{
    additionalAllowedPaths:[repository],transport,runtime,https,
    launcher:runtime==='deno'?{entry:path.join(repository,'packages/cossack/bin/cossack.js'),binDirectory:path.join(repository,'node_modules/.bin'),json:https}:undefined,
    async onRecorded({snapshot,recorded}) {
      const {stdout,stderr:cliStderr}=await promisify(execFile)(process.execPath,[path.join(repository,'packages/cossack/bin/cossack.js'),'traces','--json','--session',snapshot.sessionId],{cwd:root,timeout:15000,maxBuffer:2*1024*1024});
      const cli=JSON.parse(stdout);
      expect(cli).toMatchObject({ok:true,data:{record:recorded,freshness:{live:false}}});
      expect(cliStderr).toBe('');
      const client=new Client({name:'generated-trace-acceptance',version:'1.0.0'});
      try {
        const transport=new StdioClientTransport({command:process.execPath,args:[path.join(repository,'packages/cossack/bin/cossack-mcp.js'),'--project',root],stderr:'pipe'});
        let stderr='';transport.stderr?.on('data',data=>{stderr+=data;});await client.connect(transport);
        const remote=await client.callTool({name:'read_development_traces',arguments:{session:snapshot.sessionId}});
        expect(remote.structuredContent).toMatchObject({ok:true,data:{record:cli.data.record,freshness:{live:false}}});
        expect(stderr).toBe('');
      } finally {await client.close();}
    },
  });
},180000);

it.each([true, false])('serves generated Node pages, native requests, cookies and source reload through cossack dev (json: %s)', async json => {
  const { createServer } = await import('node:net');
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const root = await project('node');
  const endpoint = path.join(root, 'src/pages/api/dev-check.ts');
  await fs.mkdir(path.dirname(endpoint), { recursive: true });
  const source = value => `
    import { defineApi } from '@cossackframework/framework/api';
    export const POST = defineApi({ handler: async ({c}) => {
      const headers = new Headers();
      headers.append('set-cookie', 'first=1; Path=/'); headers.append('set-cookie', 'second=2; Path=/');
      return new Response(${JSON.stringify(value)} + ':' + await c.req.text(), { headers });
    } });
  `;
  await fs.writeFile(endpoint, source('first'));
  const child = spawn(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'dev', ...(json ? ['--json'] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, env: { ...process.env, PATH: path.join(repository, 'node_modules/.bin') + path.delimiter + process.env.PATH, NODE_ENV: 'development', VITEST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit'); const origin = `http://127.0.0.1:${port}`;
  const post = () => fetch(origin + '/api/dev-check', { method: 'POST', body: 'body' });
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error(output);
      try { return await (await post()).text(); } catch { return ''; }
    }, { timeout: 30000 }).toBe('first:body');
    expect((await post()).headers.getSetCookie()).toEqual(['first=1; Path=/', 'second=2; Path=/']);
    expect(await (await fetch(origin)).text()).toContain('window.__INITIAL_STATE__');
    expect((await fetch(origin + '/@vite/client')).status).toBe(200);
    await fs.writeFile(endpoint, source('second'));
    await expect.poll(async () => (await post()).text(), { timeout: 15000 }).toBe('second:body');
  } finally {
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
    const [code, signal] = await exited; clearTimeout(kill);
    expect({code,signal},output).toEqual({code:0,signal:null});
    if (json) {
      const events = output.trim().split('\n').map(line => JSON.parse(line));
      expect(events.at(-1)).toMatchObject({ok:true,data:{event:'stopped',reason:'requested'}});
    } else expect(output).not.toContain('"schemaVersion":1,"command":"dev"');
    await expect.poll(() => fetch(origin).then(() => true, () => false)).toBe(false);
  }
}, 60000);

it.skipIf(!process.env.COSSACK_DENO_BINARY)('executes a generated Deno application with HTTP, SSE, WebSockets and browser hydration', async () => {
  const {writeDenoRuntimeAcceptance,verifyDenoRuntimeApplication,verifyDenoCliStartup}=await import('./fixtures/deno-runtime-acceptance.js');
  const root=await project('deno');
  await writeDenoRuntimeAcceptance(root);
  try { await promisify(execFile)('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root }); }
  catch (error) { throw new Error(`${error.stdout}\n${error.stderr}`); }
  await vite(root, []);
  await vite(root, ['--ssr','src/index.ts','--outDir','dist/server']);
  await assertPortableChunks(path.join(root,'dist/server'));
  await verifyDenoRuntimeApplication(root);
  await verifyDenoCliStartup(root, process.env.COSSACK_DENO_BINARY);
},120000);

it.skipIf(!process.env.COSSACK_DENO_BINARY).each([false, true])('serves generated Deno development through a native module runner (crash=%s)', async crash => {
  const { writeDenoRuntimeAcceptance, verifyDenoDevelopmentApplication } = await import('./fixtures/deno-runtime-acceptance.js');
  const root = await project('deno');
  await writeDenoRuntimeAcceptance(root);
  await verifyDenoDevelopmentApplication(root, crash);
},120000);
