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
  expect(tools.tools).toHaveLength(1);
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
  await fs.writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'fixture', main: './index.js', compatibility_date: '2026-06-06', vars: { APP_SECRET: 'private-mcp-fixture-secret', APP_URL: 'https://example.com' } }));
  const { client, stderr } = await connect(root);
  const result = await client.callTool({ name: 'inspect_project', arguments: { scope: 'cloudflare', check: true } });
  expect(result.structuredContent.ok).toBe(false);
  expect(result.structuredContent.diagnostics.length).toBeGreaterThan(0);
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
