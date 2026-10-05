// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { prepareBudgetRun, fingerprintBudgetArtifact, writeBudgetReceipt, readBudgetReceipt } from '../src/budget-receipts';
import { evaluateBuildBudgets } from '../src/build-budgets';
const roots: string[] = [];
const originalRuntimePath = process.env.MINIFLARE_WORKERD_PATH;
const originalAutogates = process.env.MINIFLARE_WORKERD_AUTOGATES;
beforeEach(() => { delete process.env.MINIFLARE_WORKERD_PATH; delete process.env.MINIFLARE_WORKERD_AUTOGATES; });
afterEach(async () => {
  if (originalRuntimePath === undefined) delete process.env.MINIFLARE_WORKERD_PATH; else process.env.MINIFLARE_WORKERD_PATH = originalRuntimePath;
  if (originalAutogates === undefined) delete process.env.MINIFLARE_WORKERD_AUTOGATES; else process.env.MINIFLARE_WORKERD_AUTOGATES = originalAutogates;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
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
async function startupRuntime(f: Awaited<ReturnType<typeof fixture>>, fallback = false) {
  const miniflare = join(f.root, 'node_modules/miniflare'); const workerd = join(f.root, 'node_modules/workerd');
  const nativeName = process.platform === 'darwin' ? `workerd-darwin-${process.arch === 'x64' ? '64' : 'arm64'}`
    : process.platform === 'win32' ? 'workerd-windows-64' : `workerd-linux-${process.arch === 'x64' ? '64' : 'arm64'}`;
  const native = join(f.root, 'node_modules/@cloudflare', nativeName);
  await mkdir(miniflare, { recursive: true }); await mkdir(workerd); await mkdir(join(native, 'bin'), { recursive: true });
  const miniflareEntry = join(miniflare, 'index.js'); const miniflareManifest = join(miniflare, 'package.json');
  const loader = join(workerd, 'index.cjs'); const runtimeManifest = join(workerd, 'package.json');
  const nativeManifest = join(native, 'package.json'); const binary = join(native, 'bin', `workerd${process.platform === 'win32' ? '.exe' : ''}`);
  const fallbackBinary = join(f.root, 'downloaded-workerd');
  await writeFile(miniflareManifest, '{"name":"miniflare","main":"index.js"}'); await writeFile(miniflareEntry, '// fake miniflare');
  await writeFile(runtimeManifest, '{"name":"workerd","main":"index.cjs"}');
  await writeFile(nativeManifest, JSON.stringify({ name: `@cloudflare/${nativeName}` })); await writeFile(binary, 'PRIVATE_RUNTIME_BINARY');
  await writeFile(fallbackBinary, 'PRIVATE_FALLBACK_BINARY');
  await writeFile(loader, `module.exports={default:${JSON.stringify(fallback ? fallbackBinary : binary)}}`);
  return { miniflareEntry, miniflareManifest, loader, runtimeManifest, nativeManifest, binary, fallbackBinary };
}
async function startupFixture(fallback = false) {
  const f = await fixture(); const runtime = await startupRuntime(f, fallback);
  const budgets = { ...f.budgets, localStartupProfileMs: { error: 100 }, localStartupActiveMs: { warning: 20 } };
  await writeFile(join(f.root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: budgets } }));
  const before = await fingerprintBudgetArtifact(f.root, f.artifact, budgets, 'staging');
  const result = evaluateBuildBudgets(budgets, 'Total Upload: 3.00 KiB / gzip: 1.00 KiB', { localStartupProfileMs: 50.125, localStartupActiveMs: 25.375 });
  return { ...f, budgets, before, result, runtime };
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
it.each(['', 'Total Upload: 3.00 KiB / gzip: 1.00 KiB'])('reuses local startup measurements without inventing unavailable sizes (%s)', async output => {
  const f = await fixture(); await startupRuntime(f);
  const budgets = { ...f.budgets, localStartupProfileMs: { error: 100 }, localStartupActiveMs: { warning: 20 } };
  await writeFile(join(f.root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: budgets } }));
  const before = await fingerprintBudgetArtifact(f.root, f.artifact, budgets, 'staging');
  const result = evaluateBuildBudgets(budgets, output, { localStartupProfileMs: 50.125, localStartupActiveMs: 25.375 });
  expect(await writeBudgetReceipt(f.root, f.artifact, budgets, 'staging', f.key, before, result)).toBe(true);
  expect(await readBudgetReceipt(f.root, f.artifact, budgets, 'staging', f.key)).toEqual(result);
  const receipt = await readFile(f.receipt, 'utf8');
  expect(receipt).not.toMatch(/PRIVATE|cpuprofile|functionName|startTime/);
});
it.each(['binary', 'miniflareEntry', 'loader', 'miniflareManifest', 'runtimeManifest', 'nativeManifest'] as const)
  ('invalidates startup receipts after changing runtime %s', async field => {
    const f = await startupFixture(); expect(f.before).toMatch(/^[a-f\d]{64}$/);
    expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result)).toBe(true);
    expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toEqual(f.result);
    const file = f.runtime[field]; await writeFile(file, await readFile(file, 'utf8') + '\n');
    expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toBeUndefined();
    expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result)).toBe(false);
  });
