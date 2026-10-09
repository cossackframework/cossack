import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { parseSync } from 'vite';
import { createApp } from '@cossackframework/scaffold';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { createTestHarness } from 'wrangler';
const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../../../', import.meta.url));
async function writeAcceptance(root) {
  const definitions = JSON.parse(await fs.readFile(path.join(root, 'src/schedules.json'), 'utf8'));
  definitions[0].payload.value = 'PRIVATE_SCHEDULE_PAYLOAD';
  await fs.writeFile(path.join(root, 'src/schedules.json'), JSON.stringify(definitions, null, 2) + '\n');
  const jobs = path.join(root, 'src/jobs/index.ts'); const original = await fs.readFile(jobs, 'utf8');
  await fs.writeFile(jobs, original.replace('async handle(payload, context) {', `async handle(payload, context) {
        context.onCleanup(async()=>{await env.JOB_STATE.prepare('INSERT OR IGNORE INTO cossack_schedule_cleanup (key) VALUES (?)').bind(context.key).run();});`));
  await fs.appendFile(path.join(root, 'src/jobs/migrations/0001_job_state.sql'), '\nCREATE TABLE cossack_schedule_cleanup (key TEXT PRIMARY KEY);\n');
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/api/schedules-test.ts'), `import {createSchedules} from '../../schedules/index';
import {createJobs} from '../../jobs';import {createScheduleRuntime,validateScheduleDefinitions} from '@cossackframework/core/schedules';
export const POST=async(c:any)=>{const data=await c.req.json();
try {const runtime=data.invalid?createScheduleRuntime({schedules:validateScheduleDefinitions([{name:'invalid',cron:'0 * * * *',job:'record',payload:{value:''},scope:{tenantId:'system',actorId:'scheduler'}}]),dispatcher:createJobs(c.env)}):createSchedules(c.env);
return c.json({id:await runtime.runOnce(data.invalid?'invalid':'hourly-record',{scheduledTime:data.time})});}
catch{return c.json({code:'SCHEDULE_DISPATCH_REJECTED'},422);}};
export const GET=async(c:any)=>c.json({schedules:createSchedules(c.env).list(),jobs:await createJobs(c.env).inspect()});`);
  await fs.writeFile(path.join(root, 'schedules-types.ts'), `import {createScheduleRuntime,validateScheduleDefinitions} from '@cossackframework/core/schedules';
import {createJobRuntime,defineJob,LocalJobAdapter,MemoryJobStore} from '@cossackframework/core/jobs';import {input} from '@cossackframework/core/input';
const dispatcher=createJobRuntime({namespace:'staging',adapter:new LocalJobAdapter(),store:new MemoryJobStore(),jobs:{record:defineJob({schema:input.object({value:input.string()}),handle(){}})}});
const literal={name:'hourly',cron:'0 * * * *',job:'record',payload:{value:'ok'},scope:{}} as const;
const runtime=createScheduleRuntime({schedules:[literal],dispatcher});void runtime.runOnce('hourly',{scheduledTime:0});
const json:unknown=JSON.parse('[]');void createScheduleRuntime({schedules:validateScheduleDefinitions(json),dispatcher});
// @ts-expect-error Authored unknown jobs remain rejected.
createScheduleRuntime({schedules:[{...literal,job:'missing'}],dispatcher});
// @ts-expect-error Occurrences require epoch milliseconds.
runtime.runOnce('hourly',{scheduledTime:new Date()});
`);
}
async function project() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-schedules-release-'));
  let root;
  const installed = process.env.COSSACK_SCHEDULES_INSTALLED_ROOT;
  if (installed) {
    ({ projectDir: root } = await createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', features: ['schedules'], interactive: false }));
    const gate = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
    const overrides = Object.fromEntries(Object.entries({ ...gate.dependencies, ...gate.devDependencies }).filter(([name, value]) => (name.startsWith('@cossackframework/') || name === 'cossack') && typeof value === 'string' && value.startsWith('file:')));
    const file = path.join(root, 'package.json'); const manifest = JSON.parse(await fs.readFile(file, 'utf8')); manifest.pnpm = { ...manifest.pnpm, overrides };
    await fs.writeFile(file, JSON.stringify(manifest, null, 2)); await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n' + Object.entries(overrides).map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n') + '\n');
    await execute('pnpm', ['install', '--ignore-scripts', '--config.strict-dep-builds=false'], { cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    for (const name of ['core', 'framework']) expect((await fs.realpath(path.join(root, 'node_modules/@cossackframework', name))).startsWith(root + path.sep)).toBe(true);
  } else root = await scaffoldLinkedApp(parent, { adapter: 'cloudflare', features: ['schedules'], packages: ['core', 'renderer', 'framework'] });
  await writeAcceptance(root); return { root, parent };
}
function tool(root, name, file) { const require = createRequire(path.join(root, 'package.json')); return path.join(path.dirname(require.resolve(name + '/package.json')), file); }
function cli(root) { return process.env.COSSACK_SCHEDULES_INSTALLED_ROOT ? tool(root, 'cossack', 'bin/cossack.js') : path.join(repository, 'packages/cossack/bin/cossack.js'); }
async function authoredSnapshot(root) {
  const result = {}; const visit = async relative => { for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.isDirectory() && ['node_modules', 'dist', '.wrangler', '.git'].includes(entry.name)) continue;
    const name = path.join(relative, entry.name); if (entry.isDirectory()) await visit(name); else if (entry.isFile()) result[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
  } }; await visit(''); return result;
}
async function build(root) { return execute(process.execPath, [tool(root, 'vite', 'bin/vite.js'), 'build'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', VITEST: '', WRANGLER_SEND_METRICS: 'false' }, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }); }
it('writes parseable generated schedule registry, job cleanup, test API and public type fixture', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-schedules-source-'));
  try { const { projectDir: root } = await createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', features: ['schedules'], interactive: false }); await writeAcceptance(root);
    for (const file of ['src/index.ts', 'src/jobs/index.ts', 'src/schedules/index.ts', 'src/pages/api/schedules-test.ts', 'schedules-types.ts']) expect(parseSync(file, await fs.readFile(path.join(root, file), 'utf8'), { lang: 'ts' }).errors, file).toEqual([]);
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
it('runs actual generated Cron -> Queue -> D1 with duplicate/local occurrence identity, cleanup and static rejection', async () => {
  const { root, parent } = await project(); let server;
  try {
    await execute(process.execPath, [tool(root, 'typescript', 'bin/tsc'), '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ESNext', 'schedules-types.ts'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
    await build(root);
    server = createTestHarness({ root, workers: [{ configPath: path.join(root, 'dist/ssr/wrangler.json') }] }); await server.listen(); const worker = server.getWorker(); const env = await worker.getEnv(); await worker.applyD1Migrations('JOB_STATE');
    const count = async table => Number((await env.JOB_STATE.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count);
    const time = Date.UTC(2026, 9, 5, 9); const cron = '0 * * * *';
    expect((await worker.scheduled({ cron, scheduledTime: new Date(time) })).outcome).toBe('ok');
    await expect.poll(() => count('cossack_job_receipts'), { timeout: 30000 }).toBe(1);
    await expect.poll(() => count('cossack_schedule_cleanup'), { timeout: 30000 }).toBe(1);
    await worker.scheduled({ cron, scheduledTime: new Date(time) });
    const local = await worker.fetch('http://localhost/api/schedules-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ time }) }); expect(local.status).toBe(200);
    await Promise.all([worker.scheduled({ cron, scheduledTime: new Date(time + 3600000) }), worker.scheduled({ cron, scheduledTime: new Date(time + 7200000) })]);
    await expect.poll(() => count('cossack_job_receipts'), { timeout: 30000 }).toBe(3); await expect.poll(() => count('cossack_schedule_cleanup'), { timeout: 30000 }).toBe(3);
    await expect.poll(async () => (await env.JOB_STATE.prepare("SELECT COUNT(*) AS count FROM cossack_jobs WHERE status='completed'").first()).count, { timeout: 30000 }).toBe(3);
    const rows = await env.JOB_STATE.prepare('SELECT tenant,actor,value FROM cossack_job_receipts').all(); expect(rows.results.every(row => row.tenant === 'system' && row.actor === 'scheduler' && row.value === 'PRIVATE_SCHEDULE_PAYLOAD')).toBe(true);
    const invalid = await worker.fetch('http://localhost/api/schedules-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invalid: true, time }) }); expect(invalid.status).toBe(422); expect(await count('cossack_jobs')).toBe(3);
    const state = await (await worker.fetch('http://localhost/api/schedules-test')).json(); expect(JSON.stringify(state)).not.toContain('PRIVATE_SCHEDULE_PAYLOAD'); expect(state.jobs.every(job => job.attempt === 1)).toBe(true);
    await server.close(); server = undefined;
    const declarationFile = path.join(root, 'src/schedules.json'); const validSource = await fs.readFile(declarationFile, 'utf8');
    const validBefore = await authoredSnapshot(root);
    const inspected = await execute(process.execPath, [cli(root), 'inspect', 'schedules', '--json'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 });
    expect(JSON.parse(inspected.stdout).data.readiness.declarations).toBe('valid'); expect(inspected.stdout).not.toContain('PRIVATE_SCHEDULE_PAYLOAD'); expect(await authoredSnapshot(root)).toEqual(validBefore);
    const definitions = JSON.parse(validSource); definitions[0].cron = 'PRIVATE_INVALID_CRON'; await fs.writeFile(declarationFile, JSON.stringify(definitions)); const invalidSource = await fs.readFile(declarationFile, 'utf8');
    const invalidBefore = await authoredSnapshot(root);
    const checked = await execute(process.execPath, [cli(root), 'check', 'schedules', '--json'], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024 }).then(result => ({ ...result, exitCode: 0 }), error => ({ stdout: error.stdout, stderr: error.stderr, exitCode: error.code }));
    expect(checked.exitCode).not.toBe(0); expect(JSON.parse(checked.stdout).ok).toBe(false); expect(checked.stdout + checked.stderr).not.toContain('PRIVATE_'); expect(await authoredSnapshot(root)).toEqual(invalidBefore); expect(await fs.readFile(declarationFile, 'utf8')).toBe(invalidSource);
    const failed = await build(root).then(() => undefined, error => error); expect(failed).toBeDefined(); expect(String(failed.stdout) + String(failed.stderr)).toContain('Schedule declarations are invalid'); expect(String(failed.stdout) + String(failed.stderr)).not.toContain('PRIVATE_');
  } finally { await server?.close(); await fs.rm(parent, { recursive: true, force: true }); }
}, 240000);
