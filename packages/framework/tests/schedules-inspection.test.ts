import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { inspectSchedules } from '../src/schedules-inspection';
import { cossackSchedules } from '../src/vite-schedules';
import { inspectConfigurationRequirements } from '../src/config-preflight';
const roots: string[] = [];
const definition = { name: 'hourly', cron: '0 * * * *', job: 'record', payload: { value: 'PRIVATE_PAYLOAD' }, scope: { actorId: 'PRIVATE_ACTOR' } };
async function fixture(runtime = 'cloudflare', schedules: unknown = [definition]) {
    const root = await mkdtemp(join(tmpdir(), 'cossack-schedules-inspection-')); roots.push(root);
    await mkdir(join(root, 'src/config'), { recursive: true }); await mkdir(join(root, 'node_modules'));
    await symlink(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), join(root, 'node_modules/wrangler'), 'junction');
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', cossack: { runtime } }));
    await writeFile(join(root, 'src/schedules.json'), JSON.stringify(schedules));
    await writeFile(join(root, 'src/throwing.ts'), "throw Error('Application code must not execute');");
    await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'schedules-test', main: 'src/throwing.ts', compatibility_date: '2026-10-05', triggers: { crons: ['0 * * * *'] }, env: { staging: { triggers: { crons: ['30 * * * *'] } } } }));
    return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it('lists redacted static schedules without executing code or changing declarations', async () => {
    const root = await fixture(); const before = await readFile(join(root, 'src/schedules.json'), 'utf8');
    const report = await inspectSchedules(root);
    expect(report.diagnostics).toEqual([]); expect(report.schedules).toEqual([{ name: 'hourly', cron: '0 * * * *', job: 'record' }]);
    expect(report.readiness.handler).toBe('not-checked'); expect(JSON.stringify(report)).not.toContain('PRIVATE_');
    expect(await readFile(join(root, 'src/schedules.json'), 'utf8')).toBe(before);
});
it('rejects invalid schedule metadata during inspection and the actual build plugin hook', async () => {
    const root = await fixture('cloudflare', [{ ...definition, cron: 'PRIVATE_BAD_CRON' }]);
    expect((await inspectSchedules(root)).diagnostics[0]?.code).toBe('COSSACK_SCHEDULES_INVALID');
    const plugin = cossackSchedules();
    await expect((plugin.configResolved as Function)({ root })).rejects.toMatchObject({ code: 'COSSACK_SCHEDULES_INVALID' });
});
it('compares the selected environment rather than inheriting default Cron triggers', async () => {
    const root = await fixture();
    expect((await inspectSchedules(root, 'staging')).diagnostics[0]?.code).toBe('COSSACK_SCHEDULE_TRIGGERS_MISMATCH');
    await writeFile(join(root, 'src/schedules.json'), JSON.stringify([{ ...definition, cron: '30 * * * *' }]));
    expect((await inspectSchedules(root, 'staging')).diagnostics).toEqual([]);
});
it('requires an explicit scheduler adapter on other runtimes', async () => {
    expect((await inspectSchedules(await fixture('node'))).diagnostics[0]?.code).toBe('COSSACK_SCHEDULER_ADAPTER_REQUIRED');
});
it('permits projects without schedule metadata and rejects oversized or malformed files', async () => {
    const root = await fixture(); await rm(join(root, 'src/schedules.json'));
    expect((await inspectSchedules(root)).schedules).toEqual([]);
    await writeFile(join(root, 'src/schedules.json'), 'PRIVATE_MALFORMED');
    expect(JSON.stringify(await inspectSchedules(root))).not.toContain('PRIVATE_');
    await writeFile(join(root, 'src/schedules.json'), ' '.repeat(128 * 1024 + 1));
    expect((await inspectSchedules(root)).diagnostics[0]?.code).toBe('COSSACK_SCHEDULES_INVALID');
});
it('recognizes actual send_email name fields for declared EMAIL requirements', async () => {
    const root = await fixture();
    await writeFile(join(root, 'src/config/email.ts'), "export const requirements={bindings:{EMAIL:{kind:'object',required:true,runtimes:['cloudflare']}}};export default()=>({});");
    await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'email-test', main: 'src/throwing.ts', compatibility_date: '2026-10-05', send_email: [{ name: 'EMAIL' }] }));
    expect((await inspectConfigurationRequirements(root, { check: true })).diagnostics).toEqual([]);
});
