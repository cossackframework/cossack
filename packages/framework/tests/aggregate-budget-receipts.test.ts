// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, createHmac, randomUUID } from 'node:crypto';
const mocks = vi.hoisted(() => ({ read: vi.fn(), inspect: vi.fn() }));
vi.mock('../src/config-preflight.js', () => ({ readCloudflareDeclarationConfig: mocks.read }));
vi.mock('../src/deployment-artifact.js', () => ({ inspectDeploymentArtifact: mocks.inspect, DeploymentError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
import { prepareAuxiliaryBudgetTargets } from '../src/auxiliary-deployment';
import { prepareBudgetRun, fingerprintBudgetBatch, writeBudgetBatchReceipt, readBudgetBatchReceipt, type BudgetBatchResult } from '../src/budget-receipts';
import { evaluateBuildBudgets, type BuildBudgets } from '../src/build-budgets';

const roots: string[] = [];
beforeEach(() => {
  mocks.read.mockReset().mockImplementation(async (_root, source, environment) => ({ ...JSON.parse(await fs.readFile(source, 'utf8')), environment }));
  mocks.inspect.mockReset().mockResolvedValue({});
});
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(auxiliaryOnly = false) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'cossack-aggregate-budget-')); roots.push(root);
  const budgets: BuildBudgets = auxiliaryOnly ? {} : { uploadKiB: { error: 10 }, gzipUploadKiB: { warning: 2 } };
  const policies = [0, 1].map(i => ({ configPath: `workers/${i}.json`, budgets: { uploadKiB: { error: 10 + i } } }));
  await fs.mkdir(path.join(root, 'workers'));
  await fs.mkdir(path.join(root, '.wrangler/deploy'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: budgets, auxiliaryBuildBudgets: policies } }));
  const source = path.join(root, 'wrangler.jsonc');
  await fs.writeFile(source, JSON.stringify({ name: 'web', main: 'src/index.ts', vars: { PRIVATE: 'PRIVATE_SOURCE_SENTINEL' } }));
  for (const [i, policy] of policies.entries()) await fs.writeFile(path.join(root, policy.configPath), JSON.stringify({ name: `jobs-${i}`, main: 'worker.js', vars: { PRIVATE: 'PRIVATE_AUX_SOURCE_SENTINEL' } }));
  const artifact = path.join(root, 'dist/primary/wrangler.json');
  for (const [dir, configPath] of [['primary', source], ...policies.map((policy, i) => [`aux${i}`, path.join(root, policy.configPath)])]) {
    await fs.mkdir(path.join(root, 'dist', dir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(root, 'dist', dir, 'wrangler.json'), JSON.stringify({ main: 'index.js', no_bundle: true, configPath, vars: { PRIVATE: 'PRIVATE_CONFIG_SENTINEL' } }));
    await fs.writeFile(path.join(root, 'dist', dir, 'index.js'), 'export default "PRIVATE_MODULE_SENTINEL";');
    await fs.writeFile(path.join(root, 'dist', dir, 'chunks/extra.js'), 'export const value=1;');
  }
  const redirect = { configPath: '../../dist/primary/wrangler.json', auxiliaryWorkers: policies.map((_, i) => ({ configPath: `../../dist/aux${i}/wrangler.json` })) };
  const save = () => fs.writeFile(path.join(root, '.wrangler/deploy/config.json'), JSON.stringify(redirect)); await save();
  const tool = path.join(root, 'node_modules/wrangler'); await fs.mkdir(tool, { recursive: true });
  await fs.writeFile(path.join(tool, 'package.json'), '{"name":"wrangler","main":"cli.js","bin":{"wrangler":"bin.cjs"}}');
  await fs.writeFile(path.join(tool, 'cli.js'), 'export {};'); await fs.writeFile(path.join(tool, 'bin.cjs'), '// tool identity');
  const targets = await prepareAuxiliaryBudgetTargets(root, policies, 'preview');
  const key = await prepareBudgetRun(root);
  const primary = evaluateBuildBudgets(budgets, 'Total Upload: 3.00 KiB / gzip: 1.00 KiB');
  const workers = policies.map((policy, i) => ({ configPath: policy.configPath, buildBudgets: evaluateBuildBudgets(policy.budgets, `Total Upload: ${4 + i}.00 KiB / gzip: 1.00 KiB`) }));
  const batch: BudgetBatchResult = { primary, auxiliary: { workers, diagnostics: [], valid: true } };
  const before = await fingerprintBudgetBatch(root, artifact, budgets, 'preview', targets);
  expect(before).toMatch(/^[a-f\d]{64}$/);
  return { root, artifact, source, budgets, policies, targets, key, batch, before, redirect, save, tool, receipt: path.join(root, '.cossack/build-budget-receipt.json') };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const write = (f: Fixture, batch = f.batch) => writeBudgetBatchReceipt(f.root, f.artifact, f.budgets, 'preview', f.key, f.before, batch, f.targets);
const read = (f: Fixture) => readBudgetBatchReceipt(f.root, f.artifact, f.budgets, 'preview', f.key, f.targets);
async function sign(f: Fixture, body: Record<string, any>) {
  const signature = createHmac('sha256', f.key).update(JSON.stringify(body)).digest('hex');
  await fs.writeFile(f.receipt, JSON.stringify({ ...body, signature }));
}
async function receiptBody(f: Fixture) { const { signature, ...body } = JSON.parse(await fs.readFile(f.receipt, 'utf8')); return body; }

it.each([false, true])('atomically reuses complete two-worker batches, auxiliary-only=%s, without private values', async auxiliaryOnly => {
  const f = await fixture(auxiliaryOnly);
  expect(await write(f)).toBe(true);
  expect(await read(f)).toEqual(f.batch);
  const text = await fs.readFile(f.receipt, 'utf8');
  expect(text).not.toMatch(/PRIVATE|SECRET|configPath|workers\/|dist\/|message|diagnostics/);
  expect(text).not.toContain(f.key);
  expect(JSON.parse(text).version).toBe(2);
  expect((await fs.stat(f.receipt)).mode & 0o777).toBe(0o600);
});

it.each(['primary-module', 'auxiliary-module', 'auxiliary-chunk', 'primary-source', 'auxiliary-source', 'redirect', 'tool', 'tool-bin'])('invalidates %s across the complete batch', async mode => {
  const f = await fixture(); expect(await write(f)).toBe(true);
  const file = { 'primary-module': path.join(f.root, 'dist/primary/index.js'), 'auxiliary-module': path.join(f.root, 'dist/aux1/index.js'), 'auxiliary-chunk': path.join(f.root, 'dist/aux0/chunks/extra.js'), 'primary-source': f.source, 'auxiliary-source': path.join(f.root, f.policies[1].configPath), redirect: path.join(f.root, '.wrangler/deploy/config.json'), tool: path.join(f.tool, 'cli.js'), 'tool-bin': path.join(f.tool, 'bin.cjs') }[mode]!;
  await fs.appendFile(file, '\n');
  expect(await fingerprintBudgetBatch(f.root, f.artifact, f.budgets, 'preview', f.targets)).not.toBe(f.before);
  expect(await read(f)).toBeUndefined();
});

it('binds the primary artifact even when only auxiliary budgets are configured', async () => {
  const f = await fixture(true); expect(await write(f)).toBe(true);
  await fs.appendFile(path.join(f.root, 'dist/primary/index.js'), '\n');
  expect(await read(f)).toBeUndefined();
});
it('declines reuse if any redirect auxiliary has no policy or membership/order changes', async () => {
  const f = await fixture(); expect(await write(f)).toBe(true);
  f.redirect.auxiliaryWorkers.reverse(); await f.save();
  expect(await read(f)).toBeUndefined();
  f.redirect.auxiliaryWorkers.push({ configPath: '../../dist/unbudgeted/wrangler.json' }); await f.save();
  expect(await fingerprintBudgetBatch(f.root, f.artifact, f.budgets, 'preview', f.targets)).toBeUndefined();
});
it('binds selected environment, invocation and independent expected snapshots', async () => {
  const f = await fixture(); expect(await write(f)).toBe(true);
  await expect(readBudgetBatchReceipt(f.root, f.artifact, f.budgets, 'production', f.key, f.targets)).rejects.toMatchObject({ code: 'COSSACK_AUXILIARY_BUILD_SOURCE_CHANGED' });
  expect(await readBudgetBatchReceipt(f.root, f.artifact, f.budgets, 'preview', randomUUID(), f.targets)).toBeUndefined();
  const changed = f.targets.map((target, i) => i ? { ...target, expected: { ...target.expected, name: 'different-worker' } } : target);
  expect(await fingerprintBudgetBatch(f.root, f.artifact, f.budgets, 'preview', changed)).toBeUndefined();
});
it('does not cache a measured prefix or workers in the wrong order', async () => {
  const f = await fixture();
  expect(await write(f, { ...f.batch, auxiliary: { ...f.batch.auxiliary, workers: f.batch.auxiliary.workers.slice(0, 1) } })).toBe(false);
  expect(await write(f, { ...f.batch, auxiliary: { ...f.batch.auxiliary, workers: [...f.batch.auxiliary.workers].reverse() } })).toBe(false);
  await expect(fs.access(f.receipt)).rejects.toThrow();
});
it('does not persist before/after fingerprints that changed between worker measurements', async () => {
  const f = await fixture();
  await fs.appendFile(path.join(f.root, 'dist/aux1/index.js'), '\n');
  expect(await write(f)).toBe(false);
  await expect(fs.access(f.receipt)).rejects.toThrow();
});
it('preserves fixed failed outcomes only when all selected workers have results', async () => {
  const f = await fixture();
  const failed = { valid: false, measurements: [], diagnostics: [{ code: 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED', severity: 'error' as const, message: 'PRIVATE_TOOL_OUTPUT' }] };
  const workers = f.batch.auxiliary.workers.map((worker, i) => i ? worker : { ...worker, buildBudgets: failed });
  const batch = { ...f.batch, auxiliary: { workers, valid: false, diagnostics: failed.diagnostics } };
  expect(await write(f, { ...batch, auxiliary: { ...batch.auxiliary, workers: workers.slice(0, 1) } })).toBe(false);
  expect(await write(f, batch)).toBe(true);
  const restored = await read(f);
  expect(restored?.auxiliary.valid).toBe(false);
  expect(restored?.auxiliary.workers[0].buildBudgets.diagnostics[0].code).toBe('COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED');
  expect(JSON.stringify(restored)).not.toContain('PRIVATE_TOOL_OUTPUT');
  expect(await fs.readFile(f.receipt, 'utf8')).not.toContain('PRIVATE_TOOL_OUTPUT');
});
it.each(['missing-worker', 'extra-worker', 'negative', 'nonfinite', 'unconfigured', 'unknown-outcome', 'partial-primary', 'private-field', 'failed-with-values'])('rejects even correctly signed malformed %s receipts', async mode => {
  const f = await fixture(); expect(await write(f)).toBe(true);
  const body = await receiptBody(f);
  if (mode === 'missing-worker') body.workers.pop();
  if (mode === 'extra-worker') body.workers.push(body.workers[0]);
  if (mode === 'negative') body.workers[0].values.uploadKiB = -1;
  if (mode === 'nonfinite') body.workers[0].values.uploadKiB = null;
  if (mode === 'unconfigured') body.workers[0].values.secretMetric = 123;
  if (mode === 'unknown-outcome') body.workers[0].outcome = 'maybe';
  if (mode === 'partial-primary') delete body.primary.values.gzipUploadKiB;
  if (mode === 'private-field') body.workers[0].message = 'PRIVATE_FIELD';
  if (mode === 'failed-with-values') body.workers[0].outcome = 'failed';
  await sign(f, body);
  expect(await read(f)).toBeUndefined();
});
it('rejects unsigned tampering and a signed body without complete batch metadata', async () => {
  const f = await fixture(); expect(await write(f)).toBe(true);
  const stored = JSON.parse(await fs.readFile(f.receipt, 'utf8')); stored.workers[0].values.uploadKiB = 0;
  await fs.writeFile(f.receipt, JSON.stringify(stored)); expect(await read(f)).toBeUndefined();
  await sign(f, { version: 2, run: createHash('sha256').update(f.key).digest('hex') });
  expect(await read(f)).toBeUndefined();
});


it('invalidates the selected native startup runtime in the aggregate identity', async () => {
  const f = await fixture();
  const originalPath = process.env.MINIFLARE_WORKERD_PATH;
  const originalAutogates = process.env.MINIFLARE_WORKERD_AUTOGATES;
  delete process.env.MINIFLARE_WORKERD_PATH;
  delete process.env.MINIFLARE_WORKERD_AUTOGATES;
  try {
    const miniflare = path.join(f.root, 'node_modules/miniflare');
    const workerd = path.join(f.root, 'node_modules/workerd');
    const nativeName = process.platform === 'darwin' ? `workerd-darwin-${process.arch === 'x64' ? '64' : 'arm64'}` : process.platform === 'win32' ? 'workerd-windows-64' : `workerd-linux-${process.arch === 'x64' ? '64' : 'arm64'}`;
    const native = path.join(f.root, 'node_modules/@cloudflare', nativeName);
    await fs.mkdir(miniflare, { recursive: true }); await fs.mkdir(workerd); await fs.mkdir(path.join(native, 'bin'), { recursive: true });
    const binary = path.join(native, 'bin', `workerd${process.platform === 'win32' ? '.exe' : ''}`);
    await fs.writeFile(path.join(miniflare, 'package.json'), '{"name":"miniflare","main":"index.js"}');
    await fs.writeFile(path.join(miniflare, 'index.js'), '// miniflare identity');
    await fs.writeFile(path.join(workerd, 'package.json'), '{"name":"workerd","main":"index.cjs"}');
    await fs.writeFile(path.join(workerd, 'index.cjs'), `module.exports={default:${JSON.stringify(binary)}}`);
    await fs.writeFile(path.join(native, 'package.json'), JSON.stringify({ name: `@cloudflare/${nativeName}` }));
    await fs.writeFile(binary, 'PRIVATE_NATIVE_RUNTIME');
    const policies = f.policies.map((policy, index) => index ? policy : { ...policy, budgets: { ...policy.budgets, localStartupProfileMs: { error: 100 } } });
    await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: f.budgets, auxiliaryBuildBudgets: policies } }));
    const targets = await prepareAuxiliaryBudgetTargets(f.root, policies, 'preview');
    const before = await fingerprintBudgetBatch(f.root, f.artifact, f.budgets, 'preview', targets);
    expect(before).toMatch(/^[a-f\d]{64}$/);
    const workers = policies.map((policy, index) => ({ configPath: policy.configPath, buildBudgets: evaluateBuildBudgets(policy.budgets, `Total Upload: ${4 + index}.00 KiB / gzip: 1.00 KiB`, { localStartupProfileMs: 50.125 }) }));
    const batch = { ...f.batch, auxiliary: { workers, valid: true, diagnostics: [] } };
    expect(await writeBudgetBatchReceipt(f.root, f.artifact, f.budgets, 'preview', f.key, before, batch, targets)).toBe(true);
    expect(await readBudgetBatchReceipt(f.root, f.artifact, f.budgets, 'preview', f.key, targets)).toEqual(batch);
    expect(await fs.readFile(f.receipt, 'utf8')).not.toContain('PRIVATE_NATIVE_RUNTIME');
    await fs.appendFile(binary, '\n');
    expect(await readBudgetBatchReceipt(f.root, f.artifact, f.budgets, 'preview', f.key, targets)).toBeUndefined();
  } finally {
    if (originalPath === undefined) delete process.env.MINIFLARE_WORKERD_PATH; else process.env.MINIFLARE_WORKERD_PATH = originalPath;
    if (originalAutogates === undefined) delete process.env.MINIFLARE_WORKERD_AUTOGATES; else process.env.MINIFLARE_WORKERD_AUTOGATES = originalAutogates;
  }
});


