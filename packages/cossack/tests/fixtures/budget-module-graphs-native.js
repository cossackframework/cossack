import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runCaptured } from '../../src/spawn.js';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
export async function createBudgetModuleGraphFixture(mode, installedRoot) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-native-budget-graph-'));
  await fs.chmod(parent, 0o700);
  const dependencyRoot = installedRoot || repository;
  const require = createRequire(path.join(installedRoot || path.join(repository, 'packages/cossack'), 'package.json'));
  const scaffoldManifestPath = require.resolve('@cossackframework/scaffold/package.json');
  const scaffoldManifest = JSON.parse(await fs.readFile(scaffoldManifestPath, 'utf8'));
  const { createApp } = await import(pathToFileURL(path.resolve(path.dirname(scaffoldManifestPath), scaffoldManifest.exports['.'].import)).href);
  const { projectDir: root } = await createApp('app', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', interactive: false });
  const modules = path.join(root, 'node_modules'); await fs.mkdir(modules);
  for (const name of await fs.readdir(path.join(dependencyRoot, 'node_modules'))) {
    if (name.startsWith('.') || name === 'wrangler' || (!installedRoot && name === '@cossackframework')) continue;
    await fs.symlink(path.join(dependencyRoot, 'node_modules', name), path.join(modules, name), 'junction');
  }
  if (!installedRoot) {
    await fs.mkdir(path.join(modules, '@cossackframework'));
    for (const name of ['framework', 'core', 'renderer', 'auth', 'database', 'ui', 'scaffold']) await fs.symlink(path.join(repository, 'packages', name), path.join(modules, '@cossackframework', name), 'junction');
  }
  const nativeManifestPath = require.resolve('wrangler/package.json');
  const nativeManifest = JSON.parse(await fs.readFile(nativeManifestPath, 'utf8'));
  const nativeBin = path.resolve(path.dirname(nativeManifestPath), typeof nativeManifest.bin === 'string' ? nativeManifest.bin : nativeManifest.bin.wrangler);
  const counter = path.join(root, 'private-tool-counts.jsonl');
  const launcher = path.join(modules, 'wrangler'); await fs.mkdir(launcher);
  await fs.writeFile(path.join(launcher, 'package.json'), JSON.stringify({ name: 'wrangler', version: nativeManifest.version, main: require.resolve('wrangler'), bin: { wrangler: 'launcher.cjs' } }));
  await fs.writeFile(path.join(launcher, 'launcher.cjs'), `const fs=require('node:fs');const {spawn}=require('node:child_process');fs.appendFileSync(${JSON.stringify(counter)},JSON.stringify({command:process.argv[2],phase:process.env.COSSACK_BUILD_BUDGET_RUN_ID?'vite':'cli'})+'\\n',{mode:0o600});const child=spawn(process.execPath,[${JSON.stringify(nativeBin)},...process.argv.slice(2)],{stdio:'inherit'});child.on('error',()=>process.exit(1));child.on('exit',code=>process.exit(code??1));`);
  const configFile = path.join(root, 'wrangler.jsonc');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  config.vars.APP_URL = 'https://budget-graph.example.test'; config.vars.PRIVATE_GRAPH = 'PRIVATE_GRAPH_CONFIG_SENTINEL';
  await fs.writeFile(configFile, JSON.stringify(config));
  const manifestFile = path.join(root, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const setBudgets = async budgets => { manifest.cossack = { buildBudgets: budgets }; await fs.writeFile(manifestFile, JSON.stringify(manifest)); };
  await setBudgets({ uploadKiB: { warning: 0.001, error: 100000 }, gzipUploadKiB: { error: 100000 } });
  const lazyFile = path.join(root, 'src/budget-lazy.js');
  await fs.writeFile(lazyFile, "export const value='PRIVATE_GRAPH_SOURCE_SENTINEL';");
  await fs.appendFile(path.join(root, 'src/index.ts'), "\nglobalThis.__budgetGraph = () => import('./budget-lazy.js');\n");
  await fs.writeFile(path.join(root, 'outside-output.js'), "export const value='PRIVATE_EXTERNAL_SOURCE_SENTINEL';");
  const viteFile = path.join(root, 'vite.config.ts');
  let viteSource = await fs.readFile(viteFile, 'utf8');
  viteSource = `import graphFs from 'node:fs/promises';import graphPath from 'node:path';\n${viteSource}`;
  // Let the real Cloudflare build finish, then require Wrangler to rebundle its
  // actual emitted graph. External mode additionally imports a source outside
  // the output tree, which conservative receipt inventories cannot authenticate.
  if (mode !== 'dynamic') viteSource = viteSource.replace('cossackBuildBudgets()', `cossackBuildBudgets(), {name:'native-budget-graph-artifact',writeBundle:{order:'post',async handler(){if(this.environment.config.consumer!=='server')return;const out=graphPath.resolve(this.environment.config.root,this.environment.config.build.outDir);const file=graphPath.join(out,'wrangler.json');let config;try{config=JSON.parse(await graphFs.readFile(file,'utf8'));}catch{return;}config.no_bundle=false;await graphFs.writeFile(file,JSON.stringify(config));${mode === 'external' ? `const main=graphPath.resolve(out,config.main);const relative=graphPath.relative(out,graphPath.join(this.environment.config.root,'outside-output.js')).replaceAll('\\\\','/');await graphFs.writeFile(main,"import {value as externalValue} from "+JSON.stringify(relative.startsWith('.')?relative:'./'+relative)+";globalThis.__externalGraph=externalValue;\\n"+await graphFs.readFile(main,'utf8'));` : ''}}},}`);
  viteSource = viteSource.replaceAll('build: {', 'build: { sourcemap: true,');
  await fs.writeFile(viteFile, viteSource);
  const cli = installedRoot ? path.join(installedRoot, 'node_modules/cossack/bin/cossack.js') : path.join(repository, 'packages/cossack/bin/cossack.js');
  const invoke = async () => {
    const result = await runCaptured(process.execPath, [cli, 'build', '--json'], { cwd: root, shell: false, timeoutMs: 120000, maxOutputBytes: 2 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_ENV: '', CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: '', NODE_ENV: 'production', VITEST: '', COSSACK_DISABLE_UPDATE_CHECK: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_LOG_PATH: path.join(root, 'private-wrangler.log') } });
    await fs.writeFile(path.join(root, 'private-cli.log'), result.stdout + result.stderr, { mode: 0o600 });
    return { ...result, report: JSON.parse(result.stdout) };
  };
  const invokeVite = async () => {
    const viteRequire = createRequire(path.join(root, 'package.json'));
    const vite = path.join(path.dirname(viteRequire.resolve('vite/package.json')), 'bin/vite.js');
    return runCaptured(process.execPath, [vite, 'build'], { cwd: root, shell: false, timeoutMs: 120000, maxOutputBytes: 2 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_ENV: '', CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: '', NODE_ENV: 'production', VITEST: '', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_LOG_PATH: path.join(root, 'private-wrangler.log') } });
  };
  const counts = async () => { try { return (await fs.readFile(counter, 'utf8')).trim().split('\n').map(line => JSON.parse(line)); } catch { return []; } };
  return { root, parent, mode, invoke, invokeVite, setBudgets, lazyFile, counts, cleanup: () => fs.rm(parent, { recursive: true, force: true }) };
}
