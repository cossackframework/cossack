// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { checkBuildBudgets, type BudgetToolOptions, type BudgetToolRunner } from '../src/build-budgets';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const profile = {
  startTime: 1000, endTime: 201000,
  nodes: [
    { id: 1, callFrame: { functionName: 'PRIVATE_FUNCTION', url: 'PRIVATE_SOURCE_URL' } },
    { id: 2, callFrame: { functionName: '(idle)' } },
    { id: 3, callFrame: { functionName: '(garbage collector)' } },
  ],
  samples: [1, 2, 3], timeDeltas: [100000, 50000, 50000],
};
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'cossack-startup-test-')); roots.push(root);
  return { root, artifact: path.join(root, 'verified.json') };
}
function runner(change?: (output: string, options: BudgetToolOptions, invocation: number) => Promise<void>) {
  const calls: BudgetToolOptions[] = [];
  let directory = '';
  const run: BudgetToolRunner = async (_root, _artifact, options) => {
    calls.push(options);
    const args = options.toolArgs!;
    const output = args[args.indexOf('--outfile') + 1];
    directory = path.dirname(output);
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    if (change) await change(output, options, calls.length);
    else await fs.writeFile(output, calls.length === 1 ? 'PRIVATE_BINDING_VALUE' : JSON.stringify(profile));
    return { code: 0, stdout: 'PRIVATE_STDOUT\nTotal Upload: 1.00 KiB / gzip: 0.50 KiB\n' };
  };
  return { run, calls, directory: () => directory };
}
async function removed(directory: string) { await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' }); }

it('measures local window and active samples, including GC, without claiming provider startup', async () => {
  const { root, artifact } = await fixture(); const tool = runner();
  const result = await checkBuildBudgets(root, artifact, {
    localStartupProfileMs: { warning: 100, error: 300 }, localStartupActiveMs: { error: 100 },
    uploadKiB: { error: 2 }, providerStartupMs: { warning: 100 },
  }, { run: tool.run, timeoutMs: 1234, env: { CLOUDFLARE_ENV: 'staging' } });
  expect(result.valid).toBe(false);
  expect(result.measurements).toEqual(expect.arrayContaining([
    expect.objectContaining({ metric: 'localStartupProfileMs', value: 200, unit: 'ms', resolution: 0.001, source: 'wrangler-local-startup-profile' }),
    expect.objectContaining({ metric: 'localStartupActiveMs', value: 150, unit: 'ms' }),
    expect.objectContaining({ metric: 'uploadKiB', value: 1 }),
    expect.objectContaining({ metric: 'providerStartupMs', status: 'unavailable' }),
  ]));
  expect(result.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'COSSACK_BUILD_BUDGET_EXCEEDED', severity: 'warning' }),
    expect.objectContaining({ code: 'COSSACK_BUILD_BUDGET_EXCEEDED', severity: 'error' }),
    expect.objectContaining({ code: 'COSSACK_BUILD_BUDGET_UNAVAILABLE', severity: 'warning' }),
  ]));
  expect(tool.calls).toHaveLength(2);
  expect(tool.calls[0].toolArgs).toEqual(['deploy', '--dry-run', '--config', artifact, '--outfile', path.join(tool.directory(), 'worker.bundle')]);
  expect(tool.calls[1].toolArgs).toEqual(['check', 'startup', '--worker', path.join(tool.directory(), 'worker.bundle'), '--outfile', path.join(tool.directory(), 'startup.cpuprofile')]);
  for (const call of tool.calls) expect(call).toMatchObject({ timeoutMs: 1234, maxOutputBytes: 1024 * 1024, env: { CLOUDFLARE_ENV: '' } });
  for (const secret of ['PRIVATE_FUNCTION', 'PRIVATE_SOURCE_URL', 'PRIVATE_BINDING_VALUE', 'PRIVATE_STDOUT', tool.directory()]) expect(JSON.stringify(result)).not.toContain(secret);
  await removed(tool.directory());
});