it.each(['negative', 'nonfinite', 'unconfigured', 'duplicate'])('refuses writing %s measurements without leaving a receipt', async mode => {
  const f = await fixture();
  const batch = structuredClone(f.batch);
  const measurement = batch.primary.measurements[0] as any;
  if (mode === 'negative') measurement.value = -1;
  if (mode === 'nonfinite') measurement.value = Number.NaN;
  if (mode === 'unconfigured') measurement.metric = 'privateMetric';
  if (mode === 'duplicate') batch.primary.measurements = [...batch.primary.measurements, measurement];
  expect(await write(f, batch)).toBe(false);
  await expect(fs.access(f.receipt)).rejects.toThrow();
});


it('reuses the same default selection across native Wrangler empty and omitted environment metadata', async () => {
  const f = await fixture();
  mocks.read.mockImplementation(async (_root, source, environment) => ({ ...JSON.parse(await fs.readFile(source, 'utf8')), targetEnvironment: environment }));
  const cliTargets = await prepareAuxiliaryBudgetTargets(f.root, f.policies, undefined);
  const viteTargets = await prepareAuxiliaryBudgetTargets(f.root, f.policies, '');
  const before = await fingerprintBudgetBatch(f.root, f.artifact, f.budgets, '', viteTargets);
  expect(before).toMatch(/^[a-f\d]{64}$/);
  expect(await fingerprintBudgetBatch(f.root, f.artifact, f.budgets, undefined, cliTargets)).toBe(before);
  expect(await writeBudgetBatchReceipt(f.root, f.artifact, f.budgets, '', f.key, before, f.batch, viteTargets)).toBe(true);
  expect(await readBudgetBatchReceipt(f.root, f.artifact, f.budgets, undefined, f.key, cliTargets)).toEqual(f.batch);
});
