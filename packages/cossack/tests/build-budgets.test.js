import { afterEach, expect, it, vi } from 'vitest';
import { evaluateBuildBudgets, readBuildBudgets, checkBuildBudgets } from '../src/build-budgets.js';
import { runProjectToolCaptured } from '../src/project-tools.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runCaptured } from '../src/spawn.js';
vi.mock('../src/project-tools.js', () => ({ runProjectToolCaptured: vi.fn() }));
const roots = [];
it('bounds private measurement capture and reports overflow as a failure', async () => {
  const result = await runCaptured(process.execPath, ['-e', "process.stdout.write('x'.repeat(4096))"], { shell: false, maxOutputBytes: 100 });
  expect(result.code).toBe(1); expect(result.outputTruncated).toBe(true);
  expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(100);
});
afterEach(async () => { vi.resetAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
it('reports measured size and fails an error limit without leaking private tool output', () => {
  const result = evaluateBuildBudgets({ uploadKiB: { error: 10 }, gzipUploadKiB: { warning: 2 } }, 'SECRET_BINDING=PRIVATE\nTotal Upload: 20.00 KiB / gzip: 3.00 KiB\n');
  expect(result.valid).toBe(false);
  expect(result.measurements[0]).toMatchObject({ value: 20, resolution: 0.01 });
  expect(result.diagnostics.map(d => d.severity)).toEqual(['error', 'warning']);
  expect(result.diagnostics[0].message).toContain('limit 10 KiB');
  expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE/);
});
it('accepts warning-only regressions and handles rounding boundaries conservatively', () => {
  expect(evaluateBuildBudgets({ uploadKiB: { warning: 10 } }, 'Total Upload: 20.00 KiB / gzip: 1.00 KiB').valid).toBe(true);
  expect(evaluateBuildBudgets({ uploadKiB: { error: 20 } }, 'Total Upload: 20.00 KiB / gzip: 1.00 KiB').valid).toBe(false);
  expect(evaluateBuildBudgets({ uploadKiB: { error: 20.01 } }, 'Total Upload: 20.00 KiB / gzip: 1.00 KiB').valid).toBe(true);
});
it('never claims provider startup or ambiguous size reports passed', () => {
  expect(evaluateBuildBudgets({ providerStartupMs: { error: 100 } }, 'Worker Startup Time: 1 ms').valid).toBe(false);
  expect(evaluateBuildBudgets({ uploadKiB: { error: 100 } }, 'Total Upload: 1 KiB / gzip: 1 KiB\nTotal Upload: 2 KiB / gzip: 2 KiB').measurements[0].status).toBe('unavailable');
});
it.each([{ secret: { error: 2 } }, { uploadKiB: { error: -1 } }, { uploadKiB: { warning: 10, error: 2 } }, { uploadKiB: {} }])('rejects malformed literal settings %j', async buildBudgets => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-budgets-')); roots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ cossack: { buildBudgets } }));
  await expect(readBuildBudgets(root)).rejects.toMatchObject({ code: 'COSSACK_BUILD_BUDGET_INVALID' });
});
it('measures only the verified artifact using a local dry run', async () => {
  runProjectToolCaptured.mockResolvedValue({ code: 0, stdout: 'Total Upload: 10.00 KiB / gzip: 1.00 KiB', stderr: 'SECRET' });
  expect((await checkBuildBudgets('/project', '/verified/wrangler.json', { uploadKiB: { error: 20 } })).valid).toBe(true);
  expect(runProjectToolCaptured).toHaveBeenCalledExactlyOnceWith('/project', 'wrangler', ['deploy', '--dry-run', '--config', '/verified/wrangler.json'], { env: { CLOUDFLARE_ENV: '' }, maxOutputBytes: 1024 * 1024 });
});
it('fails measurement without returning arbitrary stderr', async () => {
  runProjectToolCaptured.mockResolvedValue({ code: 2, stdout: 'PRIVATE', stderr: 'SECRET' });
  const result = await checkBuildBudgets('/project', '/verified/wrangler.json', { uploadKiB: { error: 20 } });
  expect(result.valid).toBe(false); expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET/);
});
it('sanitizes tool resolution and invocation rejections', async () => {
  runProjectToolCaptured.mockRejectedValue(new Error('PRIVATE_TOOL_RESOLUTION'));
  const result = await checkBuildBudgets('/project', '/verified/wrangler.json', { uploadKiB: { error: 20 } });
  expect(result.valid).toBe(false); expect(JSON.stringify(result)).not.toContain('PRIVATE_TOOL_RESOLUTION');
});

it.each(['Total Upload: 1 KiB / gzip: 1 KiB', 'Total Upload: 1.0 KiB / gzip: 1.0 KiB'])('rejects unsupported summary precision: %s', output => {
  expect(evaluateBuildBudgets({ uploadKiB: { error: 1.01 } }, output).valid).toBe(false);
});
