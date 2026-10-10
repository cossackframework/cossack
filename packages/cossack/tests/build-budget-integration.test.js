import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { deployCommand } from '../src/commands/deploy.js';
import { buildCommand } from '../src/commands/build.js';
import * as projectTools from '../src/project-tools.js';
let parent;
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (parent) await fs.rm(parent, { recursive: true, force: true }); });
async function fixture(budgets) {
  vi.stubEnv('VITEST', ''); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('WRANGLER_SEND_METRICS', 'false');
  parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-budget-integration-'));
  const projectDir = await scaffoldLinkedApp(parent, { adapter: 'cloudflare', packages: ['framework', 'core', 'renderer', 'auth', 'database', 'ui', 'scaffold'] });
  const manifestPath = path.join(projectDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.cossack = { buildBudgets: budgets };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const configPath = path.join(projectDir, 'wrangler.jsonc');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.vars.APP_URL = 'https://budget.example.test';
  await fs.writeFile(configPath, JSON.stringify(config));
  return { projectDir, manifestPath, manifest, configPath, config };
}

it('enforces direct installed Vite budgets for a completed selected-environment Worker', async () => {
  const { projectDir, manifestPath, manifest, configPath, config } = await fixture({ uploadKiB: { warning: 0.001 } });
  const viteConfig = path.join(projectDir, 'vite.config.ts');
  expect(await fs.readFile(viteConfig, 'utf8')).toContain('cossackBuildBudgets()');
  config.env = { staging: { name: config.name + '-staging', vars: { ...config.vars, APP_URL: 'https://staging-budget.example.test', BUDGET_MARKER: 'PRIVATE_BUDGET_VALUE_SENTINEL' }, secrets: config.secrets, durable_objects: config.durable_objects } };
  await fs.writeFile(configPath, JSON.stringify(config));
  await fs.mkdir(path.join(projectDir, '.wrangler/deploy'), { recursive: true });
  await fs.writeFile(path.join(projectDir, '.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../stale.json' }));
  const require = createRequire(path.join(projectDir, 'package.json'));
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  const build = async () => {
    try { const result = await promisify(execFile)(process.execPath, [vite, 'build'], { cwd: projectDir, env: { ...process.env, CLOUDFLARE_ENV: 'staging' }, maxBuffer: 16 * 1024 * 1024, timeout: 120000 }); return { code: 0, output: result.stdout + result.stderr }; }
    catch (error) { return { code: error.code, output: error.stdout + error.stderr }; }
  };
  const warned = await build();
  expect(warned.code, warned.output).toBe(0);
  expect(warned.output).toContain('COSSACK_BUILD_BUDGET_EXCEEDED');
  expect(warned.output).not.toContain('PRIVATE_BUDGET_VALUE_SENTINEL');
  const redirect = JSON.parse(await fs.readFile(path.join(projectDir, '.wrangler/deploy/config.json'), 'utf8'));
  const artifact = JSON.parse(await fs.readFile(path.resolve(projectDir, '.wrangler/deploy', redirect.configPath), 'utf8'));
  expect(artifact.name).toBe(config.env.staging.name);
  expect(artifact.vars.APP_URL).toBe('https://staging-budget.example.test');
  manifest.cossack.buildBudgets = { uploadKiB: { error: 0.001 } };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const rejected = await build();
  expect(rejected.code).not.toBe(0); expect(rejected.output).toContain('COSSACK_BUILD_BUDGET_EXCEEDED');
  expect(rejected.output).not.toContain('PRIVATE_BUDGET_VALUE_SENTINEL');
  manifest.cossack.buildBudgets = { uploadKiB: { error: 100000 } };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const accepted = await build(); expect(accepted.code, accepted.output).toBe(0);
  expect(accepted.output).not.toContain('COSSACK_BUILD_BUDGET_EXCEEDED');
}, 240000);


