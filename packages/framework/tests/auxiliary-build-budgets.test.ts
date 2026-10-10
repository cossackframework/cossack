// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readAuxiliaryBuildBudgets } from '../src/auxiliary-build-budgets';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(input?: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'cossack-aux-budget-')); roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ cossack: { auxiliaryBuildBudgets: input } }));
  return root;
}
const valid = { configPath: 'workers/jobs/wrangler.jsonc', budgets: { uploadKiB: { warning: 100, error: 200 } } };
it('reads normalized literal policies without requiring or executing application files', async () => {
  const root = await fixture([{ ...valid, configPath: './workers//jobs/wrangler.jsonc' }, { configPath: 'workers/other.json', budgets: { localStartupActiveMs: { error: 30 }, providerStartupMs: { warning: 100 } } }]);
  expect(await readAuxiliaryBuildBudgets(root)).toEqual([valid, { configPath: 'workers/other.json', budgets: { localStartupActiveMs: { error: 30 }, providerStartupMs: { warning: 100 } } }]);
});
it('allows absent and empty policies', async () => {
  expect(await readAuxiliaryBuildBudgets(await fixture())).toEqual([]);
  expect(await readAuxiliaryBuildBudgets(await fixture([]))).toEqual([]);
});
it.each(['../PRIVATE_SENTINEL.json', 'workers/../PRIVATE_SENTINEL.json', '/PRIVATE_SENTINEL.json', 'C:\\PRIVATE_SENTINEL.json', 'C:PRIVATE_SENTINEL.json', '\\\\host\\PRIVATE_SENTINEL', '.', '', ' ', 'workers\\PRIVATE_SENTINEL.json', 'workers/\0PRIVATE_SENTINEL'])('rejects unsafe path %j without exposing it', async configPath => {
  const error = await readAuxiliaryBuildBudgets(await fixture([{ ...valid, configPath }])).catch(error => error);
  expect(error.code).toBe('COSSACK_AUXILIARY_BUILD_BUDGET_INVALID');
  expect(error.message).not.toContain('PRIVATE_SENTINEL');
});
it('rejects duplicate normalized paths', async () => {
  await expect(readAuxiliaryBuildBudgets(await fixture([valid, { ...valid, configPath: './workers//jobs/wrangler.jsonc' }]))).rejects.toMatchObject({ code: 'COSSACK_AUXILIARY_BUILD_BUDGET_INVALID' });
});
it.each([null, {}, 'PRIVATE_SENTINEL', [null], [{}], [{ ...valid, extra: 'PRIVATE_SENTINEL' }], Array.from({ length: 33 }, (_, index) => ({ ...valid, configPath: `${index}.json` }))])('rejects malformed or unbounded policy %j', async input => {
  await expect(readAuxiliaryBuildBudgets(await fixture(input))).rejects.toMatchObject({ code: 'COSSACK_AUXILIARY_BUILD_BUDGET_INVALID' });
});
it.each([{}, null, [], { PRIVATE_SENTINEL: { error: 1 } }, { uploadKiB: {} }, { uploadKiB: { error: 0 } }, { uploadKiB: { warning: -1 } }, { uploadKiB: { error: 'PRIVATE_SENTINEL' } }, { uploadKiB: { PRIVATE_SENTINEL: 1 } }, { uploadKiB: { warning: 2, error: 1 } }, { uploadKiB: [] }])('rejects invalid metric limits %j', async budgets => {
  const error = await readAuxiliaryBuildBudgets(await fixture([{ ...valid, budgets }])).catch(error => error);
  expect(error.code).toBe('COSSACK_AUXILIARY_BUILD_BUDGET_INVALID'); expect(error.message).not.toContain('PRIVATE_SENTINEL');
});
it('rejects nonfinite JSON numeric limits', async () => {
  const root = await fixture();
  await writeFile(join(root, 'package.json'), '{"cossack":{"auxiliaryBuildBudgets":[{"configPath":"worker.json","budgets":{"uploadKiB":{"error":1e999}}}]}}');
  await expect(readAuxiliaryBuildBudgets(root)).rejects.toMatchObject({ code: 'COSSACK_AUXILIARY_BUILD_BUDGET_INVALID' });
});
it('uses a fixed private error for malformed or missing manifests', async () => {
  const root = await fixture();
  await writeFile(join(root, 'package.json'), 'PRIVATE_SENTINEL');
  const error = await readAuxiliaryBuildBudgets(root).catch(error => error);
  expect(error.code).toBe('COSSACK_AUXILIARY_BUILD_BUDGET_READ_FAILED'); expect(error.message).not.toContain('PRIVATE_SENTINEL');
  await rm(join(root, 'package.json'));
  await expect(readAuxiliaryBuildBudgets(root)).rejects.toMatchObject({ code: 'COSSACK_AUXILIARY_BUILD_BUDGET_READ_FAILED' });
});
