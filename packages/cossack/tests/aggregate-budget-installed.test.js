import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { runCaptured } from '../src/spawn.js';

const gate = process.env.COSSACK_AGGREGATE_INSTALLED_ROOT;

it.skipIf(!gate).each([false, true])('reuses native installed CLI measurement batches, auxiliary-only=%s', async auxiliaryOnly => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-installed-budget-batch-'));
  await fs.chmod(parent, 0o700);
  try {
    const require = createRequire(path.join(gate, 'package.json'));
    const scaffoldFile = require.resolve('@cossackframework/scaffold/package.json');
    const scaffold = JSON.parse(await fs.readFile(scaffoldFile, 'utf8'));
    const { createApp } = await import(pathToFileURL(path.resolve(path.dirname(scaffoldFile), scaffold.exports['.'].import)).href);
    const { projectDir: root } = await createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', interactive: false });
    const modules = path.join(root, 'node_modules'); await fs.mkdir(modules);
    for (const name of await fs.readdir(path.join(gate, 'node_modules'))) {
      if (name.startsWith('.') || name === 'wrangler') continue;
      await fs.symlink(path.join(gate, 'node_modules', name), path.join(modules, name), 'junction');
    }
    const nativeManifestFile = require.resolve('wrangler/package.json');
    const nativeManifest = JSON.parse(await fs.readFile(nativeManifestFile, 'utf8'));
    const nativeMain = require.resolve('wrangler');
    const nativeBin = path.resolve(path.dirname(nativeManifestFile), typeof nativeManifest.bin === 'string' ? nativeManifest.bin : nativeManifest.bin.wrangler);
    const counter = path.join(root, 'private-native-tool-counts.jsonl');
    const launcher = path.join(modules, 'wrangler'); await fs.mkdir(launcher);
    // Keep the native library entry intact. Only the CLI launcher records fixed
    // command/phase names, then runs the actual unchanged installed executable.
    await fs.writeFile(path.join(launcher, 'package.json'), JSON.stringify({ name: 'wrangler', version: nativeManifest.version, main: nativeMain, bin: { wrangler: 'launcher.cjs' } }));
    await fs.writeFile(path.join(launcher, 'launcher.cjs'), `
const fs=require('node:fs');
const command=['deploy','check','types'].includes(process.argv[2])?process.argv[2]:'other';
fs.appendFileSync(${JSON.stringify(counter)},JSON.stringify({command,phase:process.env.COSSACK_BUILD_BUDGET_RUN_ID?'vite':'cli'})+'\\n',{mode:0o600});
const {spawn}=require('node:child_process');
const child=spawn(process.execPath,[${JSON.stringify(nativeBin)},...process.argv.slice(2)],{stdio:'inherit'});
child.on('error',()=>process.exit(1));child.on('exit',code=>process.exit(code??1));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
`);
    const configFile = path.join(root, 'wrangler.jsonc');
    const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
    config.vars.APP_URL = 'https://installed-budget.example.test';
    await fs.writeFile(configFile, JSON.stringify(config));
    const manifestFile = path.join(root, 'package.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    manifest.cossack = auxiliaryOnly
      ? { auxiliaryBuildBudgets: ['jobs', 'events'].map(name => ({ configPath: `workers/${name}/wrangler.jsonc`, budgets: { uploadKiB: { warning: 0.001 } } })) }
      : { buildBudgets: { uploadKiB: { warning: 0.001 }, localStartupProfileMs: { error: 100000 } } };
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    if (auxiliaryOnly) {
      for (const name of ['jobs', 'events']) {
        const directory = path.join(root, 'workers', name); await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'worker.ts'), `export default {fetch(){return new Response(${JSON.stringify(name)})}};`);
        await fs.writeFile(path.join(directory, 'wrangler.jsonc'), JSON.stringify({ name: `installed-budget-${name}`, main: 'worker.ts', compatibility_date: '2026-01-01', vars: { PRIVATE: 'PRIVATE_INSTALLED_BUDGET_VALUE' } }));
      }
      const vite = path.join(root, 'vite.config.ts');
      await fs.writeFile(vite, (await fs.readFile(vite, 'utf8')).replace('cloudflare({', `cloudflare({auxiliaryWorkers:${JSON.stringify(manifest.cossack.auxiliaryBuildBudgets.map(policy => ({ configPath: policy.configPath })))},`));
    }
    const invoke = async args => {
      const result = await runCaptured(process.execPath, [path.join(gate, 'node_modules/cossack/bin/cossack.js'), ...args, '--json'], {
        cwd: root, shell: false, timeoutMs: 120000, maxOutputBytes: 2 * 1024 * 1024,
        env: { ...process.env, CLOUDFLARE_ENV: '', CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: '', NODE_ENV: 'production', VITEST: '', COSSACK_DISABLE_UPDATE_CHECK: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_LOG_PATH: path.join(root, 'private-wrangler.log') },
      });
      await fs.writeFile(path.join(root, 'private-cli.log'), result.stdout + result.stderr, { mode: 0o600 });
      expect(result.stdout).not.toContain('PRIVATE_INSTALLED_BUDGET_VALUE');
      return { code: result.code, value: JSON.parse(result.stdout) };
    };
    const counts = async () => (await fs.readFile(counter, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const built = await invoke(['build']); expect(built.code, JSON.stringify(built.value)).toBe(0); expect(built.value.ok).toBe(true);
    const deployed = await invoke(['deploy', '--dry-run']); expect(deployed.code).toBe(0); expect(deployed.value.ok).toBe(true);
    expect(deployed.value.data.steps.map(step => step.name)).toEqual(['types', 'build', 'budgets']);
    if (auxiliaryOnly) {
      expect(deployed.value.data.buildBudgets.measurements).toEqual([]);
      expect(deployed.value.data.auxiliaryBuildBudgets.workers).toHaveLength(2);
      manifest.cossack.auxiliaryBuildBudgets[0].budgets = { uploadKiB: { error: 0.001 } };
    } else {
      expect(deployed.value.data.buildBudgets.measurements).toContainEqual(expect.objectContaining({ metric: 'localStartupProfileMs', status: 'measured', source: 'wrangler-local-startup-profile' }));
      manifest.cossack.buildBudgets.uploadKiB = { error: 0.001 };
    }
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    const rejected = await invoke(['deploy', '--dry-run']); expect(rejected.code).toBe(1); expect(rejected.value.ok).toBe(false);
    expect(rejected.value.diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_BUILD_BUDGET_EXCEEDED', severity: 'error' }));
    expect(rejected.value.data.steps).toContainEqual(expect.objectContaining({ name: 'build', exitCode: 1 }));
    const entries = await counts();
    expect(entries.filter(entry => entry.phase === 'cli' && entry.command !== 'types')).toEqual([]);
    expect(entries.filter(entry => entry.phase === 'vite' && entry.command === 'deploy')).toHaveLength(auxiliaryOnly ? 6 : 3);
    expect(entries.filter(entry => entry.phase === 'vite' && entry.command === 'check')).toHaveLength(auxiliaryOnly ? 0 : 3);
    const receipt = await fs.readFile(path.join(root, '.cossack/build-budget-receipt.json'), 'utf8');
    expect(JSON.parse(receipt)).toMatchObject({ version: 2, workers: auxiliaryOnly ? [{ outcome: 'measured' }, { outcome: 'measured' }] : [] });
    expect(receipt).not.toMatch(/PRIVATE|functionName|cpuprofile|startTime|configPath/);
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
}, 240000);
