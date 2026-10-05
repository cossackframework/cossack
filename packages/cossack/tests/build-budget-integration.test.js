import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '@cossackframework/scaffold';
import { deployCommand } from '../src/commands/deploy.js';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
let parent;
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (parent) await fs.rm(parent, { recursive: true, force: true }); });
it('rejects an actual generated Worker artifact against a deliberate size regression without upload', async () => {
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
  manifest.cossack = { buildBudgets: { uploadKiB: { error: 0.001 } } };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const configPath = path.join(projectDir, 'wrangler.jsonc');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.vars.APP_URL = 'https://budget.example.test';
  await fs.writeFile(configPath, JSON.stringify(config));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await deployCommand([], { cwd: projectDir, flags: { json: true, 'dry-run': true }, dryRun: true })).toBe(1);
  const result = JSON.parse(log.mock.calls.at(-1)[0]);
  expect(result.diagnostics.map(item => item.code)).toEqual(['COSSACK_BUILD_BUDGET_EXCEEDED']);
  expect(result.data.steps.map(step => step.name)).toEqual(['types', 'build', 'budgets']);
  expect(result.data.buildBudgets.measurements[0]).toMatchObject({ status: 'measured', resolution: 0.01, source: 'wrangler-dry-run', limits: { error: 0.001 } });
  expect(result.data.buildBudgets.measurements[0].value).toBeGreaterThan(0.001);
  expect(result.diagnostics[0].code).toBe('COSSACK_BUILD_BUDGET_EXCEEDED');
}, 120000);
