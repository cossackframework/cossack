import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { transform } from 'esbuild';
import vm from 'node:vm';
import { createApp, addFeature, readManifest, resolveRecipe, recipeCapabilityRequirements } from '../src/index.js';

const roots = [];
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-application-services-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function read(root, file) { return fs.readFile(path.join(root, file), 'utf8'); }
async function snapshot(root) { const manifest = await readManifest(root); return Object.fromEntries(await Promise.all(Object.keys(manifest.files).sort().map(async file => [file, await read(root, file)]))); }
async function moduleFrom(source, modules = {}) {
  const output = await transform(source, { loader: 'ts', format: 'cjs' }); const module = { exports: {} };
  vm.runInNewContext(output.code, { module, exports: module.exports, require(name) { if (!Object.hasOwn(modules, name)) throw Error(`Unexpected generated dependency ${name}`); return modules[name]; } }); return module.exports;
}

it('schedules create/add converge, repeated add is stable, and authored definitions retain ownership', async () => {
  const direct = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', features: 'schedules', interactive: false });
  const composed = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', interactive: false });
  await addFeature(composed.projectDir, 'schedules', { interactive: false });
  expect(await snapshot(composed.projectDir)).toEqual(await snapshot(direct.projectDir));
  const before = await snapshot(composed.projectDir); await addFeature(composed.projectDir, 'schedules', { interactive: false }); expect(await snapshot(composed.projectDir)).toEqual(before);
  const file = path.join(composed.projectDir, 'src/schedules.json'); const authored = [{ name: 'application-owned', cron: '0 * * * *', job: 'record', payload: { value: 'authored' }, scope: { tenantId: 'owner' } }];
  await fs.writeFile(file, JSON.stringify(authored, null, 2) + '\n');
  await addFeature(composed.projectDir, 'schedules', { interactive: false }); expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(authored);
});
it('schedules compose jobs and render validated registry, provider entry, Cron configuration, and build preflight', async () => {
  const { projectDir: root } = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', features: 'schedules', interactive: false });
  const recipe = resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: 'schedules' }); expect(recipe.resolvedFeatures).toContain('jobs');
  expect(JSON.stringify(recipeCapabilityRequirements(recipe))).toContain('schedules/cloudflare-cron');
  const manifest = await readManifest(root); expect(manifest.files['src/schedules.json'].capability).toBe('schedules'); expect(manifest.files['src/schedules/index.ts'].capability).toBe('schedules');
  const definitions = JSON.parse(await read(root, 'src/schedules.json')); const config = JSON.parse((await read(root, 'wrangler.jsonc')).replace(/^\s*\/\/.*$/gm, ''));
  expect(config.triggers.crons).toEqual([...new Set(definitions.map(item => item.cron))]); expect(config.queues.producers[0].binding).toBe('JOBS'); expect(config.d1_databases[0].binding).toBe('JOB_STATE');
  expect(await read(root, 'src/schedules/index.ts')).toContain('validateScheduleDefinitions(definitions)');
  expect(await read(root, 'src/index.ts')).toContain('await createSchedules(env).scheduled(controller)');
  expect(await read(root, 'src/index.ts')).toContain("from './schedules/index'");
  expect(await read(root, 'src/index.ts')).toContain('await createJobs(env).queue(batch)');
  expect(await read(root, 'vite.config.ts')).toContain('cossackSchedules()');
  for (const file of ['src/index.ts', 'src/schedules/index.ts', 'vite.config.ts']) await expect(transform(await read(root, file), { loader: 'ts' })).resolves.toBeDefined();
});
it.each(['node'])('schedules require an explicit supported scheduler before any %s project writes', async adapter => {
  const cwd = await directory(); await expect(createApp('service', { cwd, adapter, preset: 'minimal', features: 'schedules', interactive: false })).rejects.toThrow(/cloudflare|scheduler|adapter/i); expect(await fs.readdir(cwd)).toEqual([]);
  const { projectDir: root } = await createApp('service', { cwd, adapter, preset: 'minimal', interactive: false }); const before = await snapshot(root);
  await expect(addFeature(root, 'schedules', { interactive: false })).rejects.toThrow(/cloudflare|scheduler|adapter/i); expect(await snapshot(root)).toEqual(before);
});
it('notifications create/add converge, repeated add is stable, and application-owned templates survive', async () => {
  const direct = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', features: 'notifications', interactive: false });
  const composed = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', interactive: false });
  await addFeature(composed.projectDir, 'notifications', { interactive: false }); expect(await snapshot(composed.projectDir)).toEqual(await snapshot(direct.projectDir));
  const before = await snapshot(composed.projectDir); await addFeature(composed.projectDir, 'notifications', { interactive: false }); expect(await snapshot(composed.projectDir)).toEqual(before);
  const file = path.join(composed.projectDir, 'src/notifications/index.ts'); const authored = await fs.readFile(file, 'utf8') + '\n// application-owned notification template\n'; await fs.writeFile(file, authored);
  await addFeature(composed.projectDir, 'notifications', { interactive: false }); expect(await fs.readFile(file, 'utf8')).toBe(authored);
});
it('notifications render the actual ledger schema, EMAIL binding, explicit scoped opt-in and delivery job', async () => {
  const { projectDir: root } = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', features: 'notifications', interactive: false });
  const config = JSON.parse((await read(root, 'wrangler.jsonc')).replace(/^\s*\/\/.*$/gm, '')); expect(config.send_email).toEqual([{ name: 'EMAIL' }]); expect(config.vars.MAIL_FROM).toBe('no-reply@example.com');
  const recipe = resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: 'notifications' }); expect(recipe.resolvedFeatures).toContain('jobs');
  const manifest = await readManifest(root); expect(manifest.files['src/jobs/migrations/0002_notifications.sql'].capability).toBe('notifications');
  for (const file of ['src/index.ts', 'src/jobs/index.ts', 'src/notifications/index.ts', 'src/config/notifications.ts']) await expect(transform(await read(root, file), { loader: 'ts' })).resolves.toBeDefined();
  expect(await read(root, 'src/jobs/index.ts')).toContain("createNotifications(env).deliver(payload.id)");
  const { DatabaseSync } = await import('node:sqlite'); const actual = new DatabaseSync(':memory:'); const generated = new DatabaseSync(':memory:');
  try {
    const source = await fs.readFile(new URL('../../core/src/notifications/sql-store.ts', import.meta.url), 'utf8'); const { notificationStateSchema } = await moduleFrom(source);
    actual.exec(notificationStateSchema); generated.exec(await read(root, 'src/jobs/migrations/0002_notifications.sql'));
    for (const pragma of ['table_info(cossack_notifications)', 'index_list(cossack_notifications)', 'index_info(cossack_notifications_inbox)']) expect(generated.prepare(`PRAGMA ${pragma}`).all()).toEqual(actual.prepare(`PRAGMA ${pragma}`).all());
    expect(generated.prepare("SELECT sql FROM sqlite_master WHERE name='cossack_notifications'").get().sql.replace(/\s/g, '')).toBe(actual.prepare("SELECT sql FROM sqlite_master WHERE name='cossack_notifications'").get().sql.replace(/\s/g, ''));
    const jobs = []; const env = { MAIL_FROM: 'no-reply@example.com', EMAIL: {}, JOB_STATE: { prepare(sql) { return { bind(...values) { return { async first() { return generated.prepare(sql).get(...values); } }; } }; } } };
    const module = await moduleFrom(await read(root, 'src/notifications/index.ts'), {
      '@cossackframework/core/input': { input: { object: value => value, string: value => value } },
      '@cossackframework/core/notifications': { createNotificationRuntime: options => options, defineNotificationTemplate: value => value, notificationHtml() {} },
      '@cossackframework/framework/notifications': { createD1NotificationStore: database => database, createCloudflareNotificationEmailProvider: binding => binding },
      '../jobs': { createJobs: () => ({ async dispatch(...args) { jobs.push(args); } }) },
    });
    const options = module.createNotifications(env); expect(options.email).toEqual({ provider: env.EMAIL, from: env.MAIL_FROM });
    const request = { recipient: { tenantId: 'tenant', userId: 'user' }, template: 'notice', channel: 'email' };
    expect(await options.preferences(request)).toBe(false);
    generated.prepare('INSERT INTO cossack_notification_preferences VALUES (?,?,?,?,?)').run('tenant', 'user', 'notice', 'email', 1);
    expect(await options.preferences(request)).toBe(true);
    for (const other of [{ ...request, recipient: { tenantId: 'other', userId: 'user' } }, { ...request, recipient: { tenantId: 'tenant', userId: 'other' } }, { ...request, channel: 'in-app' }]) expect(await options.preferences(other)).toBe(false);
    generated.prepare('UPDATE cossack_notification_preferences SET enabled=0').run(); expect(await options.preferences(request)).toBe(false);
    await options.dispatch('notification-id', request.recipient); expect(jobs).toEqual([['deliverNotification', { id: 'notification-id' }, { scope: { tenantId: 'tenant', actorId: 'user' }, idempotencyKey: 'notification-id' }]]);
  } finally { actual.close(); generated.close(); }
});
it('notifications reject unsupported Node composition before writing application files', async () => {
  const cwd = await directory(); await expect(createApp('service', { cwd, adapter: 'node', preset: 'minimal', features: 'notifications', interactive: false })).rejects.toThrow(/cloudflare|adapter/i); expect(await fs.readdir(cwd)).toEqual([]);
  const { projectDir: root } = await createApp('service', { cwd, adapter: 'node', preset: 'minimal', interactive: false }); const before = await snapshot(root);
  await expect(addFeature(root, 'notifications', { interactive: false })).rejects.toThrow(/cloudflare|adapter/i); expect(await snapshot(root)).toEqual(before);
});
