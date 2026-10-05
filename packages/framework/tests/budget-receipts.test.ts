// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareBudgetRun, fingerprintBudgetArtifact, writeBudgetReceipt, readBudgetReceipt } from '../src/budget-receipts';
import { evaluateBuildBudgets } from '../src/build-budgets';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cossack-budget-receipt-')); roots.push(root);
  const budgets = { uploadKiB: { error: 10 }, gzipUploadKiB: { warning: 2 } };
  await writeFile(join(root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: budgets } }));
  const dir = join(root, 'dist/ssr'); await mkdir(dir, { recursive: true });
  const artifact = join(dir, 'wrangler.json');
  await writeFile(artifact, JSON.stringify({ main: 'index.js', no_bundle: true, vars: { SECRET: 'PRIVATE_CONFIG_SENTINEL' } }));
  await writeFile(join(dir, 'index.js'), "export default 'PRIVATE_MODULE_SENTINEL';");
  await mkdir(join(dir, 'chunks')); await writeFile(join(dir, 'chunks/extra.js'), 'export default 1;');
  await mkdir(join(root, '.wrangler/deploy'), { recursive: true });
  await writeFile(join(root, '.wrangler/deploy/config.json'), '{"configPath":"../../dist/ssr/wrangler.json","auxiliaryWorkers":[]}');
  const tool = join(root, 'node_modules/wrangler'); await mkdir(tool, { recursive: true });
  await writeFile(join(tool, 'package.json'), '{"name":"wrangler","main":"cli.js","bin":{"wrangler":"bin.cjs"}}');
  await writeFile(join(tool, 'cli.js'), 'export {};'); await writeFile(join(tool, 'bin.cjs'), '// native tool identity');
  const key = await prepareBudgetRun(root);
  const before = await fingerprintBudgetArtifact(root, artifact, budgets, 'staging'); expect(before).toMatch(/^[a-f\d]{64}$/);
  const result = evaluateBuildBudgets(budgets, 'Total Upload: 3.00 KiB / gzip: 1.00 KiB');
  return { root, dir, artifact, budgets, key, before, result, receipt: join(root, '.cossack/build-budget-receipt.json'), tool };
}
it('reuses signed safe measurements without persisting secrets, source or invocation key', async () => {
  const f = await fixture();
  expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result)).toBe(true);
  expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toEqual(f.result);
  const text = await readFile(f.receipt, 'utf8'); expect(text).not.toMatch(/PRIVATE|SECRET|wrangler-dry-run/); expect(text).not.toContain(f.key);
});
it('rejects another invocation, environment, tampering and corrupted receipts', async () => {
  const f = await fixture(); await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result);
  expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', randomUUID())).toBeUndefined();
  expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'production', f.key)).toBeUndefined();
  const body = JSON.parse(await readFile(f.receipt, 'utf8')); body.values.uploadKiB = 0; body.diagnostics = [{ message: 'PRIVATE_TAMPER' }];
  await writeFile(f.receipt, JSON.stringify(body)); expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toBeUndefined();
  await writeFile(f.receipt, 'invalid'); expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toBeUndefined();
});
it.each(['main', 'chunk', 'config', 'redirect', 'tool'])('invalidates changed %s identities before reuse', async kind => {
  const f = await fixture(); await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result);
  const file = { main: join(f.dir, 'index.js'), chunk: join(f.dir, 'chunks/extra.js'), config: f.artifact,
    redirect: join(f.root, '.wrangler/deploy/config.json'), tool: join(f.tool, 'cli.js') }[kind]!;
  await writeFile(file, await readFile(file, 'utf8') + '\n');
  expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toBeUndefined();
});
it('refuses writes when artifacts changed during measurement, and rejects changed settings', async () => {
  const f = await fixture(); await writeFile(join(f.dir, 'index.js'), 'export default 2;');
  expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result)).toBe(false);
  await writeFile(join(f.root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: { uploadKiB: { error: 1 } } } }));
  await expect(readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).rejects.toMatchObject({ code: 'COSSACK_BUILD_BUDGET_SETTINGS_CHANGED' });
});
it.each([{ no_bundle: false }, { build: { command: 'custom' } }, { main: '../../outside.js' }, { base_dir: '../../' },
  { wasm_modules: { external: '/outside' } }, { unsafe: {} }, { site: {} }])('refuses unsupported module graphs %j', async override => {
  const f = await fixture(); await writeFile(f.artifact, JSON.stringify({ main: 'index.js', no_bundle: true, ...override }));
  expect(await fingerprintBudgetArtifact(f.root, f.artifact, f.budgets, 'staging')).toBeUndefined();
});
it('refuses symbolic modules and symbolic receipt storage', async () => {
  const f = await fixture(); await symlink(join(f.dir, 'index.js'), join(f.dir, 'alias.js'));
  expect(await fingerprintBudgetArtifact(f.root, f.artifact, f.budgets, 'staging')).toBeUndefined();
  await rm(join(f.root, '.cossack'), { recursive: true }); await symlink(f.dir, join(f.root, '.cossack'), 'junction');
  await expect(prepareBudgetRun(f.root)).rejects.toMatchObject({ code: 'COSSACK_BUILD_BUDGET_RECEIPT_UNSAFE' });
});
it('clears old receipts for each invocation', async () => {
  const f = await fixture(); await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result);
  expect(await prepareBudgetRun(f.root)).not.toBe(f.key); await expect(readFile(f.receipt)).rejects.toThrow();
});
it.each(['limit', 'unavailable', 'failed'])('reconstructs fixed %s failure diagnostics', async kind => {
  const f = await fixture();
  const result = kind === 'failed' ? { valid: false, measurements: [], diagnostics: [{ code: 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED', severity: 'error', message: 'PRIVATE_ERROR_SENTINEL' }] }
    : evaluateBuildBudgets(f.budgets, kind === 'limit' ? 'Total Upload: 20.00 KiB / gzip: 1.00 KiB' : '');
  await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, result);
  const read = await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key);
  expect(read?.valid).toBe(false); expect(read?.diagnostics[0].code).toBe(result.diagnostics[0].code);
  expect(JSON.stringify(read)).not.toContain('PRIVATE');
});