it('builds and validates a nested custom config through CLI environment selection and explicit Vite options', async () => {
  const { projectDir, configPath, config } = await fixture({ uploadKiB: { warning: 0.001 } });
  const selected = 'deployment/worker.jsonc';
  await fs.mkdir(path.join(projectDir, 'deployment'));
  config.main = '../src/index.ts';
  config.env = { staging: { name: config.name + '-custom', vars: { ...config.vars, APP_URL: 'https://custom-budget.example.test' }, secrets: config.secrets, durable_objects: config.durable_objects } };
  await fs.writeFile(path.join(projectDir, selected), JSON.stringify(config)); await fs.rm(configPath);
  vi.stubEnv('CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH', selected);
  const captured = vi.spyOn(projectTools, 'runProjectToolCaptured');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await deployCommand([], { cwd: projectDir, flags: { json: true, env: 'staging', 'dry-run': true }, dryRun: true })).toBe(0);
  const report = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(report.data.worker).toBe(config.env.staging.name);
  expect(report.data.buildBudgets.valid).toBe(true); expect(captured.mock.calls.filter(call => call[1] === 'wrangler')).toHaveLength(0);
  const viteConfig = path.join(projectDir, 'vite.config.ts');
  const source = await fs.readFile(viteConfig, 'utf8');
  await fs.writeFile(viteConfig, source.replace('cloudflare({', "cloudflare({ configPath: 'deployment/worker.jsonc',")
    .replace('cossackBuildBudgets()', "cossackBuildBudgets({ configPath: 'deployment/worker.jsonc' })")
    .replace('cossackConfig()', "cossackConfig({ configPath: 'deployment/worker.jsonc' })")
    .replace('cossackPages({', "cossackPages({ configPath: 'deployment/worker.jsonc',"));
  vi.stubEnv('CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH', '');
  const require = createRequire(path.join(projectDir, 'package.json'));
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  const built = await promisify(execFile)(process.execPath, [vite, 'build'], { cwd: projectDir, env: { ...process.env, CLOUDFLARE_ENV: 'staging' }, maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  expect(built.stdout + built.stderr).toContain('COSSACK_BUILD_BUDGET_EXCEEDED');
}, 120000);

it('rejects actual Vite watch mode promptly when budgets require a completed artifact', async () => {
  const { projectDir } = await fixture({ uploadKiB: { error: 100000 } });
  const require = createRequire(path.join(projectDir, 'package.json'));
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  let failure;
  try { await promisify(execFile)(process.execPath, [vite, 'build', '--watch'], { cwd: projectDir, env: process.env, maxBuffer: 16 * 1024 * 1024, timeout: 15000 }); }
  catch (error) { failure = error; }
  expect(failure?.code).toBe(1);
  expect(failure.stdout + failure.stderr).toContain('COSSACK_BUILD_BUDGET_WATCH_UNSUPPORTED');
  await expect(fs.access(path.join(projectDir, '.cossack/build-budget-receipt.json'))).rejects.toThrow();
  await expect(fs.access(path.join(projectDir, '.wrangler/deploy/config.json'))).rejects.toThrow();
}, 30000);
// Signed local startup timings reuse (zero CLI measurements, private profile
// data never persisted) is proven by budget-module-graphs-native (dynamic).
it('reuses a complete primary and auxiliary batch through a real two-auxiliary build and rejects a size regression without uploading Workers', async () => {
  const { projectDir, manifestPath, manifest } = await fixture({ uploadKiB: { warning: 0.001 } });
  const failures = [];
  const invoke = projectTools.runProjectToolCaptured;
  const captured = vi.spyOn(projectTools, 'runProjectToolCaptured').mockImplementation(async (root, tool, args, options) => {
    const result = await invoke(root, tool, args, { ...options, discardOutput: false });
    if (tool === 'vite' && result.code) failures.push(result.stdout + result.stderr);
    return result;
  });
  const workers = ['jobs', 'events'];
  manifest.cossack.auxiliaryBuildBudgets = workers.map(name => ({ configPath: `workers/${name}/wrangler.jsonc`, budgets: { uploadKiB: { warning: 0.001 } } }));
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  for (const name of workers) {
    const directory = path.join(projectDir, 'workers', name); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'worker.ts'), `export default { fetch() { return new Response(${JSON.stringify(name)}) } };`);
    await fs.writeFile(path.join(directory, 'wrangler.jsonc'), JSON.stringify({ name: `cossack-budget-${name}`, main: 'worker.ts', compatibility_date: '2026-01-01', vars: { PRIVATE: 'PRIVATE_AUXILIARY_SENTINEL' } }));
  }
  const vite = path.join(projectDir, 'vite.config.ts');
  await fs.writeFile(vite, (await fs.readFile(vite, 'utf8')).replace('cloudflare({', `cloudflare({ auxiliaryWorkers: ${JSON.stringify(workers.map(name => ({ configPath: `workers/${name}/wrangler.jsonc` })))},`));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await buildCommand([], { cwd: projectDir, flags: { json: true } })).toBe(0);
  const report = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(report.data.auxiliaryBuildBudgets).toMatchObject({ valid: true, workers: workers.map(name => ({ configPath: `workers/${name}/wrangler.jsonc`, buildBudgets: { valid: true, measurements: [expect.objectContaining({ metric: 'uploadKiB', status: 'measured' })] } })) });
  expect(captured.mock.calls.filter(call => call[1] === 'wrangler')).toHaveLength(0);
  expect(report.data.buildBudgets.valid).toBe(true);
  expect(report.data.buildBudgets.measurements[0].value).toBeGreaterThan(0);
  expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_BUILD_BUDGET_EXCEEDED', severity: 'warning' }));
  expect(JSON.stringify(report)).not.toContain('PRIVATE_AUXILIARY_SENTINEL');
  expect(JSON.parse(await fs.readFile(path.join(projectDir, '.cossack/build-budget-receipt.json'), 'utf8'))).toMatchObject({ version: 2, primary: { outcome: 'measured' }, workers: [{ outcome: 'measured' }, { outcome: 'measured' }], signature: expect.stringMatching(/^[a-f\d]{64}$/) });
  expect(await deployCommand([], { cwd: projectDir, flags: { json: true, 'dry-run': true }, dryRun: true })).toBe(0);
  const deployed = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(deployed.data.auxiliaryBuildBudgets.valid).toBe(true);
  // The default Vite measurement of the primary Worker is reused by the CLI dry run.
  expect(deployed.data.buildBudgets.valid).toBe(true);
  expect(deployed.data.buildBudgets.measurements[0].value).toBeGreaterThan(0);
  expect(deployed.diagnostics.length).toBeGreaterThan(0);
  expect(deployed.diagnostics.every(item => item.code === 'COSSACK_BUILD_BUDGET_EXCEEDED' && item.severity === 'warning')).toBe(true);
  expect(deployed.data.steps.map(step => step.name)).toEqual(['types', 'build', 'budgets']);
  expect(captured.mock.calls.filter(call => call[1] === 'wrangler')).toHaveLength(0);
  manifest.cossack.auxiliaryBuildBudgets[0].budgets = { uploadKiB: { error: 0.001 } };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  expect(await buildCommand([], { cwd: projectDir, flags: { json: true } })).toBe(1);
  const rejected = JSON.parse(log.mock.calls.at(-1)[0]);
  // A complete signed batch preserves this auxiliary budget failure without
  // another measurement; unrelated compiler failures retain the build envelope.
  expect(rejected.diagnostics[0].code).toBe('COSSACK_BUILD_BUDGET_EXCEEDED');
  expect(rejected.data.auxiliaryBuildBudgets.workers).toHaveLength(2);
  expect(rejected.data.buildBudgets.valid).toBe(true);
  expect(captured.mock.calls.filter(call => call[1] === 'wrangler')).toHaveLength(0);
  expect(failures.some(output => output.includes('COSSACK_BUILD_BUDGET_EXCEEDED'))).toBe(true);
  expect(JSON.stringify(rejected)).not.toContain('PRIVATE_AUXILIARY_SENTINEL');
  // A deliberate primary size regression rejects the actual generated Worker
  // artifact through the CLI dry run before any upload.
  manifest.cossack.buildBudgets = { uploadKiB: { error: 0.001 } };
  manifest.cossack.auxiliaryBuildBudgets.forEach(worker => { worker.budgets = { uploadKiB: { error: 100000 } }; });
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  expect(await deployCommand([], { cwd: projectDir, flags: { json: true, 'dry-run': true }, dryRun: true })).toBe(1);
  const regression = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(regression.diagnostics.map(item => item.code)).toEqual(['COSSACK_BUILD_BUDGET_EXCEEDED']);
  expect(regression.data.steps.map(step => step.name)).toEqual(['types', 'build', 'budgets']);
  expect(regression.data.buildBudgets.measurements[0]).toMatchObject({ status: 'measured', resolution: 0.01, source: 'wrangler-dry-run', limits: { error: 0.001 } });
  expect(regression.data.buildBudgets.measurements[0].value).toBeGreaterThan(0.001);
}, 180000);
