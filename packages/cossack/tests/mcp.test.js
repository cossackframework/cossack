import { writeDevelopmentTrace } from '@cossackframework/framework/development-traces';
import { tracesCommand } from '../src/commands/traces.js';
import { randomUUID } from 'node:crypto';
import { beginTestReport, writeTestReport, testSourceSnapshot } from '../src/test-results-service.js';
import { testResultsCommand } from '../src/commands/test-results.js';
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { readPackageVersion } from '../src/pkg.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { inspectProject } from '../src/inspection-service.js';
import { inspectCommand, checkCommand } from '../src/commands/inspect.js';
import { InspectionRunner } from '../src/mcp/inspection-runner.js';
const roots = [], clients = [], runners = [];
const bin = fileURLToPath(new URL('../bin/cossack-mcp.js', import.meta.url));
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map(client => client.close()));
  await Promise.all(runners.splice(0).map(runner => runner.close()));
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-mcp-')); roots.push(root);
  await fs.mkdir(path.join(root, 'src/pages'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'mcp-test', dependencies: {} }));
  await fs.writeFile(path.join(root, 'src/pages/index.ts'), `import { Cossack, Page } from '@cossackframework/core';
    @Page({transport:'http'}) export default class Index extends Cossack { render(){return null;} }`);
  return root;
}
async function connect(root, options) {
  const client = new Client({ name: 'cossack-test', version: '1' }, options); clients.push(client);
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin, '--project', root], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
  await client.connect(transport);
  return { client, transport, stderr: () => stderr };
}
it('serves the same route facts and diagnostics as CLI with versions and read-only annotations', async () => {
  const root = await fixture();
  const { client, stderr } = await connect(root);
  const tools = await client.listTools();
  expect(tools.tools.map(tool => tool.name).sort()).toEqual(['inspect_project', 'read_development_traces', 'read_documentation', 'read_test_results']);
  expect(tools.tools[0]).toMatchObject({ name: 'inspect_project', annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } });
  const result = await client.callTool({ name: 'inspect_project', arguments: { scope: 'routes' } });
  expect(result.structuredContent).toMatchObject({ schemaVersion: 1, versions: { cli: readPackageVersion(), framework: null }, ok: true });
  const ctx = { cwd: root, flags: { json: true } };
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await inspectCommand(['routes'], ctx);
  expect(result.structuredContent.data).toEqual(JSON.parse(log.mock.calls[0][0]).data);
  log.mockClear();
  await checkCommand(['routes'], ctx);
  const checked = JSON.parse(log.mock.calls[0][0]);
  const remoteCheck = await client.callTool({ name: 'inspect_project', arguments: { scope: 'routes', check: true } });
  expect(remoteCheck.structuredContent).toMatchObject({ data: checked.data, diagnostics: checked.diagnostics, ok: checked.ok });
  expect(stderr()).toBe('');
}, 30_000);
it('rejects unknown tools, unknown fields and paths without reading arbitrary files', async () => {
  const root = await fixture(); const { client } = await connect(root);
  await expect(client.callTool({ name: 'read_secret', arguments: {} })).rejects.toThrow();
  const bad = await client.callTool({ name: 'inspect_project', arguments: { scope: 'routes', root: '/tmp' } });
  expect(bad.isError).toBe(true);
  const route = await client.callTool({ name: 'inspect_project', arguments: { scope: 'routes', route: '../../.env' } });
  expect(route.structuredContent).toMatchObject({ ok: false, diagnostics: [{ code: 'COSSACK_ROUTE_UNKNOWN' }] });
  expect(JSON.stringify(route)).not.toContain('../../.env');
}, 30_000);
it('worker cancellation and deadlines release synchronous work and allow later calls', async () => {
  const root = await fixture(); const worker = path.join(root, 'blocked.mjs');
  await fs.writeFile(worker, 'while (true) {}');
  const runner = new InspectionRunner(root, { timeout: 100, workerUrl: pathToFileURL(worker) }); runners.push(runner);
  const controller = new AbortController();
  const call = runner.run({}, controller.signal); controller.abort();
  await expect(call).rejects.toMatchObject({ code: 'COSSACK_MCP_CANCELED' });
  expect(runner.activeCount).toBe(0);
  await expect(runner.run({})).rejects.toMatchObject({ code: 'COSSACK_MCP_TIMEOUT' });
  expect(runner.activeCount).toBe(0);
  runner.workerUrl = new URL('../src/mcp/inspection-worker.js', import.meta.url); runner.timeout = 10_000;
  expect(await runner.run({ scope: 'routes' })).toEqual(await inspectProject(root, { scope: 'routes' }));
  expect(runner.activeCount).toBe(0);
  await runner.close();
  await expect(runner.run({})).rejects.toMatchObject({ code: 'COSSACK_MCP_CLOSED' });
}, 30_000);
it('shutdown terminates active workers and rejects their calls', async () => {
  const root = await fixture(); const worker = path.join(root, 'blocked.mjs');
  await fs.writeFile(worker, 'setInterval(()=>{},1000);');
  const runner = new InspectionRunner(root, { workerUrl: pathToFileURL(worker) }); runners.push(runner);
  const result = runner.run({}).catch(error => error);
  await runner.close();
  expect(await result).toMatchObject({ code: 'COSSACK_MCP_CLOSED' });
  expect(runner.activeCount).toBe(0);
});

