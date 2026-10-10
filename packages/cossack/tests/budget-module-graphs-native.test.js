import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createBudgetModuleGraphFixture } from './fixtures/budget-module-graphs-native.js';

const installedRoot = process.env.COSSACK_BUDGET_GRAPH_INSTALLED_ROOT;
it.each(['dynamic', 'rebundled'])('enforces real native Wrangler budgets for the %s module graph', async mode => {
  const fixture = await createBudgetModuleGraphFixture(mode, installedRoot);
  try {
    const warned = await fixture.invoke();
    expect(warned.code, JSON.stringify(warned.report)).toBe(0);
    expect(warned.report.diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_BUILD_BUDGET_EXCEEDED', severity: 'warning' }));
    expect(warned.report.data.buildBudgets.measurements).toContainEqual(expect.objectContaining({ metric: 'uploadKiB', status: 'measured', source: 'wrangler-dry-run', value: expect.any(Number) }));
    expect(warned.stdout).not.toMatch(/PRIVATE_GRAPH|PRIVATE_EXTERNAL/);
    const redirect = JSON.parse(await fs.readFile(path.join(fixture.root, '.wrangler/deploy/config.json'), 'utf8'));
    const artifact = path.resolve(fixture.root, '.wrangler/deploy', redirect.configPath);
    const config = JSON.parse(await fs.readFile(artifact, 'utf8'));
    const entries = await fs.readdir(path.dirname(artifact), { recursive: true });
    expect(entries.some(name => /budget-lazy.*\.js$/.test(name))).toBe(true);
    expect(entries.some(name => name.endsWith('.map'))).toBe(true);
    const calls = await fixture.counts();
    expect(calls.filter(call => call.command === 'deploy' && call.phase === 'vite')).toHaveLength(1);
    expect(calls.filter(call => call.command === 'deploy' && call.phase === 'cli')).toHaveLength(mode === 'dynamic' ? 0 : 1);
    if (mode !== 'dynamic') expect(config.no_bundle).toBe(false);
    if (mode === 'rebundled') expect(await fs.readFile(path.resolve(path.dirname(artifact), config.main), 'utf8')).toContain('outside-output.js');
    await fixture.setBudgets(mode === 'rebundled' ? { gzipUploadKiB: { error: 0.001 }, uploadKiB: { error: 0.001 } } : { uploadKiB: { error: 0.001 } });
    const rejected = await fixture.invoke(); expect(rejected.code).toBe(1);
    // Unsupported receipt identity must preserve the failed build classification;
    // it cannot authenticate even a genuine Vite budget failure.
    const code = mode === 'dynamic' ? 'COSSACK_BUILD_BUDGET_EXCEEDED' : 'COSSACK_BUILD_FAILED';
    expect(rejected.report.diagnostics).toContainEqual(expect.objectContaining({ code, severity: 'error' }));
    expect(rejected.stdout).not.toMatch(/PRIVATE_GRAPH|PRIVATE_EXTERNAL/);
    if (mode !== 'dynamic') {
      const direct = await fixture.invokeVite();
      expect(direct.code).toBe(1);
      expect(direct.stdout + direct.stderr).toContain('COSSACK_BUILD_BUDGET_EXCEEDED');
      expect(direct.stdout + direct.stderr).not.toMatch(/PRIVATE_GRAPH_CONFIG|PRIVATE_EXTERNAL_SOURCE/);
    }
    await fixture.setBudgets({ uploadKiB: { error: 100000 } });
    await fs.writeFile(fixture.lazyFile, 'export const PRIVATE_COMPILER_SENTINEL = ;');
    const malformed = await fixture.invoke(); expect(malformed.code).toBe(1);
    expect(malformed.report.diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_BUILD_FAILED' }));
    expect(malformed.report.diagnostics.some(item => item.code === 'COSSACK_BUILD_BUDGET_EXCEEDED')).toBe(false);
    expect(malformed.stdout).not.toMatch(/PRIVATE_COMPILER|PRIVATE_GRAPH|PRIVATE_EXTERNAL/);
  } finally { await fixture.cleanup(); }
}, 240000);

it.each(['dynamic', 'rebundled'])('enforces real native local startup budgets for the %s module graph', async mode => {
  const fixture = await createBudgetModuleGraphFixture(mode, installedRoot, { startup: true });
  const localMetrics = ['localStartupProfileMs', 'localStartupActiveMs'];
  const assertPrivateFilesRemoved = async () => {
    const outputs = (await fixture.counts()).filter(call => call.outputFile);
    expect(outputs.length).toBeGreaterThan(0);
    for (const call of outputs) {
      await expect(fs.access(call.outputFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.access(path.dirname(call.outputFile))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  };
  try {
    await fixture.setBudgets({
      localStartupProfileMs: { warning: 0.001, error: 100000 },
      localStartupActiveMs: { warning: 0.001, error: 100000 },
      providerStartupMs: { warning: 1000 },
    });
    const warned = await fixture.invoke();
    expect(warned.code, JSON.stringify(warned.report)).toBe(0);
    const measurements = warned.report.data.buildBudgets.measurements;
    for (const metric of localMetrics) {
      expect(measurements).toContainEqual(expect.objectContaining({ metric, status: 'measured', source: 'wrangler-local-startup-profile', unit: 'ms', resolution: 0.001, value: expect.any(Number) }));
      expect(measurements.find(item => item.metric === metric).value).toBeGreaterThan(0.001);
      expect(warned.report.diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_BUILD_BUDGET_EXCEEDED', severity: 'warning', message: expect.stringContaining(`${metric} measured`) }));
    }
    expect(measurements).toContainEqual(expect.objectContaining({ metric: 'providerStartupMs', status: 'unavailable' }));
    expect(warned.stdout).not.toMatch(/PRIVATE_GRAPH|PRIVATE_EXTERNAL|functionName|cpuprofile|startTime/);
    const redirect = JSON.parse(await fs.readFile(path.join(fixture.root, '.wrangler/deploy/config.json'), 'utf8'));
    const artifact = path.resolve(fixture.root, '.wrangler/deploy', redirect.configPath);
    const config = JSON.parse(await fs.readFile(artifact, 'utf8'));
    const entries = await fs.readdir(path.dirname(artifact), { recursive: true });
    expect(entries.some(name => /budget-lazy.*\.js$/.test(name))).toBe(true);
    expect(entries.some(name => name.endsWith('.map'))).toBe(true);
    if (mode !== 'dynamic') expect(config.no_bundle).toBe(false);
    if (mode === 'rebundled') expect(await fs.readFile(path.resolve(path.dirname(artifact), config.main), 'utf8')).toContain('outside-output.js');
    const calls = await fixture.counts();
    for (const command of ['deploy', 'check']) {
      expect(calls.filter(call => call.command === command && call.phase === 'vite')).toHaveLength(1);
      expect(calls.filter(call => call.command === command && call.phase === 'cli')).toHaveLength(mode === 'dynamic' ? 0 : 1);
    }
    await assertPrivateFilesRemoved();
    // Rebundled carries both local metrics through the CLI re-measurement path.
    const errorMetrics = mode === 'rebundled' ? ['localStartupActiveMs', 'localStartupProfileMs'] : ['localStartupProfileMs'];
    const errorMetric = errorMetrics[0];
    await fixture.setBudgets(Object.fromEntries(errorMetrics.map(metric => [metric, { error: 0.001 }])));
    const rejected = await fixture.invoke(); expect(rejected.code).toBe(1);
    expect(rejected.report.diagnostics).toContainEqual(expect.objectContaining({
      code: mode === 'dynamic' ? 'COSSACK_BUILD_BUDGET_EXCEEDED' : 'COSSACK_BUILD_FAILED', severity: 'error',
    }));
    if (mode === 'dynamic') {
      expect(rejected.report.data.buildBudgets.measurements).toContainEqual(expect.objectContaining({ metric: errorMetric, status: 'measured', value: expect.any(Number) }));
      const receipt = await fs.readFile(path.join(fixture.root, '.cossack/build-budget-receipt.json'), 'utf8');
      expect(receipt).not.toMatch(/PRIVATE|functionName|cpuprofile|startTime|outputFile/);
    } else {
      const direct = await fixture.invokeVite(); expect(direct.code).toBe(1);
      expect(direct.stdout + direct.stderr).toContain('COSSACK_BUILD_BUDGET_EXCEEDED');
      for (const metric of errorMetrics) expect(direct.stdout + direct.stderr).toContain(`${metric} measured`);
      expect(direct.stdout + direct.stderr).not.toMatch(/PRIVATE_GRAPH_CONFIG|PRIVATE_EXTERNAL_SOURCE|functionName|cpuprofile|startTime/);
    }
    expect(rejected.stdout).not.toMatch(/PRIVATE_GRAPH|PRIVATE_EXTERNAL|functionName|cpuprofile|startTime/);
    await assertPrivateFilesRemoved();
  } finally { await fixture.cleanup(); }
}, 240000);
