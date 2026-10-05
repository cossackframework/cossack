import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { createApp, addFeature, readManifest, resolveRecipe, recipeCapabilityRequirements } from '../src/index.js';

const temporary = [];
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-service-recipes-')); temporary.push(root); return root; }
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function read(root, file) { return fs.readFile(path.join(root, file), 'utf8'); }
async function ownedSnapshot(root) {
  const manifest = await readManifest(root);
  return Object.fromEntries(await Promise.all(Object.keys(manifest.files).sort().map(async file => [file, await read(root, file)])));
}
async function moduleFrom(source, modules) {
  const output = await transform(source, { loader: 'ts', format: 'cjs', tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } });
  const module = { exports: {} };
  vm.runInNewContext(output.code, { module, exports: module.exports, require(name) {
    if (!Object.hasOwn(modules, name)) throw Error(`Unexpected generated dependency ${name}`);
    return modules[name];
  } });
  return module.exports;
}

it.each(['jobs', 'turnstile'])('%s converges for create versus add and repeated add without taking user ownership', async feature => {
  const direct = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', features: feature, interactive: false });
  const composed = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', interactive: false });
  await addFeature(composed.projectDir, feature, { interactive: false });
  expect(await ownedSnapshot(composed.projectDir)).toEqual(await ownedSnapshot(direct.projectDir));
  const before = await ownedSnapshot(composed.projectDir);
  await addFeature(composed.projectDir, feature, { interactive: false });
  expect(await ownedSnapshot(composed.projectDir)).toEqual(before);
  const file = feature === 'jobs' ? 'src/jobs/index.ts' : 'src/pages/contact/index.ts';
  const authored = `${await read(composed.projectDir, file)}\n// application-owned customization\n`;
  await fs.writeFile(path.join(composed.projectDir, file), authored);
  await addFeature(composed.projectDir, feature, { interactive: false });
  expect(await read(composed.projectDir, file)).toBe(authored);
});

it('renders Cloudflare queue bindings, independent D1 job state, migration and parseable consumer', async () => {
  const result = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', features: 'jobs', interactive: false });
  const root = result.projectDir;
  const config = JSON.parse((await read(root, 'wrangler.jsonc')).replace(/^\s*\/\/.*$/gm, ''));
  expect(config.queues.producers).toEqual([{ binding: 'JOBS', queue: 'service-jobs' }]);
  expect(config.queues.consumers).toContainEqual(expect.objectContaining({ queue: 'service-jobs', max_batch_size: 10 }));
  expect(config.d1_databases).toEqual([expect.objectContaining({ binding: 'JOB_STATE', migrations_dir: 'src/jobs/migrations' })]);
  expect(config.d1_databases[0]).not.toHaveProperty('database_id');
  const recipe = resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features: 'jobs' });
  expect(recipe.resolvedFeatures).not.toContain('database');
  expect(JSON.stringify(recipeCapabilityRequirements(recipe))).toContain('JOB_STATE');
  const manifest = await readManifest(root);
  for (const file of ['src/jobs/index.ts', 'src/config/jobs.ts', 'src/jobs/migrations/0001_job_state.sql']) expect(manifest.files[file].capability).toBe('jobs');
  for (const file of ['src/index.ts', 'src/jobs/index.ts']) await expect(transform(await read(root, file), { loader: 'ts' })).resolves.toBeDefined();
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(await read(root, 'src/jobs/migrations/0001_job_state.sql'));
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name)).toEqual(['cossack_job_receipts', 'cossack_jobs']);
    expect(database.prepare('PRAGMA table_info(cossack_jobs)').all().find(row => row.name === 'key').pk).toBe(1);
  } finally { database.close(); }
  const configModule = await moduleFrom(await read(root, 'src/config/jobs.ts'), {});
  expect(configModule.requirements.bindings).toMatchObject({ JOBS: { required: true, kind: 'object', runtimes: ['cloudflare'] }, JOB_STATE: { required: true, kind: 'd1', runtimes: ['cloudflare'] } });
  const worker = await read(root, 'src/index.ts');
  const batch = { messages: [] }; const env = { JOBS: {}, JOB_STATE: {} }; const deliveries = [];
  const entry = await moduleFrom(worker, {
    '@cossackframework/framework/router': { createApp: () => ({ fetch: () => new Response('OK') }) },
    '@cossackframework/framework/DurableObject': { AppDurableObject: class {} },
    '@cossackframework/framework/SseDurableObject': { SseDurableObject: class {} },
    './App': { App: class {} }, './root': { template: '' },
    './jobs': { createJobs(receivedEnv) { expect(receivedEnv).toBe(env); return { async queue(receivedBatch) { deliveries.push(receivedBatch); } }; } },
  });
  await entry.default.queue(batch, env); expect(deliveries).toEqual([batch]);
  expect(entry.default.fetch).toBeTypeOf('function');
});

