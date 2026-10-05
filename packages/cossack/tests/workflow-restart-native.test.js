import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { prepareWorkflowFixture, workflowRequest } from './fixtures/workflow-failure-native.js';

async function port() {
 const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
 const selected = server.address().port; await new Promise(resolve => server.close(resolve)); return selected;
}
async function persistedRunner(fixture, state) {
 const require = createRequire(path.join(fixture.root, 'package.json'));
 const binary = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
 const selected = await port();
 const child = spawn(process.execPath, [binary, 'dev', '--config', fixture.configPath, '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', String(selected), '--inspector-port', '0', '--log-level', 'error', '--show-interactive-dev-session=false'], {
  cwd: fixture.root, detached: process.platform !== 'win32', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CLOUDFLARE_ENV: '', CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', CI: 'true', WRANGLER_LOG_PATH: path.join(fixture.parent, `native-${selected}.log`) },
 });
 let stopped = false, bytes = 0;
 const closed = new Promise(resolve => { child.once('close', () => { stopped = true; resolve(); }); child.once('error', () => { stopped = true; resolve(); }); });
 const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
 // Capture no application/provider values; drain and bound both streams.
 for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) kill(); });
 const deadline = setTimeout(kill, 120000); deadline.unref();
 const stop = async () => { if (!stopped) kill(); await closed; clearTimeout(deadline); };
 const origin = `http://127.0.0.1:${selected}`;
 try {
  await expect.poll(async () => {
   if (stopped) throw new Error('Native persisted Workflow process stopped before readiness');
   try { return (await workflowRequest(origin, 'inspect', { identity: {} })).status; } catch { return 0; }
  }, { timeout: 30000 }).toBe(400);
  return { origin, pid: child.pid, stop, closed };
 } catch (caught) { await stop(); throw caught; }
}

it('preserves native paused state and completed steps across an actual process interruption', async () => {
 const fixture = await prepareWorkflowFixture(); const state = path.join(fixture.parent, 'provider-state'); let runtime;
 try {
  runtime = await persistedRunner(fixture, state); const firstPid = runtime.pid;
  let call = (op, values) => workflowRequest(runtime.origin, op, values);
  const invoked = await call('invoke', { key: 'restart-one' }); expect(invoked.status).toBe(200); const identity = invoked.value;
  await expect.poll(async () => (await call('audit', { identity })).value, { timeout: 30000 }).toEqual([{ kind: 'attempt', n: 2 }, { kind: 'first', n: 1 }]);
  expect((await call('pause', { identity })).status).toBe(200);
  // Do not mistake waitingForPause for fully paused, or Running for Waiting.
  await expect.poll(async () => (await call('nativeStatus', { identity })).value.status, { timeout: 30000 }).toBe('paused');
  await runtime.stop(); await runtime.closed;
  expect(await fs.readdir(state)).not.toHaveLength(0);
  runtime = await persistedRunner(fixture, state); expect(runtime.pid).not.toBe(firstPid);
  call = (op, values) => workflowRequest(runtime.origin, op, values);
  expect((await call('nativeStatus', { identity })).value.status).toBe('paused');
  expect((await call('inspect', { identity })).value.status).toBe('paused');
  expect((await call('resume', { identity })).status).toBe(200);
  expect((await call('event', { identity, payload: { approved: true } })).status).toBe(200);
  await expect.poll(async () => (await call('inspect', { identity })).value.status, { timeout: 30000 }).toBe('complete');
  expect((await call('audit', { identity })).value).toEqual([{ kind: 'approved', n: 1 }, { kind: 'attempt', n: 2 }, { kind: 'first', n: 1 }, { kind: 'last', n: 1 }]);
 } finally { await runtime?.stop(); await fs.rm(fixture.parent, { recursive: true, force: true }); }
}, 240000);
