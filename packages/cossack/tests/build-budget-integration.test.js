import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '@cossackframework/scaffold';
import { deployCommand } from '../src/commands/deploy.js';
import { buildCommand } from '../src/commands/build.js';
import * as projectTools from '../src/project-tools.js';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
let parent;
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (parent) await fs.rm(parent, { recursive: true, force: true }); });
async function fixture(budgets = { uploadKiB: { error: 0.001 } }) {
  vi.stubEnv('VITEST', ''); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('WRANGLER_SEND_METRICS', 'false');
  parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-budget-integration-'));
  const { projectDir } = await createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', interactive: false });
  const modules = path.join(projectDir, 'node_modules'); await fs.mkdir(modules);
  for (const name of await fs.readdir(path.join(repository, 'node_modules'))) {
    if (name.startsWith('.') || name === '@cossackframework') continue;
    await fs.symlink(path.join(repository, 'node_modules', name), path.join(modules, name), 'junction');
  }
  await fs.mkdir(path.join(modules, '@cossackframework'));
  for (const name of ['framework', 'core', 'renderer', 'auth', 'database', 'ui', 'scaffold'])
    await fs.symlink(path.join(repository, 'packages', name), path.join(modules, '@cossackframework', name), 'junction');
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
it('rejects an actual generated Worker artifact against a deliberate size regression without upload', async () => {
  const { projectDir } = await fixture();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await deployCommand([], { cwd: projectDir, flags: { json: true, 'dry-run': true }, dryRun: true })).toBe(1);
  const result = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(result.diagnostics.map(item => item.code)).toEqual(['COSSACK_BUILD_BUDGET_EXCEEDED']);
  expect(result.data.steps.map(step => step.name)).toEqual(['types', 'build', 'budgets']);
  expect(result.data.buildBudgets.measurements[0]).toMatchObject({ status: 'measured', resolution: 0.01, source: 'wrangler-dry-run', limits: { error: 0.001 } });
  expect(result.data.buildBudgets.measurements[0].value).toBeGreaterThan(0.001);
  expect(result.diagnostics[0].code).toBe('COSSACK_BUILD_BUDGET_EXCEEDED');
}, 120000);

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

it('reuses the default Vite measurement for a successful native CLI dry run', async () => {
  const { projectDir } = await fixture({ uploadKiB: { warning: 0.001 } });
  const captured = vi.spyOn(projectTools, 'runProjectToolCaptured');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await buildCommand([], { cwd: projectDir, flags: { json: true } })).toBe(0);
  const built = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(built.data.buildBudgets.valid).toBe(true);
  expect(built.data.buildBudgets.measurements[0].value).toBeGreaterThan(0);
  expect(captured.mock.calls.filter(call => call[1] === 'wrangler')).toHaveLength(0);
  expect(await deployCommand([], { cwd: projectDir, flags: { json: true, 'dry-run': true }, dryRun: true })).toBe(0);
  const result = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(result.data.buildBudgets.valid).toBe(true);
  expect(result.data.buildBudgets.measurements[0].value).toBeGreaterThan(0);
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'COSSACK_BUILD_BUDGET_EXCEEDED', severity: 'warning' })]);
  expect(captured.mock.calls.filter(call => call[1] === 'wrangler')).toHaveLength(0);
  const receipt = JSON.parse(await fs.readFile(path.join(projectDir, '.cossack/build-budget-receipt.json'), 'utf8'));
  expect(receipt).toMatchObject({ version: 1, outcome: 'measured', signature: expect.stringMatching(/^[a-f\d]{64}$/) });
}, 120000);

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
