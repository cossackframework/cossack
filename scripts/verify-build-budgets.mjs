import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

/** Verify published plugin exports and the real Cloudflare application build. */
export async function verifyBuildBudgets(projectDir) {
  const files = ['package.json', 'wrangler.jsonc', 'vite.config.ts'];
  const saved = await Promise.all(files.map(file => fs.readFile(path.join(projectDir, file), 'utf8')));
  try {
    const manifest = JSON.parse(saved[0]);
    const config = JSON.parse(saved[1]);
    const source = saved[2];
    assert.ok(source.includes('cossackBuildBudgets()'), 'Cloudflare scaffold must include the build budget gate.');
    config.env ??= {};
    config.env.budgetAcceptance = { name: `${config.name}-budget`, vars: { ...config.vars, APP_URL: 'https://budget-acceptance.example.test', BUDGET_MARKER: 'PRIVATE_INSTALLED_BUDGET_SENTINEL' },
      secrets: config.secrets, durable_objects: config.durable_objects, d1_databases: config.d1_databases, kv_namespaces: config.kv_namespaces, r2_buckets: config.r2_buckets };
    await fs.writeFile(path.join(projectDir, 'wrangler.jsonc'), JSON.stringify(config));
    await fs.writeFile(path.join(projectDir, 'vite.config.ts'), source);
    const require = createRequire(path.join(projectDir, 'package.json'));
    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    const build = () => exec(process.execPath, [vite, 'build'], { cwd: projectDir, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_ENV: 'budgetAcceptance', WRANGLER_SEND_METRICS: 'false' } });
    manifest.cossack = { ...manifest.cossack, buildBudgets: { uploadKiB: { warning: 0.001 } } };
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(manifest));
    const warning = await build();
    const output = warning.stdout + warning.stderr;
    assert.ok(output.includes('COSSACK_BUILD_BUDGET_EXCEEDED'));
    assert.ok(!output.includes('PRIVATE_INSTALLED_BUDGET_SENTINEL'));
    const redirect = JSON.parse(await fs.readFile(path.join(projectDir, '.wrangler/deploy/config.json'), 'utf8'));
    const artifact = JSON.parse(await fs.readFile(path.resolve(projectDir, '.wrangler/deploy', redirect.configPath), 'utf8'));
    assert.equal(artifact.name, config.env.budgetAcceptance.name);
    assert.equal(artifact.vars.APP_URL, config.env.budgetAcceptance.vars.APP_URL);
    manifest.cossack.buildBudgets = { uploadKiB: { error: 0.001 } };
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(manifest));
    try { await build(); assert.fail('Installed direct Vite must reject the hard size budget.'); }
    catch (error) {
      assert.equal(error.code, 1);
      const diagnostic = String(error.stdout ?? '') + String(error.stderr ?? '');
      assert.ok(diagnostic.includes('COSSACK_BUILD_BUDGET_EXCEEDED'));
      assert.ok(!diagnostic.includes('PRIVATE_INSTALLED_BUDGET_SENTINEL'));
    }
    // Final deployment reads a flattened target, so source environment selection
    // must not be applied again by the installed CLI's Wrangler invocation.
    manifest.cossack.buildBudgets = {};
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(manifest));
    const cliDirectory = await fs.realpath(path.join(projectDir, 'node_modules/cossack'));
    assert.ok(cliDirectory.startsWith(projectDir + path.sep), 'Use the installed tarball CLI.');
    const deployed = await exec(process.execPath, [path.join(cliDirectory, 'bin/cossack.js'), 'deploy', '--dry-run', '--env', 'budgetAcceptance', '--json'], {
      cwd: projectDir, timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    const report = JSON.parse(deployed.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.data.worker, config.env.budgetAcceptance.name);
    assert.deepEqual(report.data.steps.map(step => step.name), ['types', 'build', 'deploy']);
    assert.ok(!deployed.stdout.includes('PRIVATE_INSTALLED_BUDGET_SENTINEL'));
    manifest.cossack.buildBudgets = { uploadKiB: { warning: 0.001 } };
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(manifest));
    const cliArgs = [path.join(cliDirectory, 'bin/cossack.js'), 'deploy', '--dry-run', '--env', 'budgetAcceptance', '--json'];
    const cliOptions = { cwd: projectDir, timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } };
    const accepted = await exec(process.execPath, cliArgs, cliOptions);
    const budgetReport = JSON.parse(accepted.stdout);
    assert.equal(budgetReport.ok, true);
    assert.deepEqual(budgetReport.data.steps.map(step => step.name), ['types', 'build', 'budgets']);
    assert.equal(budgetReport.data.buildBudgets.valid, true);
    assert.ok(budgetReport.data.buildBudgets.measurements[0].value > 0);
    assert.ok(!accepted.stdout.includes('PRIVATE_INSTALLED_BUDGET_SENTINEL'));
    const receipt = await fs.readFile(path.join(projectDir, '.cossack/build-budget-receipt.json'), 'utf8');
    assert.match(JSON.parse(receipt).signature, /^[a-f\d]{64}$/);
    assert.ok(!receipt.includes('PRIVATE_INSTALLED_BUDGET_SENTINEL'));
    manifest.cossack.buildBudgets = { uploadKiB: { error: 0.001 } };
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(manifest));
    try { await exec(process.execPath, cliArgs, cliOptions); assert.fail('Installed CLI must reject the hard size budget.'); }
    catch (error) {
      assert.equal(error.code, 1);
      const rejected = JSON.parse(error.stdout);
      assert.equal(rejected.ok, false);
      assert.equal(rejected.data.buildBudgets.valid, false);
      assert.deepEqual(rejected.diagnostics.map(item => item.code), ['COSSACK_BUILD_BUDGET_EXCEEDED']);
      assert.ok(!error.stdout.includes('PRIVATE_INSTALLED_BUDGET_SENTINEL'));
    }
    console.log('Installed CLI signed budget receipt, warning and structured hard rejection verified.');
    console.log('Installed CLI selected-target artifact dry run verified.');
    console.log('Installed direct Vite budget warnings, rejection, selected target and private measurement verified.');
  } finally {
    await Promise.all(files.map((file, index) => fs.writeFile(path.join(projectDir, file), saved[index])));
  }
}
