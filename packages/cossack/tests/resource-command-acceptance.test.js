import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { planResources, applyResourcePlan } from '../src/resource-plan.js';
const require = createRequire(import.meta.url), roots = [];
const accountId = 'a'.repeat(32), id = '12345678-1234-1234-1234-123456789abc', hexId = 'b'.repeat(32);
const repo = path.resolve(import.meta.dirname, '../../..');
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const bindings = {
  d1_databases: [{ binding: 'DB', database_name: 'old-db' }],
  kv_namespaces: [{ binding: 'CACHE', id: 'c'.repeat(32) }],
  r2_buckets: [{ binding: 'FILES', bucket_name: 'old-files' }],
  hyperdrive: [{ binding: 'TUNNEL', id: 'c'.repeat(32) }],
  queues: { producers: [{ binding: 'EVENTS', queue: 'events' }] },
  workflows: [{ binding: 'PROCESS', name: 'process', class_name: 'Processor' }],
  services: [{ binding: 'API', service: 'api' }],
  durable_objects: { bindings: [{ name: 'STATE', class_name: 'State' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['State'] }],
};
async function project(extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-resource-command-')); roots.push(root);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.symlink(path.dirname(require.resolve('wrangler/package.json')), path.join(root, 'node_modules/wrangler'), 'junction');
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"resource-fixture","type":"module"}');
  await fs.writeFile(path.join(root, 'index.ts'), 'export default {fetch:()=>new Response("ok")};');
  const file = path.join(root, 'wrangler.jsonc');
  await fs.writeFile(file, '// preserve authored comment\n' + JSON.stringify({ name: 'resource-fixture', main: './index.ts', compatibility_date: '2026-06-06', ...bindings, vars: { SECRET: 'PRIVATE_VALUE' }, ...extra }, null, 2));
  return { root, file };
}
function provider() {
  return { verifyAccount: vi.fn(async () => ({ status: 'verified', accountId })), find: vi.fn(async (_kind, reference) => ({ status: 'verified', accountId, reference })) };
}
const selections = { schemaVersion: 1, resources: [
  { binding: 'DB', kind: 'd1', mode: 'existing', id, name: 'new-db' },
  { binding: 'CACHE', kind: 'kv', mode: 'existing', id: hexId },
  { binding: 'FILES', kind: 'r2', mode: 'existing', name: 'new-files' },
  { binding: 'TUNNEL', kind: 'hyperdrive', mode: 'existing', id: hexId },
] };
async function cli(root, args, env = {}) {
  try { const result = await promisify(execFile)(process.execPath, [path.join(repo, 'packages/cossack/bin/cossack.js'), 'resources', ...args, '--json'], { cwd: root, env: { ...process.env, ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, timeout: 20000 }); return { code: 0, result: JSON.parse(result.stdout) }; }
  catch (error) { return { code: error.code, result: JSON.parse(error.stdout) }; }
}
describe('resource commands with actual Wrangler configuration parsing', () => {
  it('actual CLI plan is read-only, covers all kinds, and isolates named bindings', async () => {
    const f = await project({ env: { preview: { d1_databases: [{ binding: 'PREVIEW_DB', database_name: 'preview' }] } } });
    const before = await fs.readFile(f.file, 'utf8');
    const normal = await cli(f.root, ['plan', '--account', accountId], { CLOUDFLARE_ENV: 'preview' });
    expect(normal.code).toBe(0); expect(JSON.stringify(normal.result)).not.toContain('PRIVATE_VALUE');
    expect(normal.result.data.effects).toEqual({ cloudWrites: 0, localWrites: 0 });
    expect(new Set(normal.result.data.resources.map(r => r.kind))).toEqual(new Set(['d1', 'kv', 'r2', 'hyperdrive', 'queue', 'workflow', 'service', 'durable-object']));
    expect(normal.result.data.resources.find(r => r.kind === 'durable-object').mode).toBe('provider-managed');
    const named = await cli(f.root, ['plan', '--account', accountId, '--env', 'preview'], { CLOUDFLARE_ENV: 'production' });
    expect(named.code).toBe(0); expect(named.result.data.resources.filter(r => r.kind === 'd1').map(r => r.binding)).toEqual(['PREVIEW_DB']);
    expect(await fs.readFile(f.file, 'utf8')).toBe(before);
  }, 30000);
  it('actual CLI invalid account and selection return failures before effects', async () => {
    const f = await project(); const before = await fs.readFile(f.file, 'utf8');
    const invalid = await cli(f.root, ['plan', '--account', 'invalid-private-value']);
    expect(invalid.code).not.toBe(0); expect(JSON.stringify(invalid.result)).not.toContain('invalid-private-value');
    await fs.writeFile(path.join(f.root, 'choices.json'), JSON.stringify({ schemaVersion: 1, resources: [{ binding: 'DB', kind: 'd1', mode: 'existing', name: 'only-name' }] }));
    const choice = await cli(f.root, ['plan', '--account', accountId, '--select', 'choices.json']);
    expect(choice.code).not.toBe(0); expect(await fs.readFile(f.file, 'utf8')).toBe(before);
  }, 30000);
  it('authenticated local apply converges four provider references while preserving comments and other environments', async () => {
    const f = await project({ env: { preview: { ...bindings }, production: { vars: { MARKER: 'untouched' } } } }); const remote = provider();
    const plan = await planResources(f.root, { accountId, environment: 'preview', selections, verify: true, provider: remote });
    expect(plan.effects).toEqual({ cloudWrites: 0, localWrites: 0 });
    const before = await fs.readFile(f.file, 'utf8');
    expect((await applyResourcePlan(plan)).applied).toBe('updated');
    const after = await fs.readFile(f.file, 'utf8'); expect(after).toContain('// preserve authored comment'); expect(after).toContain('PRIVATE_VALUE');
    const parsed = JSON.parse(after.replace('// preserve authored comment\n', '').replace(/,\s*([}\]])/g, '$1'));
    expect(parsed.d1_databases).toEqual(bindings.d1_databases); expect(parsed.env.production.vars.MARKER).toBe('untouched');
    expect(parsed.env.preview.d1_databases[0]).toMatchObject({ database_id: id, database_name: 'new-db' });
    expect(parsed.env.preview.kv_namespaces[0].id).toBe(hexId); expect(parsed.env.preview.r2_buckets[0].bucket_name).toBe('new-files'); expect(parsed.env.preview.hyperdrive[0].id).toBe(hexId);
    expect(before).not.toBe(after);
    expect((await applyResourcePlan(await planResources(f.root, { accountId, environment: 'preview', selections, verify: true, provider: remote }))).applied).toBe('unchanged');
  });
  it('all selectable create kinds remain unresolved without provider resource calls', async () => {
    const f = await project(), remote = provider();
    const resources = [['DB','d1'],['CACHE','kv'],['FILES','r2'],['TUNNEL','hyperdrive'],['EVENTS','queue'],['PROCESS','workflow'],['API','service']].map(([binding,kind]) => ({binding,kind,mode:'create',name:'new-resource'}));
    const plan = await planResources(f.root, { accountId, verify: true, provider: remote, selections: {schemaVersion:1,resources} });
    expect(plan.resources.filter(r=>r.selected).every(r=>r.remote.code==='COSSACK_RESOURCE_PROVISION_UNSUPPORTED' && !r.canCreate)).toBe(true);
    expect(remote.find).not.toHaveBeenCalled();
    await expect(applyResourcePlan(plan)).rejects.toMatchObject({code:'COSSACK_RESOURCE_UNRESOLVED'});
    await expect(planResources(f.root,{accountId, selections:{schemaVersion:1,resources:[{binding:'STATE',kind:'durable-object',mode:'create',name:'state'}]}})).rejects.toMatchObject({code:'COSSACK_RESOURCE_PROVIDER_MANAGED'});
  });
  it('named account ownership never rewrites the root or another environment account', async () => {
    const other = 'c'.repeat(32);
    const f = await project({account_id: accountId, env: {preview: {account_id: other, ...bindings}, production: {account_id: accountId}}});
    const remote = provider();
    remote.verifyAccount.mockResolvedValue({status: 'verified', accountId: other});
    remote.find.mockImplementation(async (_kind, reference) => ({status:'verified', accountId:other, reference}));
    await applyResourcePlan(await planResources(f.root, {accountId:other, environment:'preview', selections, verify:true, provider:remote}));
    const text = await fs.readFile(f.file,'utf8');
    const config = JSON.parse(text.replace('// preserve authored comment\n','').replace(/,\s*([}\]])/g,'$1'));
    expect(config.account_id).toBe(accountId);
    expect(config.env.production.account_id).toBe(accountId);
    expect(config.env.preview.account_id).toBe(other);
    expect(config.env.preview.d1_databases[0].database_id).toBe(id);
    expect((await applyResourcePlan(await planResources(f.root, {accountId:other, environment:'preview', selections, verify:true, provider:remote}))).applied).toBe('unchanged');
  });
});