it('identifies the installed framework without importing application modules', async () => {
  const root = await fixture();
  await fs.mkdir(path.join(root, 'node_modules/@cossackframework'), { recursive: true });
  const framework = fileURLToPath(new URL('../../framework', import.meta.url));
  await fs.symlink(framework, path.join(root, 'node_modules/@cossackframework/framework'), 'junction');
  const { client } = await connect(root);
  const result = await client.callTool({ name: 'inspect_project', arguments: { scope: 'routes' } });
  const pkg = JSON.parse(await fs.readFile(path.join(framework, 'package.json'), 'utf8'));
  expect(result.structuredContent.versions.framework).toBe(pkg.version);
}, 30_000);
it('exits promptly on stdin EOF and rejects invalid startup without exposing the path', async () => {
  const root = await fixture();
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server failed to exit after EOF')); }, 5000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end();
  });
  expect(await run(['--project', root])).toEqual({ code: 0, stdout: '', stderr: '' });
  const failed = await run(['--project', path.join(root, 'secret-path')]);
  expect(failed.code).toBe(1); expect(failed.stdout).toBe('');
  expect(failed.stderr).toContain('COSSACK_MCP_START_FAILED');
  expect(failed.stderr).not.toContain('secret-path');
}, 15_000);
it('redacts configured secret values and keeps dependency logs off protocol output', async () => {
  const root = await fixture();
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
  await fs.symlink(path.dirname(require.resolve('wrangler/package.json')), path.join(root, 'node_modules/wrangler'), 'junction');
  await fs.writeFile(path.join(root, 'index.js'), 'throw new Error("application-must-not-execute")');
  await fs.writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'fixture', main: './index.js', compatibility_date: '2026-06-06', vars: { APP_SECRET: 'private-mcp-fixture-secret', APP_URL: 'https://example.com', PORT: 'private-mcp-port-sentinel' } }));
  await fs.mkdir(path.join(root, 'src/config'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/config/app.ts'), "export const requirements = { variables: { PORT: { type: 'number', coerce: true } } }; export default () => { throw new Error('configuration-must-not-execute'); };");
  const { client, stderr } = await connect(root);
  const result = await client.callTool({ name: 'inspect_project', arguments: { scope: 'cloudflare', check: true } });
  expect(result.structuredContent.ok).toBe(false);
  expect(result.structuredContent.diagnostics.length).toBeGreaterThan(0);
  expect(result.structuredContent.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'COSSACK_CONFIG_VARIABLE_INVALID', name: 'PORT' })]));
  const direct = await inspectProject(root, { scope: 'cloudflare', check: true });
  expect(result.structuredContent.data).toEqual(direct.data);
  expect(result.structuredContent.diagnostics).toEqual(direct.diagnostics);
  expect(JSON.stringify(result)).not.toMatch(/private-mcp-port-sentinel|configuration-must-not-execute/);
  expect(JSON.stringify(result)).not.toContain('private-mcp-fixture-secret');
  expect(JSON.stringify(result)).not.toContain('application-must-not-execute');
  expect(stderr()).toBe('');
  const original = process.env.CLOUDFLARE_ENV;
  try {
    process.env.CLOUDFLARE_ENV = 'missing-environment';
    await expect(inspectProject(root, { scope: 'cloudflare' })).rejects.toMatchObject({ code: 'COSSACK_ENVIRONMENT_UNKNOWN' });
  } finally {
    if (original === undefined) delete process.env.CLOUDFLARE_ENV; else process.env.CLOUDFLARE_ENV = original;
  }
}, 30_000);
it.each(['eof', 'signal'])('releases an initialized server on %s', async action => {
  const root = await fixture();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, '--project', root], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', initialized = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('initialized server did not exit')); }, 5000);
    child.stderr.on('data', data => { stderr += data; });
    child.stdout.on('data', data => {
      stdout += data;
      if (!initialized && stdout.includes('\n')) {
        initialized = true;
        if (action === 'eof') child.stdin.end(); else child.kill('SIGTERM');
      }
    });
    child.on('exit', code => {
      clearTimeout(timer);
      try { expect(initialized).toBe(true); expect(code).toBe(0); expect(stderr).toBe(''); expect(JSON.parse(stdout).result.serverInfo.name).toBe('cossack'); resolve(); }
      catch (error) { reject(error); }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n');
  });
}, 10_000);