it('cleans private files after a successful startup budget check', async () => {
  const { root, artifact } = await fixture(); const tool = runner();
  const result = await checkBuildBudgets(root, artifact, { localStartupProfileMs: { error: 200 }, localStartupActiveMs: { error: 150 } }, { run: tool.run });
  expect(result.valid).toBe(true); await removed(tool.directory());
});

it('does not invent active time when the profiler has no samples', async () => {
  const { root, artifact } = await fixture();
  const tool = runner(async (output, _options, invocation) => fs.writeFile(output, invocation === 1 ? 'bundle' : JSON.stringify({ ...profile, samples: [], timeDeltas: [] })));
  const result = await checkBuildBudgets(root, artifact, { localStartupProfileMs: { error: 300 }, localStartupActiveMs: { error: 300 } }, { run: tool.run });
  expect(result.valid).toBe(false);
  expect(result.measurements).toEqual(expect.arrayContaining([expect.objectContaining({ metric: 'localStartupProfileMs', value: 200 }), expect.objectContaining({ metric: 'localStartupActiveMs', status: 'unavailable' })]));
  await removed(tool.directory());
});

it('does not generate private startup files or invoke the profiler for size-only budgets', async () => {
  const { root, artifact } = await fixture(); const calls: BudgetToolOptions[] = [];
  const result = await checkBuildBudgets(root, artifact, { uploadKiB: { error: 2 } }, { run: async (_root, _artifact, options) => { calls.push(options); return { code: 0, stdout: 'Total Upload: 1.00 KiB / gzip: 0.50 KiB' }; } });
  expect(result.valid).toBe(true); expect(calls).toHaveLength(1); expect(calls[0].toolArgs).toBeUndefined();
});

describe('startup measurement fails closed and cleans private artifacts', () => {
  it.each(['dry-run-failure', 'profile-failure', 'throw', 'missing-bundle', 'missing-profile', 'malformed-json', 'invalid-profile', 'bundle-symlink', 'profile-symlink', 'oversized-bundle', 'oversized-profile'])( '%s', async failure => {
    const { root, artifact } = await fixture(); let directory = ''; let calls = 0;
    const run: BudgetToolRunner = async (_root, _artifact, options) => {
      calls++; const args = options.toolArgs!; const output = args[args.indexOf('--outfile') + 1]; directory = path.dirname(output);
      if (failure === 'throw') throw new Error('PRIVATE_FAILURE');
      if ((failure === 'dry-run-failure' && calls === 1) || (failure === 'profile-failure' && calls === 2)) return { code: 1, stdout: 'PRIVATE_FAILURE' };
      if ((failure === 'missing-bundle' && calls === 1) || (failure === 'missing-profile' && calls === 2)) return { code: 0 };
      if ((failure === 'bundle-symlink' && calls === 1) || (failure === 'profile-symlink' && calls === 2)) {
        const target = path.join(root, 'private-target'); await fs.writeFile(target, 'PRIVATE_FAILURE'); await fs.symlink(target, output);
      } else if ((failure === 'oversized-bundle' && calls === 1) || (failure === 'oversized-profile' && calls === 2)) {
        const handle = await fs.open(output, 'w'); await handle.truncate(64 * 1024 * 1024 + 1); await handle.close();
      } else await fs.writeFile(output, calls === 1 ? 'bundle' : failure === 'malformed-json' ? 'PRIVATE_FAILURE' : failure === 'invalid-profile' ? JSON.stringify({ startTime: 100, endTime: 10 }) : JSON.stringify(profile));
      return { code: 0, stdout: 'PRIVATE_STDOUT\nTotal Upload: 1.00 KiB / gzip: 0.50 KiB\n' };
    };
    const result = await checkBuildBudgets(root, artifact, { localStartupProfileMs: { error: 300 } }, { run });
    expect(result).toMatchObject({ valid: false, measurements: [], diagnostics: [{ code: 'COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED', severity: 'error' }] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|cossack-startup-budget/);
    if (['dry-run-failure', 'throw', 'missing-bundle', 'bundle-symlink', 'oversized-bundle'].includes(failure)) expect(calls).toBe(1);
    await removed(directory);
  });
});
