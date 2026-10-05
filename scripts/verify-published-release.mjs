import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
export const publishedPackageNames = [
  'renderer', 'core', 'node-adapter', 'deno-adapter', 'auth', 'ui',
  'framework', 'database', 'studio', 'scaffold', 'test-utils',
].map(name => `@cossackframework/${name}`).concat('cossack');

/** Inspect the installed artifacts, never workspace package manifests or aliases. */
export async function publishedImportPlan(projectDir) {
  const declarations = new Set();
  const roots = [];
  const exports = [];
  const projectRoot = await fs.realpath(projectDir);
  const modulesRoot = await fs.realpath(path.join(projectRoot, 'node_modules'));
  assert.ok(modulesRoot.startsWith(projectRoot + path.sep), 'Acceptance node_modules must belong to the isolated project');
  const { discoverExports } = await import(pathToFileURL(path.join(modulesRoot, 'cossack/src/export-discovery.js')).href);
  for (const name of publishedPackageNames) {
    const root = path.join(projectDir, 'node_modules', name);
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.name, name);
    assert.ok(!JSON.stringify(pkg.dependencies ?? {}).includes('workspace:'), `${name} retained workspace dependency`);
    const resolved = await fs.realpath(root);
    assert.ok(resolved.startsWith(modulesRoot + path.sep), `${name} resolves outside the installed acceptance project`);
    roots.push({ name, root: resolved });
    const discovery = await discoverExports(root, name, pkg.exports ?? { '.': { types: pkg.types, import: pkg.main } });
    assert.equal(discovery.discovery.status, 'complete', `${name} export discovery is incomplete: ${discovery.discovery.reasons}`);
    for (const entry of discovery.entries) {
      if (entry.subpath.includes('*')) continue; // Concrete pattern matches follow.
      const targets = entry.targets.filter(target => target.status !== 'blocked');
      for (const target of targets) assert.equal(target.status, 'present', `${entry.import} ${target.conditions.join('/')} target ${target.target} is not present`);
      exports.push({ ...entry, package: name });
      if (entry.import.endsWith('.json')) continue;
      for (const target of targets) {
        if (target.conditions.includes('types') || /\.(?:ts|mts)$/.test(target.target)) {
          declarations.add(entry.import);
        }
      }
    }
  }
  return { declarations: [...declarations], roots, exports };
}

/** Installed public provider/helper behavior. Structural Cloudflare fixtures do
 * not replace native Workers/Workflow acceptance or contact a remote account. */
