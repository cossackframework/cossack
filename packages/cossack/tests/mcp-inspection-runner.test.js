import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { InspectionRunner, dependencyFingerprint } from '../src/mcp/inspection-runner.js';

const roots = [], runners = [];
const encoder = new URL('../src/mcp/inspection-result.js', import.meta.url).href;
afterEach(async () => {
  await Promise.all(runners.splice(0).map(runner => runner.close()));
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

// A stand-in for inspection-worker.js that reports which worker served the
// call and how many calls that worker has served.
const echoWorker = `
import { parentPort, threadId, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import { encodeInspectionResult } from ${JSON.stringify(encoder)};
let calls = 0;
parentPort.on('message', ({ input }) => {
  calls++;
  if (input.crash) process.exit(1);
  if (input.hang) return;
  if (input.throw) {
    parentPort.postMessage({ ...encodeInspectionResult({ ok: false, data: null, diagnostics: [] }), recycle: true });
    return;
  }
  const source = fs.readFileSync(workerData.root + '/source.txt', 'utf8');
  parentPort.postMessage(encodeInspectionResult({ ok: true, threadId, calls, source }));
});
`;

async function setup(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-mcp-runner-')); roots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'runner-test' }));
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  await fs.writeFile(path.join(root, 'source.txt'), 'first');
  const worker = path.join(root, 'echo-worker.mjs');
  await fs.writeFile(worker, echoWorker);
  const runner = new InspectionRunner(root, { workerUrl: pathToFileURL(worker), ...options }); runners.push(runner);
  return { root, runner };
}

it('reuses one worker for consecutive calls and reads project files fresh', async () => {
  const { root, runner } = await setup();
  const first = await runner.run({ scope: 'routes' });
  expect(first).toMatchObject({ ok: true, calls: 1, source: 'first' });
  await fs.writeFile(path.join(root, 'source.txt'), 'second');
  const second = await runner.run({ scope: 'routes' });
  expect(second).toMatchObject({ ok: true, calls: 2, source: 'second', threadId: first.threadId });
  expect(runner.workerCount).toBe(1);
  expect(runner.activeCount).toBe(0);
});

it('replaces the worker when the project dependencies change', async () => {
  const { root, runner } = await setup();
  const first = await runner.run({});
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\npackages: {}\n');
  const afterLockfile = await runner.run({});
  expect(afterLockfile).toMatchObject({ calls: 1 });
  expect(afterLockfile.threadId).not.toBe(first.threadId);
  await fs.mkdir(path.join(root, 'node_modules/wrangler'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules/wrangler/package.json'), JSON.stringify({ name: 'wrangler', version: '4.0.0' }));
  const afterWrangler = await runner.run({});
  expect(afterWrangler.threadId).not.toBe(afterLockfile.threadId);
  await fs.writeFile(path.join(root, 'node_modules/wrangler/package.json'), JSON.stringify({ name: 'wrangler', version: '4.10.0' }));
  const afterUpgrade = await runner.run({});
  expect(afterUpgrade.threadId).not.toBe(afterWrangler.threadId);
  expect(runner.workerCount).toBe(1);
});

it('fingerprints the manifest, nearest lockfile and resolved Wrangler only', async () => {
  const { root } = await setup();
  const initial = await dependencyFingerprint(root);
  await fs.writeFile(path.join(root, 'source.txt'), 'edited');
  await fs.writeFile(path.join(root, 'wrangler.jsonc'), '{}');
  expect(await dependencyFingerprint(root)).toBe(initial);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'runner-test', dependencies: { wrangler: '4' } }));
  expect(await dependencyFingerprint(root)).not.toBe(initial);
});

it('does not reuse a worker after a thrown inspection, a crash or a timeout', async () => {
  const { runner } = await setup({ timeout: 500 });
  const healthy = await runner.run({});
  expect(await runner.run({ throw: true })).toMatchObject({ ok: false });
  const afterThrow = await runner.run({});
  expect(afterThrow).toMatchObject({ ok: true, calls: 1 });
  expect(afterThrow.threadId).not.toBe(healthy.threadId);
  await expect(runner.run({ crash: true })).rejects.toMatchObject({ code: 'COSSACK_INSPECTION_FAILED' });
  const afterCrash = await runner.run({});
  expect(afterCrash).toMatchObject({ ok: true, calls: 1 });
  expect(afterCrash.threadId).not.toBe(afterThrow.threadId);
  await expect(runner.run({ hang: true })).rejects.toMatchObject({ code: 'COSSACK_MCP_TIMEOUT' });
  const afterTimeout = await runner.run({});
  expect(afterTimeout).toMatchObject({ ok: true, calls: 1 });
  expect(afterTimeout.threadId).not.toBe(afterCrash.threadId);
  const controller = new AbortController();
  const canceled = runner.run({ hang: true }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await expect(canceled).rejects.toMatchObject({ code: 'COSSACK_MCP_CANCELED' });
  expect(await runner.run({})).toMatchObject({ ok: true, calls: 1 });
  expect(runner.workerCount).toBe(1);
  expect(runner.activeCount).toBe(0);
});

it('runs concurrent calls on separate workers and pools them afterwards', async () => {
  const { runner } = await setup();
  const results = await Promise.all(Array.from({ length: 3 }, () => runner.run({})));
  expect(new Set(results.map(result => result.threadId)).size).toBe(3);
  expect(runner.workerCount).toBe(3);
  const again = await runner.run({});
  expect(results.map(result => result.threadId)).toContain(again.threadId);
  expect(again.calls).toBe(2);
});

it('terminates idle workers on close and after the idle timeout', async () => {
  const { runner } = await setup({ idleTimeout: 50 });
  await runner.run({});
  expect(runner.workerCount).toBe(1);
  await expect.poll(() => runner.workerCount, { timeout: 2_000 }).toBe(0);
  await runner.run({});
  expect(runner.workerCount).toBe(1);
  runner.idleTimeout = 60_000;
  await runner.run({});
  await runner.close();
  expect(runner.workerCount).toBe(0);
  await expect(runner.run({})).rejects.toMatchObject({ code: 'COSSACK_MCP_CLOSED' });
});