it('rejects Node jobs before creating or changing files', async () => {
  const cwd = await directory();
  await expect(createApp('unsupported', { cwd, adapter: 'node', preset: 'minimal', features: 'jobs', interactive: false })).rejects.toThrow(/jobs.*cloudflare|cloudflare.*jobs/i);
  expect(await fs.readdir(cwd)).toEqual([]);
  const app = await createApp('service', { cwd, adapter: 'node', preset: 'minimal', interactive: false });
  const before = await ownedSnapshot(app.projectDir);
  await expect(addFeature(app.projectDir, 'jobs', { interactive: false })).rejects.toThrow(/jobs.*cloudflare|cloudflare.*jobs/i);
  expect(await ownedSnapshot(app.projectDir)).toEqual(before);
});

it('renders private Turnstile config, public hydration, and protected mutation without full auth or ORM', async () => {
  const result = await createApp('service', { cwd: await directory(), adapter: 'cloudflare', preset: 'minimal', features: 'turnstile', interactive: false });
  const root = result.projectDir;
  const packageJson = JSON.parse(await read(root, 'package.json'));
  expect(packageJson.dependencies).toHaveProperty('@cossackframework/ui');
  expect(packageJson.dependencies).toHaveProperty('@cossackframework/auth');
  expect(packageJson.dependencies).not.toHaveProperty('@cossackframework/database');
  const manifest = await readManifest(root);
  expect(manifest.resolvedFeatures).not.toContain('auth');
  const config = JSON.parse((await read(root, 'wrangler.jsonc')).replace(/^\s*\/\/.*$/gm, ''));
  expect(config.vars).toHaveProperty('TURNSTILE_SITE_KEY');
  expect(config.vars).toHaveProperty('TURNSTILE_HOSTNAME');
  expect(config.vars).not.toHaveProperty('TURNSTILE_SECRET_KEY');
  expect(config.secrets.required).toContain('TURNSTILE_SECRET_KEY');
  expect(await read(root, '.dev.vars.example')).toContain('TURNSTILE_SECRET_KEY=');
  const configModule = await moduleFrom(await read(root, 'src/config/turnstile.ts'), {});
  expect(configModule.requirements.variables).toMatchObject({ TURNSTILE_SITE_KEY: { required: true }, TURNSTILE_HOSTNAME: { required: true }, TURNSTILE_SECRET_KEY: { required: true, secret: true } });
  expect(configModule.default({ env: name => ({ TURNSTILE_SITE_KEY: 'public-key', TURNSTILE_SECRET_KEY: 'PRIVATE_SECRET', TURNSTILE_HOSTNAME: 'forms.test' })[name] })).toEqual({ siteKey: 'public-key', secret: 'PRIVATE_SECRET', hostname: 'forms.test' });
  const requestedConfig = [];
  let verification = { success: false }; let verificationCalls = 0;
  const decorator = () => () => {};
  const core = { Cossack: class {}, Page: decorator, Client: decorator, ClientState: decorator, State: decorator, Server: decorator,
    ActionValidationError: class extends Error {}, createFormController: () => ({ setFieldValue() {}, fieldError() {}, subscribe() { return () => {}; } }),
    createFormBindings: () => ({ dispose() {}, field() { return {}; }, form() { return {}; } }) };
  const pageModule = await moduleFrom(await read(root, 'src/pages/contact/index.ts'), {
    '@cossackframework/core': core, '@cossackframework/renderer': { html: () => '', component: () => '' }, '@cossackframework/ui': { Turnstile: class {} },
    '@cossackframework/auth/turnstile': { createTurnstileVerifier(settings) {
      expect(settings).toEqual({ secret: 'PRIVATE_SECRET', expectedHostname: 'forms.test', expectedAction: 'contact' });
      return { async verify(input) { verificationCalls++; expect(input).toEqual({ token: 'provided-token' }); return verification; } };
    } },
    '@cossackframework/framework/config': { config(name) { requestedConfig.push(name); return { 'turnstile.siteKey': 'public-key', 'turnstile.secret': 'PRIVATE_SECRET', 'turnstile.hostname': 'forms.test' }[name]; } },
    '../../turnstile-input': { contactInput: {} },
  });
  const page = new pageModule.default();
  await page.init(); expect(page.siteKey).toBe('public-key');
  requestedConfig.length = 0; page.render(); expect(requestedConfig).toEqual([]);
  await expect(page.send({ message: 'valid message', token: 'provided-token', success: true })).rejects.toBeInstanceOf(core.ActionValidationError);
  verification = { success: true };
  expect(await page.send({ message: 'valid message', token: 'provided-token' })).toEqual({ accepted: true });
  expect(verificationCalls).toBe(2);
  const source = await read(root, 'src/pages/contact/index.ts');
  expect(source).not.toContain('your-secret-key'); expect(source).not.toContain('PRIVATE_SECRET');
});