it('serves the current protocol revision through the SDK stdio negotiation', async () => {
  const root = await fixture();
  const { client } = await connect(root, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const result = await client.callTool({ name: 'inspect_project', arguments: { scope: 'routes' } });
  expect(result.structuredContent).toMatchObject({ schemaVersion: 1, ok: true, data: { scope: 'routes' } });
}, 30_000);
it('bounds concurrent worker calls and large results', async () => {
  const root = await fixture(); const worker = path.join(root, 'blocked.mjs');
  await fs.writeFile(worker, 'setInterval(()=>{},1000);');
  const runner = new InspectionRunner(root, { workerUrl: pathToFileURL(worker) }); runners.push(runner);
  const calls = Array.from({ length: 4 }, () => runner.run({}).catch(error => error));
  await expect(runner.run({})).rejects.toMatchObject({ code: 'COSSACK_MCP_BUSY' });
  await runner.close(); await Promise.all(calls);
  expect(runner.activeCount).toBe(0);
  await fs.writeFile(worker, `import {parentPort} from 'node:worker_threads'; parentPort.postMessage('x'.repeat(4*1024*1024));`);
  const large = new InspectionRunner(root, { workerUrl: pathToFileURL(worker) }); runners.push(large);
  await expect(large.run({})).rejects.toMatchObject({ code: 'COSSACK_MCP_RESULT_TOO_LARGE' });
  expect(large.activeCount).toBe(0);
});
it('shares the installed documentation catalog with the CLI service', async () => {
  const root = await fixture(); const {client}=await connect(root);
  const {readDocumentation}=await import('../src/documentation-service.js');
  const result=await client.callTool({name:'read_documentation',arguments:{package:'@cossackframework/core'}});
  const direct=await readDocumentation(root,{package:'@cossackframework/core'});
  expect(result.structuredContent).toMatchObject(direct);
  expect(result.structuredContent.data.guide.version).toBe(readPackageVersion());
  const folder = path.join(root, 'node_modules/@cossackframework/framework');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: '@cossackframework/framework', version: '9.9.9', exports: { '.': './missing.js' } }));
  const refreshed = await client.callTool({ name: 'read_documentation', arguments: { package: '@cossackframework/framework' } });
  expect(refreshed.structuredContent.versions.framework).toBe('9.9.9');
  expect(refreshed.structuredContent.data.packages[0].version).toBe('9.9.9');
  await fs.writeFile(path.join(folder, 'package.json'), '{"private-fixture-value":');
  const broken = await connect(root);
  const diagnostic = await broken.client.callTool({ name: 'read_documentation', arguments: { package: '@cossackframework/framework' } });
  expect(diagnostic.structuredContent).toMatchObject({ ok: false, versions: { framework: null }, diagnostics: [{ code: 'COSSACK_DOCS_MANIFEST_INVALID' }] });
  expect(JSON.stringify(diagnostic)).not.toContain('private-fixture-value');
  const invalid=await client.callTool({name:'read_documentation',arguments:{package:'../../private'}});
  expect(invalid.isError).toBe(true);
},30000);
it('indexes installed signatures through the cancellable MCP worker', async () => {
  const root = await fixture();
  const folder = path.join(root,'node_modules/@cossackframework/core');
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'package.json'),JSON.stringify({name:'@cossackframework/core',version:'0.1.2',exports:{'.':{types:'./index.d.ts',import:'./index.js'}}}));
  await fs.writeFile(path.join(folder,'index.d.ts'),'export declare function find<T>(value:T):Promise<T>;');
  await fs.writeFile(path.join(folder,'index.js'),'throw new Error("must not execute")');
  const {client}=await connect(root);
  const result=await client.callTool({name:'read_documentation',arguments:{package:'@cossackframework/core',symbols:true}});
  expect(result.structuredContent.data.packages[0].declarations).toMatchObject({status:'indexed',entries:[{symbols:[{name:'find',callSignatures:['<T>(value: T): Promise<T>']}]}]});
  const filtered=await client.callTool({name:'read_documentation',arguments:{package:'@cossackframework/core',symbols:true,symbol:'find'}});
  expect(filtered.isError).toBe(false);
  expect(filtered.structuredContent.data.packages[0].declarations.selection).toEqual({name:'find',matched:true});
  const invalidFilter=await client.callTool({name:'read_documentation',arguments:{package:'@cossackframework/core',symbol:'find'}});
  expect(invalidFilter.isError).toBe(true);
  const invalid=await client.callTool({name:'read_documentation',arguments:{symbols:true}});
  expect(invalid.isError).toBe(true);
},30000);