export async function verifyPublishedRelease(projectDir) {
  const plan = await publishedImportPlan(projectDir);
  const fixtureDir = path.join(projectDir, '.cossack-published-release');
  await fs.mkdir(fixtureDir, { recursive: true });
  const importSource = entries => entries.map((specifier, index) =>
    specifier.endsWith('/vite-env') ? `import ${JSON.stringify(specifier)};` :
    `import type * as M${index} from ${JSON.stringify(specifier)};\ntype Export${index} = typeof M${index};`).join('\n') + '\n';
  // Auth intentionally publishes TypeScript consumed by the application
  // bundler. Its source uses extensionless imports; do not pretend it is a
  // native Node ESM entry. All compiled package declarations also get NodeNext.
  const nodeDeclarations = plan.declarations.filter(specifier =>
    specifier !== '@cossackframework/auth' && !specifier.startsWith('@cossackframework/auth/'));
  for (const [mode, entries] of [['bundler', plan.declarations], ['NodeNext', nodeDeclarations]]) {
    await fs.writeFile(path.join(fixtureDir, `${mode}-imports.ts`), importSource(entries));
    await fs.writeFile(path.join(fixtureDir, `${mode}-tsconfig.json`), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: mode === 'bundler' ? 'ESNext' : 'NodeNext', moduleResolution: mode,
        strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
        experimentalDecorators: true, allowImportingTsExtensions: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['node'],
      }, files: [`${mode}-imports.ts`],
    }, null, 2));
  }
  const generatedFrameworkEntries = new Set([
    '@cossackframework/framework', '@cossackframework/framework/router',
    '@cossackframework/framework/DurableObject', '@cossackframework/framework/SseDurableObject',
    '@cossackframework/framework/workflows', '@cossackframework/framework/client',
    '@cossackframework/framework/client/app', '@cossackframework/framework/ssg-renderer',
    '@cossackframework/framework/locale',
  ]);
  const runtimeImports = [], deferredImports = [];
  for (const entry of plan.exports) {
    if (!entry.targets.some(target => target.status === 'present' && !target.conditions.includes('types') && /\.(?:js|mjs|cjs)$/.test(target.target))) continue;
    let deferred;
    if (generatedFrameworkEntries.has(entry.import)) deferred = 'generated application or native Cloudflare graph';
    else if (entry.package === '@cossackframework/deno-adapter' && entry.import === entry.package) deferred = 'native Deno graph';
    else if (entry.package === '@cossackframework/ui') deferred = 'generated browser graph';
    else if (entry.package === 'cossack' && entry.import !== 'cossack/vitest-reporter') deferred = 'CLI invocation and guide fixtures';
    else if (entry.import === '@cossackframework/database/cli') deferred = 'generated database CLI invocation';
    if (deferred) deferredImports.push({ import: entry.import, reason: deferred });
    else runtimeImports.push(entry.import);
  }
  await fs.writeFile(path.join(fixtureDir, 'runtime-coverage.json'), JSON.stringify({
    executedImports: runtimeImports, deferredImports,
    limitation: 'Conditional target presence does not prove execution. Deferred imports need their generated/browser/native fixtures.',
  }, null, 2) + '\n');
  await fs.writeFile(path.join(fixtureDir, 'imports.mjs'), runtimeImports.map(specifier =>
    `console.log('Importing:', ${JSON.stringify(specifier)}); await import(${JSON.stringify(specifier)});`).join('\n') +
    `\nconsole.log('Installed Node runtime imports passed: ${runtimeImports.length}; ${deferredImports.length} imports need separate application/native fixtures.');\n`);
  const fixture = path.join(fixtureDir, 'runtime.mjs');
  await fs.writeFile(fixture, `import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { LocalStorageProvider } from '@cossackframework/node-adapter/storage';
import { createR2StorageProvider } from '@cossackframework/framework/storage/r2';
import { createS3StorageProvider } from '@cossackframework/framework/storage/s3';
import { createCloudflareWorkflowProvider } from '@cossackframework/framework/workflows/provider';
import { withRequestScope, controlledAsync } from '@cossackframework/test-utils/server';
import { getRequestContext } from '@cossackframework/core';
import { defineWorkflow, workflowData } from '@cossackframework/core/workflows';
import { resolveRecipe } from '@cossackframework/scaffold/registry';
const body = () => new ReadableStream({start(c) {c.enqueue(new TextEncoder().encode('release'));c.close();}});
const root = new URL('./objects/', import.meta.url).pathname;
try {
  const local = new LocalStorageProvider({root});
  await local.put('acceptance.txt', body(), {size:7,contentType:'text/plain'});
  const reopened = new LocalStorageProvider({root});
  assert.equal(await new Response((await reopened.get('acceptance.txt')).body).text(), 'release');
  assert.equal((await reopened.head('acceptance.txt')).size, 7);
  await reopened.delete('acceptance.txt'); assert.equal(await reopened.get('acceptance.txt'), null);
} finally {await rm(root,{recursive:true,force:true});}
let bytes; const metadata = {key:'acceptance',size:7,etag:'fixed',uploaded:new Date(0)};
const r2 = createR2StorageProvider({
  async createMultipartUpload() {return {async uploadPart(_n,value){bytes=value;return {partNumber:1,etag:'fixed'};}, async complete(){return metadata;},async abort(){throw new Error('unexpected abort');}};},
  async head(){return metadata;},async get(){return {...metadata,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};},async delete(){bytes=undefined;},
});
await r2.put('acceptance',body(),{size:7});
assert.equal(await new Response((await r2.get('acceptance')).body).text(),'release');
const commands=[];
const s3=createS3StorageProvider({bucket:'fixture',client:{async send(command){commands.push(command.constructor.name);return {ETag:'fixed'};}}});
await s3.put('empty',new ReadableStream({start(c){c.close();}}),{size:0});
assert.deepEqual(commands,['PutObjectCommand']);
const calls=[];
const workflows=createCloudflareWorkflowProvider({async create(value){calls.push(value.id);},async get(){return {async status(){return {status:'waiting'};},async sendEvent(value){calls.push(value.type);},async pause(){calls.push('pause');}};}});
await workflows.create({identity:{id:'fixture'}});assert.equal(await workflows.inspect('fixture'),'waiting');
await workflows.sendEvent('fixture','ready',{});await workflows.control('fixture','pause');
assert.deepEqual(calls,['fixture','ready','pause']);
const context={acceptance:true};
await withRequestScope({context},async()=>{assert.equal(getRequestContext(),context);const deferred=controlledAsync();deferred.resolve('done');assert.equal(await deferred.promise,'done');assert.equal(deferred.settled,true);});
assert.deepEqual(workflowData({ok:true}),{ok:true});
assert.equal(defineWorkflow({name:'acceptance',version:1,events:{},schema:{async parse(v){return v;}},async run(){return null;}}).name,'acceptance');
assert.ok(resolveRecipe({adapter:'node',preset:'minimal',features:['resource','mutation','scoped-service']}).resolvedFeatures.includes('mutation'));
console.log('Installed public storage/providers/request helpers/recipe acceptance passed.');
`);
  try {
    for (const args of [
      ['exec', 'tsc', '-p', path.join(fixtureDir, 'bundler-tsconfig.json')],
      ['exec', 'tsc', '-p', path.join(fixtureDir, 'NodeNext-tsconfig.json')],
      ['exec', 'node', path.join(fixtureDir, 'imports.mjs')],
      ['exec', 'node', fixture],
    ]) {
      const result = await execFileAsync('pnpm', args, { cwd: projectDir, maxBuffer: 8 * 1024 * 1024, timeout: 120_000 });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    console.log(`Installed declaration imports passed: ${plan.declarations.length} bundler / ${nodeDeclarations.length} NodeNext public entries across ${plan.roots.length} packages; ${plan.exports.length} concrete export mappings have present conditional targets.`);
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}
