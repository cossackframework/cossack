import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '@cossackframework/scaffold';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { createTestHarness } from 'wrangler';
const execute = promisify(execFile);
async function project() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-jobs-release-'));
  let root;
  if (process.env.COSSACK_JOBS_INSTALLED_ROOT) {
    ({ projectDir: root } = await createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', features: ['jobs'], interactive: false }));
    const gate = JSON.parse(await fs.readFile(path.join(process.env.COSSACK_JOBS_INSTALLED_ROOT, 'package.json'), 'utf8'));
    const overrides = Object.fromEntries(Object.entries({ ...gate.dependencies, ...gate.devDependencies }).filter(([name, value]) => (name.startsWith('@cossackframework/') || name === 'cossack') && value.startsWith('file:')));
    const file = path.join(root, 'package.json'); const manifest = JSON.parse(await fs.readFile(file, 'utf8')); manifest.pnpm = { ...manifest.pnpm, overrides };
    await fs.writeFile(file, JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n' + Object.entries(overrides).map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n') + '\n');
    await execute('pnpm', ['install', '--ignore-scripts', '--config.strict-dep-builds=false'], { cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    for (const name of ['core', 'framework']) expect((await fs.realpath(path.join(root, 'node_modules/@cossackframework', name))).startsWith(root + path.sep)).toBe(true);
  } else root = await scaffoldLinkedApp(parent, { adapter: 'cloudflare', features: ['jobs'], packages: ['core', 'renderer', 'framework'] });
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/api/jobs-test.ts'), `import {createJobs} from '../../jobs';let bootId:string|undefined;
export const POST=async(c:any)=>{const data=await c.req.json();const runtime=createJobs(c.env);const id=await runtime.dispatch('record',{value:data.value},{scope:{tenantId:'test-tenant',actorId:'test-actor'},idempotencyKey:data.key,delaySeconds:data.delay??0});return c.json({id});};
export const GET=async(c:any)=>c.json({bootId:bootId??=crypto.randomUUID(),jobs:await createJobs(c.env).inspect()});`);
  await fs.writeFile(path.join(root, 'jobs-types.ts'), `import {createJobRuntime,defineJob,LocalJobAdapter,MemoryJobStore} from '@cossackframework/core/jobs';
import {input} from '@cossackframework/core/input';import {createD1JobStore,jobStateSchema} from '@cossackframework/framework/jobs';
const jobs={record:defineJob({schema:input.object({value:input.string()}),async handle(payload,context){const value:string=payload.value;const key:string=context.key;void value;void key;}})};
const runtime=createJobRuntime({jobs,namespace:'test',adapter:new LocalJobAdapter(),store:new MemoryJobStore()});
void runtime.dispatch('record',{value:'ok'},{scope:{tenantId:'tenant'}});void createD1JobStore;void jobStateSchema;
// @ts-expect-error Invalid job name.
void runtime.dispatch('missing',{value:'ok'},{scope:{}});
// @ts-expect-error Payload type is inferred.
void runtime.dispatch('record',{value:123},{scope:{}});
// @ts-expect-error Actor context cannot retain a request.
void runtime.dispatch('record',{value:'ok'},{scope:{request:new Request('https://example.com')}});
`);
  return { root, parent };
}
function tool(root, name, file) { const require = createRequire(path.join(root, 'package.json')); return path.join(path.dirname(require.resolve(name + '/package.json')), file); }
it('runs generated actual Queue consumer with D1 ledger and preserves duplicate completion through Worker restart', async () => {
  const { root, parent } = await project(); let server;
  const start = async () => { server = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] }); await server.listen(); return server.getWorker(); };
  try {
    await execute(process.execPath, [tool(root, 'typescript', 'bin/tsc'), '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ESNext', 'jobs-types.ts'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
    await execute(process.execPath, [tool(root, 'vite', 'bin/vite.js'), 'build'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', VITEST: '', WRANGLER_SEND_METRICS: 'false' }, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    let worker = await start(); let env = await worker.getEnv();
    await worker.applyD1Migrations('JOB_STATE');
    const dispatch = async (value, key, delay = 0) => { const response = await worker.fetch('http://localhost/api/jobs-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value, key, delay }) }); expect(response.status).toBe(200); return response.json(); };
    const count = async () => Number((await env.JOB_STATE.prepare('SELECT COUNT(*) AS count FROM cossack_job_receipts').first()).count);
    await dispatch('PRIVATE_JOB_PAYLOAD', 'logical-one'); await dispatch('PRIVATE_JOB_PAYLOAD', 'logical-one');
    await expect.poll(count, { timeout: 30000 }).toBe(1);
    const response = await worker.fetch('http://localhost/api/jobs-test'); const firstBoot = await response.json(); const records = firstBoot.jobs;
    await expect.poll(async () => (await env.JOB_STATE.prepare("SELECT status FROM cossack_jobs").first()).status, { timeout: 10000 }).toBe('completed');
    expect(JSON.stringify(records)).not.toContain('PRIVATE_JOB_PAYLOAD'); expect(records[0].attempt).toBe(1);
    await server.update(current => ({ ...current, workers: current.workers.map(input => ({ ...input, vars: { JOB_RELOAD_MARKER: 'second-worker' } })) }));
    worker = server.getWorker(); env = await worker.getEnv();
    const secondBoot = await (await worker.fetch('http://localhost/api/jobs-test')).json();
    expect(secondBoot.bootId).not.toBe(firstBoot.bootId);
    expect(await count()).toBe(1);
    await dispatch('PRIVATE_JOB_PAYLOAD', 'logical-one');
    await dispatch('after-restart', 'logical-two');
    await expect.poll(count, { timeout: 30000 }).toBe(2);
    expect((await env.JOB_STATE.prepare('SELECT COUNT(*) AS count FROM cossack_jobs').first()).count).toBe(2);
    await dispatch('delayed', 'logical-delay', 3);
    expect(await count()).toBe(2);
    await expect.poll(count, { timeout: 30000 }).toBe(3);
    const receipts = await env.JOB_STATE.prepare('SELECT tenant,actor FROM cossack_job_receipts').all();
    expect(receipts.results.every(row => row.tenant === 'test-tenant' && row.actor === 'test-actor')).toBe(true);
  } finally { await server?.close(); await fs.rm(parent, { recursive: true, force: true }); }
}, 240000);
