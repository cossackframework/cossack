import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

/** Installed-package acceptance for custom primary config selection and watch policy. */
export async function verifyBudgetBuildModes(projectDir) {
  const files = ['package.json', 'wrangler.jsonc', 'vite.config.ts'];
  const saved = await Promise.all(files.map(file => fs.readFile(path.join(projectDir, file), 'utf8')));
  const custom = `.cossack/budget-source-${randomUUID()}.jsonc`;
  try {
    const manifest = JSON.parse(saved[0]);
    manifest.cossack = { ...manifest.cossack, buildBudgets: { uploadKiB: { error: 100000 } } };
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(manifest));
    const config = JSON.parse(saved[1]);
    config.main = path.resolve(projectDir, config.main);
    for (const target of [config, ...Object.values(config.env ?? {})]) {
      for (const database of target.d1_databases ?? []) if (database.migrations_dir) database.migrations_dir = path.resolve(projectDir, database.migrations_dir);
    }
    config.vars = { ...config.vars, APP_URL: 'https://custom-budget-acceptance.example.test', BUDGET_MARKER: 'PRIVATE_CUSTOM_BUDGET_SENTINEL' };
    await fs.mkdir(path.join(projectDir, '.cossack'), { recursive: true });
    await fs.writeFile(path.join(projectDir, custom), JSON.stringify(config));
    await fs.rm(path.join(projectDir, 'wrangler.jsonc'));
    const require = createRequire(path.join(projectDir, 'package.json'));
    const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    const cli = await fs.realpath(path.join(projectDir, 'node_modules/cossack'));
    assert.ok(cli.startsWith(projectDir + path.sep), 'Use the installed tarball CLI.');
    const options = { cwd: projectDir, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_ENV: '', CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: custom, WRANGLER_SEND_METRICS: 'false', APP_URL: '' } };
    const urlScript = "import { getSiteUrl } from '@cossackframework/framework/ssg-config'; console.log(getSiteUrl({ projectRoot: process.cwd() }));";
    const discovered = await exec(process.execPath, ['--input-type=module', '-e', urlScript], options);
    assert.equal(discovered.stdout.trim(), config.vars.APP_URL);
    for (const command of [['build', '--json'], ['deploy', '--dry-run', '--json']]) {
      const result = await exec(process.execPath, [path.join(cli, 'bin/cossack.js'), ...command], options);
      const report = JSON.parse(result.stdout);
      assert.equal(report.ok, true);
      assert.equal(report.data.buildBudgets.valid, true);
      assert.ok(report.data.buildBudgets.measurements[0].value > 0);
      assert.ok(!result.stdout.includes('PRIVATE_CUSTOM_BUDGET_SENTINEL'));
      assert.match(JSON.parse(await fs.readFile(path.join(projectDir, '.cossack/build-budget-receipt.json'), 'utf8')).signature, /^[a-f\d]{64}$/);
    }
    const source = saved[2];
    assert.ok(source.includes('cloudflare({') && source.includes('cossackBuildBudgets()') && source.includes('cossackConfig()') && source.includes('cossackPages({'));
    const literal = JSON.stringify(custom);
    await fs.writeFile(path.join(projectDir, 'vite.config.ts'), source.replace('cloudflare({', `cloudflare({ configPath: ${literal},`)
      .replace('cossackBuildBudgets()', `cossackBuildBudgets({ configPath: ${literal} })`)
      .replace('cossackConfig()', `cossackConfig({ configPath: ${literal} })`)
      .replace('cossackPages({', `cossackPages({ configPath: ${literal},`));
    options.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH = '';
    const explicitUrlScript = `import { getSiteUrl } from '@cossackframework/framework/ssg-config'; console.log(getSiteUrl({ projectRoot: process.cwd(), configPath: ${literal} }));`;
    const explicitUrl = await exec(process.execPath, ['--input-type=module', '-e', explicitUrlScript], options);
    assert.equal(explicitUrl.stdout.trim(), config.vars.APP_URL);
    await exec(process.execPath, [vite, 'build'], options);
    await fs.rm(path.join(projectDir, '.cossack/build-budget-receipt.json'), { force: true });
    try { await exec(process.execPath, [vite, 'build', '--watch'], { ...options, timeout: 15000 }); assert.fail('Budgeted watch mode must reject.'); }
    catch (error) {
      assert.equal(error.code, 1);
      const output = String(error.stdout ?? '') + String(error.stderr ?? '');
      assert.ok(output.includes('COSSACK_BUILD_BUDGET_WATCH_UNSUPPORTED'));
      assert.ok(!output.includes('PRIVATE_CUSTOM_BUDGET_SENTINEL'));
    }
    await assert.rejects(fs.access(path.join(projectDir, '.cossack/build-budget-receipt.json')));
    console.log('Installed custom source config, CLI build/deploy receipts, explicit Vite options, public SSG URL discovery and prompt watch rejection verified.');
  } finally {
    await fs.rm(path.join(projectDir, custom), { force: true });
    await Promise.all(files.map((file, index) => fs.writeFile(path.join(projectDir, file), saved[index])));
  }
}
