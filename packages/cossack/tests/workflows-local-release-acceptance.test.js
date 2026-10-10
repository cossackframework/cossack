import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '@cossackframework/scaffold';
import { writeLocalWorkflowsAcceptance, checkLocalWorkflowsAcceptance } from './fixtures/workflows-local-release-acceptance.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const execute = promisify(execFile);

async function linkDependencies(root, installedRoot) {
 const modules = path.join(root, 'node_modules');
 const sourceModules = path.join(installedRoot ?? repository, 'node_modules');
 await fs.mkdir(modules);
 for (const name of await fs.readdir(sourceModules)) {
  if (name.startsWith('.') || name === '@cossackframework') continue;
  await fs.symlink(path.join(sourceModules, name), path.join(modules, name), 'junction');
 }
 await fs.mkdir(path.join(modules, '@cossackframework'));
 for (const name of ['framework','core','renderer','node-adapter','auth','database','ui']) {
  const target = installedRoot
   ? await fs.realpath(path.join(sourceModules, '@cossackframework', name))
   : path.join(repository, 'packages', name);
  if (installedRoot) {
   expect(target).toContain(`${path.sep}.pnpm${path.sep}`);
   expect(target).toContain('@file+');
   expect(target).not.toContain(`${repository}packages${path.sep}`);
  }
  await fs.symlink(target, path.join(modules, '@cossackframework', name), 'junction');
 }
}
function tool(root, name, file) {
 const require = createRequire(path.join(root, 'package.json'));
 return path.join(path.dirname(require.resolve(name + '/package.json')), file);
}

it('proves native local workflow retry, pause/restart/resume, validated events, exactly-once effects and failure redaction', async () => {
 const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-workflows-local-release-'));
 const installedRoot = process.env.COSSACK_WORKFLOWS_INSTALLED_ROOT;
 let scaffold = createApp;
 if (installedRoot) {
  const require = createRequire(path.join(installedRoot, 'package.json'));
  const packageFile = require.resolve('@cossackframework/scaffold/package.json');
  const packageRoot = path.dirname(await fs.realpath(packageFile));
  const metadata = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  const entry = path.resolve(packageRoot, metadata.exports['.'].import);
  expect(entry).toContain(`${path.sep}.pnpm${path.sep}`);
  expect(entry).toContain('@file+');
  scaffold = (await import(pathToFileURL(entry).href)).createApp;
 }
 try {
  const {projectDir:root} = await scaffold('app', {cwd:parent, adapter:'cloudflare', preset:'minimal', features:['workflows'], interactive:false});
  await linkDependencies(root, installedRoot);
  await writeLocalWorkflowsAcceptance(root);
  const env = {...process.env, NODE_ENV:'production', VITEST:'', WRANGLER_SEND_METRICS:'false'};
  await execute(process.execPath, [tool(root, 'wrangler', 'bin/wrangler.js'), 'types', 'worker-configuration.d.ts'], {cwd:root, env, timeout:30000, maxBuffer:4*1024*1024});
  await execute(process.execPath, [tool(root, 'typescript', 'bin/tsc'), '--ignoreConfig', '--noEmit', '--skipLibCheck', '--strict', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ESNext', 'worker-configuration.d.ts', 'src/workflows/public-types-proof.ts'], {cwd:root, env, timeout:30000, maxBuffer:4*1024*1024});
  await execute('pnpm', ['tsc', '--noEmit'], {cwd:root, env, timeout:30000, maxBuffer:4*1024*1024});
  await execute(process.execPath, [tool(root, 'vite', 'bin/vite.js'), 'build'], {cwd:root, env, timeout:120000, maxBuffer:4*1024*1024});
  // Use this consumer's actual provider API, including in installed acceptance.
  const providerRequire = createRequire(path.join(root, 'package.json'));
  const { unstable_dev } = providerRequire('wrangler');
  const configPath = path.join(root, 'dist/ssr/wrangler.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const proof = await checkLocalWorkflowsAcceptance(async () => {
   const worker = await unstable_dev(path.resolve(path.dirname(configPath), config.main), {
    config:configPath, local:true, ip:'127.0.0.1', port:0, persist:true,
    persistTo:path.join(root, '.wrangler/local-release-state'), inspect:false,
    logLevel:'none', experimental:{disableExperimentalWarning:true, disableDevRegistry:true, watch:false},
   });
   return {listen:async () => ({url:`http://${worker.address}:${worker.port}`}), close:() => worker.stop()};
  });
  expect(proof).toMatchObject({retryAttempts:2, firstEffects:1, lastEffects:1, restarted:true, failedInspectionRedacted:true});
  expect(proof.nativeStatuses).toHaveLength(2);
 } finally {
  await fs.rm(parent, {recursive:true, force:true});
  await expect(fs.access(parent)).rejects.toMatchObject({code:'ENOENT'});
 }
}, 240000);