it('reads the same stored evidence through CLI and MCP and refreshes source freshness', async () => {
  const root = await fixture();
  const report = await beginTestReport(root, { name: 'vitest', version: '4.1.11' }, 1);
  await writeTestReport(root, { ...report, state: 'failed', finishedAt: new Date().toISOString(), after: await testSourceSnapshot(root), failedModules: 1 });
  const { client, stderr } = await connect(root);
  const remote = await client.callTool({ name: 'read_test_results', arguments: {} });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await testResultsCommand([], { cwd: root, flags: { json: true } })).toBe(0);
  const cli = JSON.parse(log.mock.calls[0][0]);
  expect(remote.structuredContent.data).toEqual(cli.data);
  expect(cli.data).toMatchObject({ status: 'recorded', report: { state: 'failed' }, freshness: { status: 'matches' } });
  await fs.writeFile(path.join(root, 'source.ts'), 'changed');
  const changed = await client.callTool({ name: 'read_test_results', arguments: { run: report.id } });
  expect(changed.structuredContent.data.freshness.status).toBe('changed');
  expect((await client.callTool({ name: 'read_test_results', arguments: { run: '../../.env' } })).isError).toBe(true);
  expect((await client.callTool({ name: 'read_test_results', arguments: { root: '/tmp' } })).isError).toBe(true);
  await fs.writeFile(path.join(root, '.vitest/cossack', report.id + '.json'), '{"password":"private-invalid-value"');
  const invalid = await client.callTool({ name: 'read_test_results', arguments: {} });
  expect(invalid.isError).toBe(true); expect(invalid.structuredContent.diagnostics[0].code).toBe('COSSACK_TEST_REPORT_INVALID');
  expect(JSON.stringify(invalid)).not.toContain('private-invalid-value'); expect(stderr()).toBe('');
}, 30_000);

it('reads the same bounded development record through MCP and CLI without starting capture', async () => {
  const root = await fixture(), session = randomUUID(), callId = randomUUID(), requestId = randomUUID(), dispatchId = randomUUID();
  await writeDevelopmentTrace(root, randomUUID(), JSON.stringify({ schemaVersion: 1, sessionId: session,
    startedAt: Date.now(), capturedAt: Date.now(), collecting: true, capacity: 512, dropped: 0,
    events: [{ kind: 'service-rpc', sequence: 1, timestamp: Date.now(), phase: 'start',
      serviceId: 1, callId, requestId, transport: 'http', outcome: null },
      { kind: 'server-rpc', sequence: 2, timestamp: Date.now(), phase: 'response', schemaVersion: 1,
        callId, requestId, dispatchId, receivedAt: 1, invokedAt: 2,
        returnedAt: 3, respondedAt: 4, result: 'stream', status: 200 },
      {kind:'server-stream',phase:'finish',sequence:3,timestamp:Date.now(),schemaVersion:1,callId,requestId,dispatchId,finishedAt:5,outcome:'succeeded',cleanup:'completed'}],
    components: { entries: [], dropped: 0, tracking: 'weak' } }));
  const { client, stderr } = await connect(root);
  const response = await client.callTool({ name: 'read_development_traces', arguments: { session } });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await tracesCommand([], { cwd: root, flags: { json: true, session } });
  const cli = JSON.parse(log.mock.calls[0][0]);
  expect(response.structuredContent).toMatchObject({ ok: true, data: { status: 'recorded', record: cli.data.record, freshness: { live: false, status: 'recorded-snapshot' } } });
  expect(cli.data.freshness.ageMs).toBeGreaterThanOrEqual(0);
  expect((await client.callTool({ name: 'read_development_traces', arguments: { session: '../../.env' } })).isError).toBe(true);
  expect((await client.callTool({ name: 'read_development_traces', arguments: { root: '/tmp' } })).isError).toBe(true);
  expect(stderr()).toBe('');
}, 30000);

