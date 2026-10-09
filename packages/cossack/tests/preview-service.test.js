import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { createPreview, inspectPreview, cleanupPreview, validatePreviewConfig } = process.env.COSSACK_PREVIEW_INSTALLED_ROOT
  ? await import(path.join(process.env.COSSACK_PREVIEW_INSTALLED_ROOT, 'node_modules/cossack/src/preview-service.js'))
  : await import('../src/preview-service.js');
import { parseFlags } from '../src/flags.js';
import { commandSpecs } from '../src/command-specs.js';

const accountId = 'a'.repeat(32);
const config = { name: 'app', previews: {}, vars: {}, durable_objects: { bindings: [{ name: 'SESSION', class_name: 'Session' }] } };
let root, artifact, calls, provider, dependencies;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-preview-lifecycle-'));
  artifact = path.join(root, 'worker.json');
  await fs.writeFile(artifact, JSON.stringify({ name: 'app', main: 'index.js' }));
  calls = [];
  provider = {
    verify: vi.fn(async () => ({ status: 'verified', accountId })),
    inspect: vi.fn(async () => ({ status: 'absent' })),
    deploy: vi.fn(async (_file, _worker, name, tag) => {
      const journal = JSON.parse(await fs.readFile(path.join(root, '.cossack/preview.json'), 'utf8'));
      expect(journal.status).toBe('intent'); expect(journal.tag).toBe(tag);
      calls.push('deploy');
      return { status: 'deployed', preview: { id: 'preview-id', name, createdOn: '2026-10-06T00:00:00Z' }, deployment: { id: 'deployment-id', tag }, url: 'https://preview.account.workers.dev' };
    }),
    inspectDeployment: vi.fn(), remove: vi.fn(async () => ({ status: 'removed' })),
  };
  dependencies = { provider, inspect: async () => ({ config }), build: vi.fn(async () => artifact), fetch: vi.fn(async () => new Response('ok')) };
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const options = () => ({ accountId, name: 'pr-42' });
async function created() {
  const value = await createPreview(root, options(), dependencies);
  provider.inspect.mockImplementation(async () => ({ status: 'present', preview: value.preview }));
  provider.inspectDeployment.mockImplementation(async () => ({ status: 'present', deployment: value.deployment }));
  return value;
}
it('plans without authentication, builds, journal writes or remote mutations', async () => {
  expect(await createPreview(root, { ...options(), dryRun: true }, dependencies)).toMatchObject({ status: 'planned', effects: { localWrites: 0, cloudWrites: 0 } });
  expect(provider.verify).not.toHaveBeenCalled(); expect(dependencies.build).not.toHaveBeenCalled();
  await expect(fs.access(path.join(root, '.cossack'))).rejects.toThrow();
});
it.each(['d1_databases', 'kv_namespaces', 'r2_buckets'])('retains explicit staging %s and rejects production reuse or missing binding', group => {
  const ref = { d1_databases: 'database_id', kv_namespaces: 'id', r2_buckets: 'bucket_name' }[group];
  const value = { ...config, [group]: [{ binding: 'DATA', [ref]: 'production' }], previews: { [group]: [{ binding: 'DATA', [ref]: 'staging' }] } };
  expect(validatePreviewConfig(value, accountId).retained).toContainEqual({ kind: group, binding: 'DATA', ownership: 'existing-staging', cleanup: 'retain' });
  expect(() => validatePreviewConfig({ ...value, previews: {} }, accountId)).toThrow();
  expect(() => validatePreviewConfig({ ...value, previews: { [group]: value[group] } }, accountId)).toThrow();
});
it.each([{ services: [{ binding: 'SERVICE', service: 'prod' }] }, { workflows: [{ binding: 'FLOW', name: 'prod' }] }, { queues: { producers: [{ binding: 'QUEUE', queue: 'prod' }] } }, { triggers: { crons: ['* * * * *'] } }, { previews: { unsafe: { bindings: [{ name: 'DATA', type: 'd1', database_id: 'prod' }] } } }])('rejects unsupported/shared capabilities before build or authentication: %j', async extra => {
  dependencies.inspect = async () => ({ config: { ...config, ...extra } });
  await expect(createPreview(root, options(), dependencies)).rejects.toThrow();
  expect(provider.verify).not.toHaveBeenCalled(); expect(provider.deploy).not.toHaveBeenCalled();
});
it('writes intent first, records receipt before smoke, suppresses bodies and deletes by immutable ID', async () => {
  const value = await created();
  expect(value.status).toBe('deployed'); expect(value.smoke.status).toBe(200);
  expect(dependencies.fetch.mock.calls[0][1].redirect).toBe('manual');
  expect((await inspectPreview(root, { accountId }, dependencies)).status).toBe('owned');
  provider.remove.mockImplementation(async () => { provider.inspect.mockResolvedValue({ status: 'absent' }); return { status: 'removed' }; });
  expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
  expect(provider.remove.mock.calls[0].slice(1)).toEqual(['app', 'preview-id']);
  expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
  expect(provider.remove).toHaveBeenCalledTimes(1);
});
it('preserves a failed smoke receipt for independently verified cleanup', async () => {
  dependencies.fetch = async () => new Response('private failed body', { status: 500 });
  await expect(createPreview(root, options(), dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_SMOKE_FAILED' });
  const journal = await fs.readFile(path.join(root, '.cossack/preview.json'), 'utf8');
  expect(JSON.parse(journal).status).toBe('smoke-failed'); expect(journal).not.toContain('private failed body');
  expect(JSON.parse(journal).deployment.id).toBe('deployment-id');
});
it('lost creation responses retain unknown state and cannot authorize deletion', async () => {
  provider.deploy.mockResolvedValue({ status: 'unknown' });
  await expect(createPreview(root, options(), dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_CREATE_UNKNOWN' });
  provider.inspect.mockResolvedValue({ status: 'present', preview: { id: 'other', name: 'arbitrary' } });
  await expect(cleanupPreview(root, { accountId }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_OWNERSHIP_UNPROVEN' });
  expect(provider.remove).not.toHaveBeenCalled();
});
it.each(['identity', 'tag', 'account'])('refuses deletion when provider/state %s differs', async kind => {
  const value = await created();
  if (kind === 'identity') provider.inspect.mockResolvedValue({ status: 'present', preview: { ...value.preview, id: 'replacement' } });
  if (kind === 'tag') provider.inspectDeployment.mockResolvedValue({ status: 'present', deployment: { ...value.deployment, tag: 'unowned' } });
  await expect(cleanupPreview(root, { accountId: kind === 'account' ? 'b'.repeat(32) : accountId }, dependencies)).rejects.toThrow();
  expect(provider.remove).not.toHaveBeenCalled();
});
it('recovers a lost deletion response only after real provider absence', async () => {
  await created();
  provider.remove.mockImplementation(async () => { provider.inspect.mockResolvedValue({ status: 'absent' }); return { status: 'unknown' }; });
  expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
});
it('retains a retryable receipt when deletion remains present', async () => {
  await created();
  await expect(cleanupPreview(root, { accountId }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_DELETE_NOT_CONFIRMED' });
  provider.remove.mockImplementation(async () => { provider.inspect.mockResolvedValue({ status: 'absent' }); return { status: 'removed' }; });
  expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
});
it('rejects build substitution, path traversal, symlinks, reused journals and cross-origin smoke paths', async () => {
  for (const extra of [{ state: '../outside.json' }, { smokePath: '//evil.example/' }]) await expect(createPreview(root, { ...options(), ...extra }, dependencies)).rejects.toThrow();
  await fs.mkdir(path.join(root, '.cossack')); await fs.symlink(root, path.join(root, '.cossack/link'));
  await expect(createPreview(root, { ...options(), state: '.cossack/link/preview.json' }, dependencies)).rejects.toThrow();
  await fs.writeFile(artifact, JSON.stringify({ name: 'another-worker' }));
  await expect(createPreview(root, options(), dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_ARTIFACT_MISMATCH' });
  expect(provider.deploy).not.toHaveBeenCalled();
  await fs.writeFile(artifact, JSON.stringify({ name: 'app' })); await created();
  await expect(createPreview(root, options(), dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_STATE_EXISTS' });
});
it('routes public source CLI help and rejects unsupported mutation flags', () => {
  const cli = path.resolve('bin/cossack.js');
  const value = JSON.parse(execFileSync(process.execPath, [cli, 'preview', '--help', '--json'], { encoding: 'utf8' }));
  expect(value.command).toBe('preview'); expect(value.ok).toBe(true); expect(value.data.help).toContain('ignore-defaults');
  expect(parseFlags(['create', '--account', accountId, '--name', 'pr-42', '--dry-run'], commandSpecs.preview).flags['dry-run']).toBe(true);
  expect(() => parseFlags(['cleanup', '--dry-run'], commandSpecs.preview)).toThrow();
});
it('uses actual Wrangler configuration parsing through the public CLI for a no-write plan', async () => {
 await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'preview-app', type: 'module' }));
 await fs.symlink(path.resolve('../..', 'node_modules'), path.join(root, 'node_modules'), 'junction');
 await fs.writeFile(path.join(root, 'wrangler.json'), JSON.stringify({ name: 'preview-app', main: 'index.js', compatibility_date: '2026-10-01', previews: {} }));
 const value = JSON.parse(execFileSync(process.execPath, [path.resolve('bin/cossack.js'), 'preview', 'create', '--account', accountId, '--name', 'test', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ENV: '', CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: '' } }));
 expect(value.ok).toBe(true); expect(value.data.effects).toEqual({ localWrites: 0, cloudWrites: 0 });
 await expect(fs.access(path.join(root, '.cossack'))).rejects.toThrow();
});
it('reclaims only a terminated same-host lock for cleanup retry', async () => {
 await created();
 await fs.writeFile(path.join(root, '.cossack/preview.json.lock'), JSON.stringify({ pid: process.pid, host: os.hostname() }));
 await expect(cleanupPreview(root, { accountId }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_STATE_BUSY' });
 await fs.writeFile(path.join(root, '.cossack/preview.json.lock'), JSON.stringify({ pid: 2147483647, host: os.hostname() }));
 provider.remove.mockImplementation(async () => { provider.inspect.mockResolvedValue({ status: 'absent' }); return { status: 'removed' }; });
 expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
});
it('rejects extra fields in restored resource records before public output or deletion', async () => {
 const value = await created(); value.resources[0].privateValue = 'do not echo';
 await fs.writeFile(path.join(root, '.cossack/preview.json'), JSON.stringify(value));
 await expect(cleanupPreview(root, { accountId }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_STATE_INVALID' });
 expect(provider.remove).not.toHaveBeenCalled();
});
it('passes explicit staging secrets only in private prepared native deployment config', async () => {
 const secretsFile = path.join(root, 'secrets.json'); await fs.writeFile(secretsFile, JSON.stringify({ APP_SECRET: 'private staging value' }), { mode: 0o600 });
 dependencies.inspect = async () => ({ config: { ...config, secrets: { required: ['APP_SECRET'] } } });
 const prior = provider.deploy.getMockImplementation(); let preparedPath; const signalListeners = process.listenerCount('SIGTERM');
 provider.deploy.mockImplementation(async (filename, ...args) => {
  preparedPath = filename; expect((await fs.stat(filename)).mode & 0o777).toBe(0o600);
  // Secrets never land in the project or build output, even if the process is killed.
  expect(path.relative(root, filename).startsWith('..')).toBe(true);
  expect((await fs.stat(path.dirname(filename))).mode & 0o777).toBe(0o700);
  const prepared = JSON.parse(await fs.readFile(filename, 'utf8'));
  expect(prepared.main).toBe(path.join(root, 'index.js'));
  expect(prepared.previews.unsafe.bindings).toEqual([{ name: 'APP_SECRET', type: 'secret_text', text: 'private staging value' }]);
  return prior(filename, ...args);
 });
 const result = await createPreview(root, { ...options(), secretsFile }, dependencies);
 expect(JSON.stringify(result)).not.toContain('private staging value');
 expect(await fs.readFile(path.join(root, '.cossack/preview.json'), 'utf8')).not.toContain('private staging value');
 await expect(fs.access(preparedPath)).rejects.toThrow();
 await expect(fs.access(path.dirname(preparedPath))).rejects.toThrow();
 expect(process.listenerCount('SIGTERM')).toBe(signalListeners);
});
it('recovers a provider-tagged lost receipt read-only, then persists before immutable-ID cleanup', async () => {
 provider.deploy.mockResolvedValue({ status: 'unknown' });
 await expect(createPreview(root, options(), dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_CREATE_UNKNOWN' });
 const filename = path.join(root, '.cossack/preview.json'); const initial = await fs.readFile(filename, 'utf8'); const intent = JSON.parse(initial);
 const receipt = { status: 'recovered', preview: { id: 'recovered-id', name: intent.name, createdOn: '2026-10-06T00:00:00Z' }, deployment: { id: 'recovered-deploy', tag: intent.tag } };
 provider.recoverDeployment = vi.fn(async () => receipt);
 expect((await inspectPreview(root, { accountId }, dependencies)).status).toBe('owned');
 expect(await fs.readFile(filename, 'utf8')).toBe(initial);
 provider.remove.mockImplementation(async (_config, _worker, id) => {
  expect(id).toBe('recovered-id'); expect(JSON.parse(await fs.readFile(filename, 'utf8')).deployment.id).toBe('recovered-deploy');
  provider.inspect.mockResolvedValue({ status: 'absent' }); return { status: 'removed' };
 });
 expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
});
it.each([{ status: 'absent', code: 'COSSACK_CF_PREVIEW_DEPLOYMENT_ABSENT' }, { status: 'unknown', code: 'COSSACK_CF_PREVIEW_OWNERSHIP_MISMATCH' }])('never treats missing latest/unmatched ownership as remote preview absence: %j', async recovered => {
 await created(); provider.recoverDeployment = async () => recovered;
 await expect(cleanupPreview(root, { accountId }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_OWNERSHIP_UNPROVEN' });
 expect(provider.remove).not.toHaveBeenCalled();
});
it('rejects a new latest deployment when an older tagged receipt still exists', async () => {
 const value = await created();
 provider.recoverDeployment = async () => ({ status: 'recovered', preview: value.preview, deployment: { ...value.deployment, id: 'replacement-deployment' } });
 await expect(cleanupPreview(root, { accountId }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_OWNERSHIP_UNPROVEN' });
 expect(provider.remove).not.toHaveBeenCalled();
});

it('persists independent creation identity before a failed deployment and cleans without a tag', async () => {
 const filename = path.join(root, '.cossack/preview.json'); let proof;
 provider.createEmptyPreview = vi.fn(async (_worker, name) => {
  expect(JSON.parse(await fs.readFile(filename, 'utf8')).status).toBe('intent');
  proof = { id: 'new-empty-id', name, createdOn: '2026-10-06T02:00:00Z' };
  return { status: 'created', preview: proof };
 });
 provider.deploy.mockImplementation(async () => {
  const saved = JSON.parse(await fs.readFile(filename, 'utf8'));
  expect(saved.status).toBe('created'); expect(saved.preview).toEqual(proof);
  expect(saved.deployment).toBeUndefined();
  return { status: 'unknown' };
 });
 await expect(createPreview(root, options(), dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_CREATE_UNKNOWN' });
 provider.recoverDeployment = vi.fn(async () => ({ status: 'absent', code: 'COSSACK_CF_PREVIEW_DEPLOYMENT_ABSENT', preview: proof }));
 const before = await fs.readFile(filename, 'utf8');
 expect(await inspectPreview(root, { accountId }, dependencies)).toMatchObject({ status: 'owned', preview: proof });
 expect(await fs.readFile(filename, 'utf8')).toBe(before);
 provider.remove.mockImplementation(async (_config, worker, id) => {
  expect(worker).toBe('app'); expect(id).toBe(proof.id);
  expect(JSON.parse(await fs.readFile(filename, 'utf8')).preview).toEqual(proof);
  provider.inspect.mockResolvedValue({ status: 'absent' }); return { status: 'removed' };
 });
 expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
 provider.recoverDeployment.mockResolvedValue({ status: 'absent', code: 'COSSACK_CF_PREVIEW_ABSENT' });
 expect((await cleanupPreview(root, { accountId }, dependencies)).status).toBe('cleaned');
 expect(provider.remove).toHaveBeenCalledTimes(1);
});
it.each(['missing', 'identity', 'time', 'name', 'foreign-deployment'])('rejects no-tag cleanup without matching independent creation proof: %s', async mode => {
 let proof;
 provider.createEmptyPreview = async (_worker, name) => ({ status: 'created', preview: proof = { id: 'empty-id', name, createdOn: '2026-10-06T02:00:00Z' } });
 provider.deploy.mockResolvedValue({ status: 'unknown' });
 await expect(createPreview(root, options(), dependencies)).rejects.toThrow();
 const remote = { ...proof };
 if (mode === 'identity') remote.id = 'replacement';
 if (mode === 'time') remote.createdOn = '2026-10-07T02:00:00Z';
 if (mode === 'name') remote.name = 'foreign-name';
 provider.recoverDeployment = async () => mode === 'foreign-deployment'
  ? { status: 'unknown', code: 'COSSACK_CF_PREVIEW_OWNERSHIP_MISMATCH' }
  : { status: 'absent', code: 'COSSACK_CF_PREVIEW_DEPLOYMENT_ABSENT', ...(mode === 'missing' ? {} : { preview: remote }) };
 await expect(cleanupPreview(root, { accountId }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_OWNERSHIP_UNPROVEN' });
 expect(provider.remove).not.toHaveBeenCalled();
});
it('stops before deployment when the separate creation response is lost', async () => {
 provider.createEmptyPreview = async () => ({ status: 'unknown' });
 await expect(createPreview(root, options(), dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_CREATE_UNKNOWN' });
 expect(provider.deploy).not.toHaveBeenCalled();
 const saved = JSON.parse(await fs.readFile(path.join(root, '.cossack/preview.json'), 'utf8'));
 expect(saved.status).toBe('unknown'); expect(saved.preview).toBeUndefined();
 provider.recoverDeployment = async () => ({ status: 'absent', code: 'COSSACK_CF_PREVIEW_DEPLOYMENT_ABSENT', preview: { id: 'unproven', name: saved.name, createdOn: '2026-10-06T02:00:00Z' } });
 await expect(cleanupPreview(root, { accountId }, dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_OWNERSHIP_UNPROVEN' });
 expect(provider.remove).not.toHaveBeenCalled();
});
it('retains creation proof after a thrown deployment failure', async () => {
 let proof;
 provider.createEmptyPreview = async (_worker, name) => ({ status: 'created', preview: proof = { id: 'empty-id', name, createdOn: '2026-10-06T02:00:00Z' } });
 provider.deploy.mockRejectedValue(new Error('private native failure'));
 await expect(createPreview(root, options(), dependencies)).rejects.toThrow();
 const saved = JSON.parse(await fs.readFile(path.join(root, '.cossack/preview.json'), 'utf8'));
 expect(saved.status).toBe('created'); expect(saved.preview).toEqual(proof);
 provider.recoverDeployment = async () => ({ status: 'absent', code: 'COSSACK_CF_PREVIEW_DEPLOYMENT_ABSENT', preview: proof });
 expect((await inspectPreview(root, { accountId }, dependencies)).status).toBe('owned');
});
it('does not replace creation proof with a different native deployment preview', async () => {
 provider.createEmptyPreview = async (_worker, name) => ({ status: 'created', preview: { id: 'original-id', name, createdOn: '2026-10-06T02:00:00Z' } });
 provider.deploy.mockImplementation(async (_file, _worker, name, tag) => ({ status: 'deployed', preview: { id: 'replacement-id', name, createdOn: '2026-10-06T03:00:00Z' }, deployment: { id: 'deploy-id', tag }, url: 'https://preview.account.workers.dev' }));
 await expect(createPreview(root, options(), dependencies)).rejects.toMatchObject({ code: 'COSSACK_PREVIEW_CREATE_UNKNOWN' });
 const saved = JSON.parse(await fs.readFile(path.join(root, '.cossack/preview.json'), 'utf8'));
 expect(saved.preview.id).toBe('original-id'); expect(saved.deployment).toBeUndefined();
 expect(dependencies.fetch).not.toHaveBeenCalled();
});
