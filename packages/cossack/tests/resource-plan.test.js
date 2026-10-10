import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planResources, applyResourcePlan } from '../src/resource-plan.js';
import { commandSpecs } from '../src/command-specs.js';

const accountId = 'a'.repeat(32), databaseId = '12345678-1234-1234-1234-123456789abc';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(text = '{ // keep this comment\n "name": "worker", "d1_databases": [{"binding":"DB", "database_name":"old"}], "vars":{"PRIVATE_SECRET":"DO_NOT_RETURN"}\n}') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-resource-plan-'));
  roots.push(root);
  const file = path.join(root, 'wrangler.jsonc');
  await fs.writeFile(file, text);
  const inspect = vi.fn(async (_root, environment) => ({ config: {}, summary: { configPath: file, environment,
    bindings: [{ type: 'd1_databases', name: 'DB', resource: null, configuration: 'unresolved', nextAction: 'Select a database' }] } }));
  const provider = { verifyAccount: vi.fn(async () => ({ status: 'verified', accountId })),
    find: vi.fn(async (_kind, reference) => ({ status: 'verified', accountId, reference })) };
  const selections = { schemaVersion: 1, resources: [{ binding: 'DB', kind: 'd1', mode: 'existing', id: databaseId, name: 'selected' }] };
  return { root, file, inspect, provider, selections };
}
describe('account-owned resource planning and local application', () => {
  it('plan-only is read-only and never claims resource existence', async () => {
    const f = await fixture(), before = await fs.readFile(f.file, 'utf8');
    const plan = await planResources(f.root, { ...f, accountId });
    expect(plan.resources[0]).toMatchObject({ mode: 'existing', selected: true, canCreate: false, remote: { status: 'not-checked' } });
    expect(f.provider.verifyAccount).not.toHaveBeenCalled();
    expect(await fs.readFile(f.file, 'utf8')).toBe(before);
    expect(JSON.stringify(plan)).not.toContain('DO_NOT_RETURN');
    await expect(applyResourcePlan(plan)).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_ACCOUNT_UNVERIFIED' });
  });
  it('applies verified D1 selections preserving comments, secrets and other configuration; repeats unchanged', async () => {
    const f = await fixture();
    const plan = await planResources(f.root, { ...f, accountId, verify: true });
    expect((await applyResourcePlan(plan)).effects).toEqual({ cloudWrites: 0, localWrites: 1 });
    const text = await fs.readFile(f.file, 'utf8');
    expect(text).toContain('// keep this comment');
    expect(text).toContain('DO_NOT_RETURN');
    expect(text).toContain(databaseId);
    expect(text).toContain('selected');
    expect(text).toContain(accountId);
    expect((await applyResourcePlan(await planResources(f.root, { ...f, accountId, verify: true }))).applied).toBe('unchanged');
  });
  it('adds two missing D1 reference fields without replacing authored entries', async () => {
    const f = await fixture('{"d1_databases":[{"binding":"DB"}]}');
    await applyResourcePlan(await planResources(f.root, { ...f, accountId, verify: true }));
    expect((await fs.readFile(f.file, 'utf8')).match(/database_/g)).toHaveLength(2);
  });
  it('isolates named environment edits from top-level and other environments', async () => {
    const f = await fixture('{"d1_databases":[{"binding":"DB","database_id":"top"}],"env":{"preview":{"d1_databases":[{"binding":"DB"}]},"production":{"name":"unchanged"}}}');
    await applyResourcePlan(await planResources(f.root, { ...f, accountId, environment: 'preview', verify: true }));
    const text = await fs.readFile(f.file, 'utf8');
    expect(text).toContain('"database_id":"top"');
    expect(text).toContain('"production":{"name":"unchanged"}');
  });
  it('rejects configured wrong account before authenticated lookups', async () => {
    const f = await fixture();
    f.inspect.mockResolvedValue({ config: { account_id: 'b'.repeat(32) }, summary: { configPath: f.file, bindings: [] } });
    await expect(planResources(f.root, { ...f, accountId, verify: true })).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_ACCOUNT_MISMATCH' });
    expect(f.provider.verifyAccount).not.toHaveBeenCalled();
  });
  it('rejects unverifiable account before any resource lookup', async () => {
    const f = await fixture();
    f.provider.verifyAccount.mockResolvedValue({ status: 'missing', accountId });
    await expect(planResources(f.root, { ...f, accountId, verify: true })).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_ACCOUNT_UNVERIFIED' });
    expect(f.provider.find).not.toHaveBeenCalled();
  });
  it.each(['missing', 'unknown', 'unsupported'])('unavailable %s resources cannot be applied', async status => {
    const f = await fixture();
    f.provider.find.mockResolvedValue({ status, action: 'Resolve this reference with Wrangler' });
    const plan = await planResources(f.root, { ...f, accountId, verify: true });
    await expect(applyResourcePlan(plan)).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_UNRESOLVED' });
    expect((await fs.readFile(f.file, 'utf8'))).not.toContain(databaseId);
  });
  it('unsupported create plans return a precise action and never call creation or find', async () => {
    const f = await fixture();
    f.selections.resources[0] = { binding: 'DB', kind: 'd1', mode: 'create', name: 'new' };
    const plan = await planResources(f.root, { ...f, accountId, verify: true });
    expect(plan.resources[0]).toMatchObject({ mode: 'create', canCreate: false, remote: { status: 'unsupported', code: 'COSSACK_RESOURCE_PROVISION_UNSUPPORTED' } });
    expect(plan.resources[0].remote.action).toContain('mode existing');
    expect(f.provider.find).not.toHaveBeenCalled();
    await expect(applyResourcePlan(plan)).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_UNRESOLVED' });
  });
  it('rejects stale config and serialized/tampered plans', async () => {
    const f = await fixture();
    const plan = await planResources(f.root, { ...f, accountId, verify: true });
    expect(Object.isFrozen(plan.resources[0].remote)).toBe(true);
    await expect(applyResourcePlan(JSON.parse(JSON.stringify(plan)))).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_PLAN_INVALID' });
    await fs.appendFile(f.file, '\n// new user work');
    await expect(applyResourcePlan(plan)).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_PLAN_STALE' });
    expect(await fs.readFile(f.file, 'utf8')).toContain('new user work');
  });
  it('validates strict explicit choices and account identity', async () => {
    const f = await fixture();
    await expect(planResources(f.root, { ...f, accountId: undefined })).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_ACCOUNT_REQUIRED' });
    f.selections.resources[0].id = '0'.repeat(32);
    await expect(planResources(f.root, { ...f, accountId })).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_SELECTION_INVALID' });
    expect(commandSpecs.resources.validate(['plan'], { account: accountId, verify: true })).toEqual([]);
    expect(commandSpecs.resources.validate(['create'], { account: accountId }).some(item => item.code === 'COSSACK_ACTION_UNKNOWN')).toBe(true);
  });
  it('rejects selection of undeclared or differently typed binding', async () => {
    const f = await fixture();
    f.selections.resources[0].kind = 'kv';
    await expect(planResources(f.root, { ...f, accountId })).rejects.toMatchObject({ code: 'COSSACK_RESOURCE_BINDING_UNKNOWN' });
  });
});
