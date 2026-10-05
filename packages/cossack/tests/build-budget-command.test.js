import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildCommand } from '../src/commands/build.js';
import { inspectDeployment, inspectBuiltDeployment } from '../src/deployment.js';
import { runProjectTool, runProjectToolCaptured } from '../src/project-tools.js';
vi.mock('../src/spawn.js', () => ({ run: vi.fn(), runCaptured: vi.fn() }));
vi.mock('../src/deployment.js', () => ({ inspectDeployment: vi.fn(), inspectBuiltDeployment: vi.fn() }));
vi.mock('../src/project-tools.js', () => ({ runProjectTool: vi.fn(), runProjectToolCaptured: vi.fn() }));
let root;
afterEach(async () => { vi.resetAllMocks(); vi.restoreAllMocks(); if (root) await fs.rm(root, { recursive: true, force: true }); });
it('does not expose malformed manifest values through human build diagnostics', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-build-budget-command-'));
  await fs.writeFile(path.join(root, 'package.json'), '{"token":"PRIVATE_MANIFEST_TOKEN",bad}');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await buildCommand([], { cwd: root, flags: {} })).toBe(1);
  expect(error).toHaveBeenCalledExactlyOnceWith('Cannot read project build budgets. Check package.json.');
  expect(runProjectToolCaptured).not.toHaveBeenCalled();
});
it('checks fresh built artifacts and fails an exceeded build budget in one safe envelope', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-build-budget-command-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: { uploadKiB: { error: 1 } } } }));
  const metadata = path.join(root, '.wrangler/deploy/config.json');
  await fs.mkdir(path.dirname(metadata), { recursive: true }); await fs.writeFile(metadata, '{}');
  inspectDeployment.mockResolvedValue({ config: {}, diagnostics: [] });
  inspectBuiltDeployment.mockResolvedValue('/verified/wrangler.json');
  runProjectToolCaptured.mockImplementation(async (_root, tool) => { await expect(fs.access(metadata)).rejects.toThrow(); return tool === 'vite' ? { code: 0 } : { code: 0, stdout: 'PRIVATE\nTotal Upload: 2.00 KiB / gzip: 0.50 KiB', stderr: '' }; });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await buildCommand([], { cwd: root, flags: { json: true, env: 'staging' } })).toBe(1);
  expect(inspectDeployment).toHaveBeenCalledWith(root, 'staging');
  expect(log).toHaveBeenCalledOnce();
  const report = JSON.parse(log.mock.calls[0][0]);
  expect(report).toMatchObject({ command: 'build', ok: false, data: { environment: 'staging', buildBudgets: { valid: false } } });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
});

it.each([true, false])('uses the project Vite executable without budgets (json=%s)', async json => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-project-vite-'));
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  runProjectToolCaptured.mockResolvedValue({ code: 0 }); runProjectTool.mockResolvedValue(0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await buildCommand(['--mode', 'staging'], { cwd: root, flags: { json, env: 'staging' } })).toBe(0);
  const tool = json ? runProjectToolCaptured : runProjectTool;
  expect(tool).toHaveBeenCalledExactlyOnceWith(root, 'vite', ['build', '--mode', 'staging'], expect.objectContaining({ env: { CLOUDFLARE_ENV: 'staging' }, cwd: root }));
});
