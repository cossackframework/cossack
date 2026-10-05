import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { deployCommand } from '../src/commands/deploy.js';
import { inspectDeployment, inspectBuiltDeployment } from '../src/deployment.js';
import { inspectConfigurationRequirements } from '../src/config-inspection.js';
import { runProjectTool, runProjectToolCaptured } from '../src/project-tools.js';

vi.mock('../src/deployment.js', () => ({ inspectDeployment: vi.fn(), inspectBuiltDeployment: vi.fn() }));
vi.mock('../src/config-inspection.js', () => ({ inspectConfigurationRequirements: vi.fn() }));
vi.mock('../src/project-tools.js', () => ({ runProjectTool: vi.fn(), runProjectToolCaptured: vi.fn() }));
const roots = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function setup(flags = {}) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-deploy-command-'));
  roots.push(cwd);
  await fs.writeFile(path.join(cwd, 'package.json'), '{}');
  inspectDeployment.mockResolvedValue({ config: {}, summary: { configPath: path.join(cwd, 'wrangler.jsonc'), worker: 'app-staging' }, diagnostics: [] });
  inspectBuiltDeployment.mockResolvedValue(path.join(cwd, 'dist/wrangler.json'));
  inspectConfigurationRequirements.mockResolvedValue({ valid: true, diagnostics: [], validation: 'declarations-only', remoteSecrets: 'not-checked' });
  runProjectTool.mockResolvedValue(0);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  return { cwd, flags: { json: true, ...flags }, dryRun: flags['dry-run'] === true, log };
}
describe('deploy command', () => {
  it('allows warning budgets and reuses local measurement for dry-run deployment', async () => {
    const ctx = await setup({ 'dry-run': true });
    await fs.writeFile(path.join(ctx.cwd, 'package.json'), JSON.stringify({ cossack: { buildBudgets: { uploadKiB: { warning: 10, error: 30 } } } }));
    runProjectToolCaptured.mockResolvedValue({ code: 0, stdout: 'Total Upload: 20.00 KiB / gzip: 1.00 KiB', stderr: '' });
    expect(await deployCommand([], ctx)).toBe(0);
    expect(runProjectTool).toHaveBeenCalledTimes(2);
    expect(runProjectToolCaptured).toHaveBeenCalledOnce();
    const result = JSON.parse(ctx.log.mock.calls[0][0]);
    expect(result.ok).toBe(true); expect(result.diagnostics[0].severity).toBe('warning');
    expect(result.data.steps.at(-1).name).toBe('budgets');
  });
  it('stops an exceeded budget before upload and returns sanitized measured limits', async () => {
    const ctx = await setup();
    await fs.writeFile(path.join(ctx.cwd, 'package.json'), JSON.stringify({ cossack: { buildBudgets: { uploadKiB: { error: 10 } } } }));
    runProjectToolCaptured.mockResolvedValue({ code: 0, stdout: 'PRIVATE_BINDING\nTotal Upload: 20.00 KiB / gzip: 1.00 KiB', stderr: '' });
    expect(await deployCommand([], ctx)).toBe(1);
    expect(runProjectTool).toHaveBeenCalledTimes(2);
    expect(runProjectToolCaptured.mock.calls[0][2]).toContain('--dry-run');
    const result = JSON.parse(ctx.log.mock.calls[0][0]);
    expect(result.data.buildBudgets.measurements[0].value).toBe(20);
    expect(result.diagnostics[0].code).toBe('COSSACK_BUILD_BUDGET_EXCEEDED');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('selects the environment before types and build, then dry-runs the exact artifact', async () => {
    const ctx = await setup({ env: 'staging', mode: 'test', 'dry-run': true });
    expect(await deployCommand([], ctx)).toBe(0);
    const calls = runProjectTool.mock.calls;
    expect(calls[0][2]).toEqual(['types', '--config', path.join(ctx.cwd, 'wrangler.jsonc'), '--env-interface', 'CloudflareBindings', '--env', 'staging']);
    expect(calls[1].slice(0, 3)).toEqual([ctx.cwd, 'vite', ['build', '--mode', 'test']]);
    for (const call of calls) expect(call[3].env.CLOUDFLARE_ENV).toBe('staging');
    expect(calls[2][2]).toEqual(['deploy', '--config', path.join(ctx.cwd, 'dist/wrangler.json'), '--dry-run']);
    expect(ctx.log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ctx.log.mock.calls[0][0])).toMatchObject({ schemaVersion: 1, command: 'deploy', ok: true, data: { dryRun: true, steps: [{ name: 'types' }, { name: 'build' }, { name: 'deploy' }] } });
  });

  it('removes stale deployment metadata before building', async () => {
    const ctx = await setup();
    const metadata = path.join(ctx.cwd, '.wrangler/deploy/config.json');
    await fs.mkdir(path.dirname(metadata), { recursive: true });
    await fs.writeFile(metadata, '{}');
    runProjectTool.mockImplementation(async (_root, tool) => {
      if (tool === 'vite') await expect(fs.access(metadata)).rejects.toThrow();
      return 0;
    });
    expect(await deployCommand([], ctx)).toBe(0);
  });

  it('stops before deployment when the build fails', async () => {
    const ctx = await setup();
    runProjectTool.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    expect(await deployCommand([], ctx)).toBe(1);
    expect(runProjectTool).toHaveBeenCalledTimes(2);
    expect(inspectBuiltDeployment).not.toHaveBeenCalled();
    expect(JSON.parse(ctx.log.mock.calls[0][0]).diagnostics[0].code).toBe('COSSACK_DEPLOY_BUILD_FAILED');
  });

  it('stops before invoking tools when preflight finds an error', async () => {
    const ctx = await setup();
    inspectDeployment.mockResolvedValue({ config: {}, summary: {}, diagnostics: [{ code: 'COSSACK_SECRET_IN_VARS', severity: 'error', message: 'Move APP_SECRET.' }] });
    expect(await deployCommand([], ctx)).toBe(1);
    expect(runProjectTool).not.toHaveBeenCalled();
  });

  it('validates selected requirements before any tool or build write', async () => {
    const ctx = await setup({ env: 'staging' });
    inspectConfigurationRequirements.mockResolvedValue({ valid: false, diagnostics: [{ code: 'COSSACK_CONFIG_REQUIRED_MISSING', severity: 'error', message: 'Configuration variable PORT is required.' }] });
    expect(await deployCommand([], ctx)).toBe(1);
    expect(inspectConfigurationRequirements).toHaveBeenCalledWith(ctx.cwd, { environment: 'staging', check: true });
    expect(runProjectTool).not.toHaveBeenCalled();
    expect(inspectBuiltDeployment).not.toHaveBeenCalled();
    expect(JSON.parse(ctx.log.mock.calls[0][0])).toMatchObject({ ok: false, data: { steps: [], configurationRequirements: { valid: false } } });
  });

  it.each([{ env: true }, { env: ['staging', 'production'] }, { typo: true }])('rejects ambiguous options %j', async flags => {
    const ctx = await setup(flags);
    expect(await deployCommand([], ctx)).toBe(1);
    expect(inspectDeployment).not.toHaveBeenCalled();
  });
});
