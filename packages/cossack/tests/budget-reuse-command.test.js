import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildCommand } from '../src/commands/build.js';
import { deployCommand } from '../src/commands/deploy.js';
import { readBudgetBatchReceipt, checkBuildBudgets, evaluateBuildBudgets } from '../src/build-budgets.js';
import { inspectDeployment, inspectBuiltDeployment } from '../src/deployment.js';
import { inspectConfigurationRequirements } from '../src/config-inspection.js';
import { runProjectTool, runProjectToolCaptured } from '../src/project-tools.js';
vi.mock('../src/build-budgets.js', async original => ({ ...await original(), readBudgetBatchReceipt: vi.fn(), checkBuildBudgets: vi.fn() }));
vi.mock('../src/deployment.js', () => ({ inspectDeployment: vi.fn(), inspectBuiltDeployment: vi.fn() }));
vi.mock('../src/config-inspection.js', () => ({ inspectConfigurationRequirements: vi.fn() }));
vi.mock('../src/spawn.js', () => ({ run: vi.fn(), runCaptured: vi.fn() }));
vi.mock('../src/project-tools.js', () => ({ runProjectTool: vi.fn(), runProjectToolCaptured: vi.fn() }));
const roots = [];
afterEach(async () => { vi.resetAllMocks(); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-receipt-command-')); roots.push(root);
  const budgets = { uploadKiB: { error: 100 } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: budgets } }));
  inspectDeployment.mockResolvedValue({ config: {}, summary: { worker: 'selected', configPath: path.join(root, 'wrangler.jsonc') }, diagnostics: [] });
  inspectBuiltDeployment.mockResolvedValue(path.join(root, 'dist/ssr/wrangler.json'));
  inspectConfigurationRequirements.mockResolvedValue({ valid: true, diagnostics: [] });
  runProjectToolCaptured.mockResolvedValue({ code: 0 }); runProjectTool.mockResolvedValue(0);
  const pass = evaluateBuildBudgets(budgets, 'Total Upload: 10.00 KiB / gzip: 1.00 KiB');
  checkBuildBudgets.mockResolvedValue(pass); readBudgetBatchReceipt.mockResolvedValue({ primary: pass, auxiliary: { workers: [], diagnostics: [], valid: true } });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  return { root, budgets, pass, log, ctx: { cwd: root, flags: { json: true, env: 'staging' }, dryRun: true } };
}
it.each(['build', 'deploy'])('%s reuses a verified successful receipt without another measurement', async command => {
  const f = await setup(); expect(await (command === 'build' ? buildCommand : deployCommand)([], f.ctx)).toBe(0);
  expect(checkBuildBudgets).not.toHaveBeenCalled();
  expect(readBudgetBatchReceipt).toHaveBeenCalledWith(f.root, path.join(f.root, 'dist/ssr/wrangler.json'), f.budgets, 'staging', expect.stringMatching(/^[a-f\d-]{36}$/), []);
  const report = JSON.parse(f.log.mock.calls.at(-1)[0]); expect(report.data.buildBudgets).toEqual(f.pass);
  if (command === 'deploy') expect(runProjectTool).toHaveBeenCalledTimes(2);
});
it.each(['build', 'deploy'])('%s preserves structured budget failure when the plugin rejects', async command => {
  const f = await setup();
  readBudgetBatchReceipt.mockResolvedValue({ primary: evaluateBuildBudgets(f.budgets, 'Total Upload: 200.00 KiB / gzip: 1.00 KiB'), auxiliary: { workers: [], diagnostics: [], valid: true } });
  runProjectToolCaptured.mockResolvedValue({ code: 1 }); runProjectTool.mockImplementation(async (_, tool) => tool === 'vite' ? 1 : 0);
  expect(await (command === 'build' ? buildCommand : deployCommand)([], f.ctx)).toBe(1);
  expect(checkBuildBudgets).not.toHaveBeenCalled();
  const report = JSON.parse(f.log.mock.calls.at(-1)[0]); expect(report.diagnostics[0].code).toBe('COSSACK_BUILD_BUDGET_EXCEEDED');
  expect(report.data.buildBudgets.valid).toBe(false);
  if (command === 'deploy') { expect(report.data.steps.map(step => step.name)).toEqual(['types', 'build', 'budgets']); expect(report.data.steps[1].exitCode).toBe(1); }
});
it.each(['build', 'deploy'])('%s does not disguise unrelated failures with a passing receipt', async command => {
  const f = await setup(); runProjectToolCaptured.mockResolvedValue({ code: 1 }); runProjectTool.mockImplementation(async (_, tool) => tool === 'vite' ? 1 : 0);
  expect(await (command === 'build' ? buildCommand : deployCommand)([], f.ctx)).toBe(1);
  expect(checkBuildBudgets).not.toHaveBeenCalled();
  expect(JSON.parse(f.log.mock.calls.at(-1)[0]).diagnostics[0].code).toBe(command === 'build' ? 'COSSACK_BUILD_FAILED' : 'COSSACK_DEPLOY_BUILD_FAILED');
});
it.each(['build', 'deploy'])('%s measures once when a successful build has no reusable receipt', async command => {
  const f = await setup(); readBudgetBatchReceipt.mockResolvedValue(undefined);
  expect(await (command === 'build' ? buildCommand : deployCommand)([], f.ctx)).toBe(0); expect(checkBuildBudgets).toHaveBeenCalledOnce();
});
it.each(['build', 'deploy'])('%s stops if budget settings changed during the build', async command => {
  const f = await setup();
  const change = () => fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: { uploadKiB: { error: 1 } } } }));
  runProjectToolCaptured.mockImplementation(async () => { await change(); return { code: 0 }; });
  runProjectTool.mockImplementation(async (_, tool) => { if (tool === 'vite') await change(); return 0; });
  expect(await (command === 'build' ? buildCommand : deployCommand)([], f.ctx)).toBe(1); expect(checkBuildBudgets).not.toHaveBeenCalled();
  expect(JSON.parse(f.log.mock.calls.at(-1)[0]).diagnostics[0].code).toBe('COSSACK_BUILD_BUDGET_SETTINGS_CHANGED');
});
