import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

/** Installed local multi-Worker acceptance; no auxiliary upload is performed. */
export async function verifyAuxiliaryBuildBudgets(projectDir) {
  const files = ['package.json', 'wrangler.jsonc', 'vite.config.ts'];
  const saved = await Promise.all(files.map(file => fs.readFile(path.join(projectDir, file), 'utf8')));
  const directory = `.cossack/auxiliary-budget-${randomUUID()}`;
  const configPath = `${directory}/wrangler.jsonc`;
  try {
    const manifest = JSON.parse(saved[0]);
    manifest.cossack = { ...manifest.cossack, buildBudgets: {}, auxiliaryBuildBudgets: [{ configPath, budgets: { uploadKiB: { warning: 0.001 } } }] };
    const config = JSON.parse(saved[1]);
    config.vars = { ...config.vars, APP_URL: 'https://auxiliary-budget.example.test' };
    await fs.writeFile(path.join(projectDir, files[0]), JSON.stringify(manifest));
    await fs.writeFile(path.join(projectDir, files[1]), JSON.stringify(config));
    await fs.mkdir(path.join(projectDir, directory), { recursive: true });
    await fs.writeFile(path.join(projectDir, directory, 'worker.ts'), 'export default {fetch(){return new Response("jobs")}};');
    await fs.writeFile(path.join(projectDir, configPath), JSON.stringify({ name: `cossack-budget-jobs-${randomUUID().slice(0, 8)}`, main: 'worker.ts', compatibility_date: '2026-01-01', vars: { PRIVATE: 'PRIVATE_AUXILIARY_SENTINEL' } }));
    assert.ok(saved[2].includes('cloudflare({'));
    await fs.writeFile(path.join(projectDir, files[2]), saved[2].replace('cloudflare({', `cloudflare({ auxiliaryWorkers: [{ configPath: ${JSON.stringify(configPath)} }],`));
    const cli = await fs.realpath(path.join(projectDir, 'node_modules/cossack'));
    assert.ok(cli.startsWith(projectDir + path.sep), 'Use the installed CLI.');
    const options = { cwd: projectDir, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_ENV: '', CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: '', WRANGLER_SEND_METRICS: 'false', APP_URL: '' } };
    for (const command of [['build', '--json'], ['deploy', '--dry-run', '--json']]) {
      const { stdout } = await exec(process.execPath, [path.join(cli, 'bin/cossack.js'), ...command], options);
      const report = JSON.parse(stdout);
      assert.equal(report.ok, true);
      assert.equal(report.data.auxiliaryBuildBudgets.valid, true);
      assert.equal(report.data.auxiliaryBuildBudgets.workers[0].configPath, configPath);
      assert.ok(report.data.auxiliaryBuildBudgets.workers[0].buildBudgets.measurements[0].value > 0);
      assert.ok(report.diagnostics.some(item => item.code === 'COSSACK_BUILD_BUDGET_EXCEEDED' && item.severity === 'warning'));
      assert.ok(!stdout.includes('PRIVATE_AUXILIARY_SENTINEL'));
      await assert.rejects(fs.access(path.join(projectDir, '.cossack/build-budget-receipt.json')));
    }
    manifest.cossack.auxiliaryBuildBudgets[0].budgets = { uploadKiB: { error: 0.001 } };
    await fs.writeFile(path.join(projectDir, files[0]), JSON.stringify(manifest));
    try { await exec(process.execPath, [path.join(cli, 'bin/cossack.js'), 'build', '--json'], options); assert.fail('Hard auxiliary budgets must reject.'); }
    catch (error) {
      assert.equal(error.code, 1);
      const report = JSON.parse(error.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.diagnostics[0].code, 'COSSACK_BUILD_FAILED');
      assert.ok(!error.stdout.includes('PRIVATE_AUXILIARY_SENTINEL'));
    }
    console.log('Installed auxiliary-only multi-Worker build/deploy validation, warning measurements, privacy and hard failure verified; no auxiliary upload.');
  } finally {
    await fs.rm(path.join(projectDir, directory), { recursive: true, force: true });
    await Promise.all(files.map((file, index) => fs.writeFile(path.join(projectDir, file), saved[index])));
  }
}