it.each(['MINIFLARE_WORKERD_PATH', 'MINIFLARE_WORKERD_AUTOGATES'] as const)('invalidates startup receipts after changing %s', async variable => {
  const f = await startupFixture();
  expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result)).toBe(true);
  process.env[variable] = variable === 'MINIFLARE_WORKERD_PATH' ? f.runtime.fallbackBinary : 'changed-autogates';
  expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toBeUndefined();
});
it('binds explicit startup runtime override contents and replacement paths', async () => {
  const f = await startupFixture(); process.env.MINIFLARE_WORKERD_PATH = f.runtime.fallbackBinary;
  const before = await fingerprintBudgetArtifact(f.root, f.artifact, f.budgets, 'staging'); expect(before).toMatch(/^[a-f\d]{64}$/);
  expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, before, f.result)).toBe(true);
  expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toEqual(f.result);
  await writeFile(f.runtime.fallbackBinary, 'replacement'); expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toBeUndefined();
});
it('declines startup receipt write and reuse for unsupported downloaded runtime fallback', async () => {
  const f = await startupFixture(true); expect(f.before).toBeUndefined();
  expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result)).toBe(false);
  expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toBeUndefined();
});
it('declines receipt writes for a bare runtime executable resolved through PATH', async () => {
  const f = await startupFixture(); process.env.MINIFLARE_WORKERD_PATH = 'downloaded-workerd';
  const before = await fingerprintBudgetArtifact(f.root, f.artifact, f.budgets, 'staging'); expect(before).toBeUndefined();
  expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, before, f.result)).toBe(false);
});
it('keeps size-only receipt reuse available without startup dependencies', async () => {
  const f = await fixture();
  expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, f.result)).toBe(true);
  expect(await readBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key)).toEqual(f.result);
  const budgets = { ...f.budgets, localStartupProfileMs: { error: 100 } };
  expect(await fingerprintBudgetArtifact(f.root, f.artifact, budgets, 'staging')).toBeUndefined();
});
it('declines oversized redirect metadata before parsing', async () => {
  const f = await fixture(); const redirect = join(f.root, '.wrangler/deploy/config.json');
  await truncate(redirect, 1024 * 1024 + 1);
  expect(await fingerprintBudgetArtifact(f.root, f.artifact, f.budgets, 'staging')).toBeUndefined();
});
it('declines symbolic redirect metadata', async () => {
  const f = await fixture(); const redirect = join(f.root, '.wrangler/deploy/config.json');
  const copy = join(f.root, 'redirect-copy.json'); await writeFile(copy, await readFile(redirect));
  await rm(redirect); await symlink(copy, redirect);
  expect(await fingerprintBudgetArtifact(f.root, f.artifact, f.budgets, 'staging')).toBeUndefined();
});
it.each(['fingerprint', 'size'])('declines authenticated but incomplete %s evidence', async kind => {
  const f = await fixture(); const budgets = { ...f.budgets, gzipUploadKiB: { error: 2 } };
  await writeFile(join(f.root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: budgets } }));
  const before = await fingerprintBudgetArtifact(f.root, f.artifact, budgets, 'staging');
  const result = evaluateBuildBudgets(budgets, 'Total Upload: 3.00 KiB / gzip: 1.00 KiB');
  await writeBudgetReceipt(f.root, f.artifact, budgets, 'staging', f.key, before, result);
  const { signature: _signature, ...body } = JSON.parse(await readFile(f.receipt, 'utf8'));
  if (kind === 'fingerprint') {
    delete body.fingerprint;
    await writeFile(f.artifact, '{"main":"index.js","no_bundle":false}');
  } else delete body.values.gzipUploadKiB;
  const signature = createHmac('sha256', f.key).update(JSON.stringify(body)).digest('hex');
  await writeFile(f.receipt, JSON.stringify({ ...body, signature }));
  expect(await readBudgetReceipt(f.root, f.artifact, budgets, 'staging', f.key)).toBeUndefined();
});
it('does not sign partial configured size evidence', async () => {
  const f = await fixture();
  const result = { ...f.result, measurements: f.result.measurements.filter(item => item.metric === 'uploadKiB') };
  expect(await writeBudgetReceipt(f.root, f.artifact, f.budgets, 'staging', f.key, f.before, result)).toBe(false);
  await expect(readFile(f.receipt)).rejects.toThrow();
});