it.each(['cancel', 'close', 'signal'])('releases busy stdio documentation workers on %s', async action => {
  const root = await fixture();
  const folder = path.join(root, 'node_modules/@cossackframework/core');
  await fs.mkdir(folder, { recursive: true });
  const declaration = path.join(folder, 'blocked.d.ts');
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({
    name: '@cossackframework/core', version: '0.1.2', exports: { '.': { types: './blocked.d.ts' } },
  }));
  await fs.writeFile(declaration, 'export declare function example(): void;');
  const preload = path.join(root, 'observe-workers.cjs');
  // Delay a real compiler file read, after the SDK request owns a real worker.
  // Observe native worker exits separately from client promise settlement.
  // No production test hooks or replacement MCP handlers are involved.
  await fs.writeFile(preload, `
    const fs = require('node:fs');
    const path = require('node:path');
    const threads = require('node:worker_threads');
    const root = ${JSON.stringify(root)};
    if (threads.isMainThread) {
      const OriginalWorker = threads.Worker;
      threads.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args);
          const id = this.threadId;
          this.once('exit', () => fs.writeFileSync(path.join(root, 'exited-' + id), 'done'));
        }
      };
      require('node:module').syncBuiltinESMExports();
      process.on('exit', code => fs.writeFileSync(path.join(root, 'server-exit'), String(code)));
      process.on('SIGTERM', () => fs.writeFileSync(path.join(root, 'server-signal'), 'SIGTERM'));
    } else {
      const read = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        if (String(file) === ${JSON.stringify(declaration)}) {
          fs.writeFileSync(path.join(root, 'entered-' + threads.threadId), 'ready');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return read.call(this, file, ...args);
      };
      require('node:module').syncBuiltinESMExports();
    }
  `);
  const client = new Client({ name: 'native-interruption-acceptance', version: '1' });
  clients.push(client);
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--require', preload, bin, '--project', root], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', data => { stderr += data; });
  await client.connect(transport);
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const calls = controllers.map(controller => client.callTool({
    name: 'read_documentation', arguments: { package: '@cossackframework/core', symbols: true },
  }, { signal: controller.signal }).then(value => ({ value }), error => ({ error })));
  const observed = async prefix => (await fs.readdir(root)).filter(file => file.startsWith(prefix));
  try {
    await expect.poll(() => observed('entered-'), { timeout: 10000 }).toHaveLength(4);
    const busy = await client.callTool({ name: 'read_test_results', arguments: {} });
    expect(busy.structuredContent.diagnostics[0].code).toBe('COSSACK_MCP_BUSY');
    if (action === 'cancel') controllers.forEach(controller => controller.abort());
    else if (action === 'close') await client.close();
    else process.kill(transport.pid, 'SIGTERM');
    await expect.poll(() => observed('exited-'), { timeout: 5000 }).toHaveLength(4);
    const settled = await Promise.all(calls);
    expect(settled.every(result => result.error || result.value?.isError)).toBe(true);
    if (action === 'cancel') {
      const recovered = await Promise.all(Array.from({ length: 4 }, () => client.callTool({ name: 'read_test_results', arguments: {} })));
      expect(recovered.every(result => result.structuredContent.ok)).toBe(true);
      await client.close();
    }
    await expect.poll(async () => fs.readFile(path.join(root, 'server-exit'), 'utf8').catch(() => null), { timeout: 5000 }).toBe('0');
    if (action !== 'signal') expect(await observed('server-signal')).toEqual([]);
    expect(stderr).toBe('');
  } finally {
    controllers.forEach(controller => controller.abort());
    await client.close();
  }
}, 30000);
