import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript-api';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readPackageGuidance } from '../src/package-guidance.js';
import { discoverExports } from '../src/export-discovery.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const added = {
  framework: ['authorized-cloud-object-storage', 'workflow-binding-client', 'request-session-store', 'routing-api-render-tooling', 'typed-http-boundaries', 'localized-static-rendering', 'read-only-project-inspection'],
  'node-adapter': ['authorized-local-storage'],
  scaffold: ['recipe-registry-planning', 'conflict-safe-composition'],
  'test-utils': ['production-server-fixtures', 'request-scope-async-fixtures', 'browser-component-fixtures'],
};
async function guides() {
  const result = [];
  for (const [pkg, ids] of Object.entries(added)) {
    const metadata = JSON.parse(await fs.readFile(path.join(root, 'packages', pkg, 'agent-docs.json'), 'utf8'));
    expect(metadata.schemaVersion).toBe(1);
    for (const id of ids) { const guide = metadata.guides.find(item => item.id === id); expect(guide, `${pkg}:${id}`).toBeDefined(); result.push({pkg, guide}); }
  }
  return result;
}
const externalRequire = createRequire(path.join(root, 'packages/framework/package.json'));
const importsOf = source => [...source.matchAll(/from\s*['"](@cossackframework\/[^'"]+)['"]/g)].map(match => match[1]);
async function publicEntry(specifier, condition) {
  const [scope, pkg, ...subpath] = specifier.split('/');
  const directory = path.join(root, 'packages', pkg);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  expect(manifest.name).toBe(`${scope}/${pkg}`);
  const entry = manifest.exports?.[subpath.length ? './' + subpath.join('/') : '.'];
  const target = typeof entry === 'string' ? entry : entry?.[condition];
  expect(target, `${specifier}:${condition}`).toBeTypeOf('string');
  return path.join(directory, target);
}
it('all remaining family examples typecheck strictly against declared public entries', async () => {
  const directory = await fs.mkdtemp(path.join(root, 'packages/cossack/.guide-types-'));
  try {
    const paths = {}; const files = [];
    for (const {guide} of await guides()) {
      expect(guide.markdown.length).toBeGreaterThan(300);
      for (const specifier of new Set([...guide.imports, ...guide.examples.flatMap(example => importsOf(example.source))])) paths[specifier] = [await publicEntry(specifier, 'types')];
      paths.hono = [path.join(root, 'packages/framework/node_modules/hono')];
      for (const example of guide.examples) { const file = path.join(directory, example.id + '.ts'); await fs.writeFile(file, example.source); files.push(file); }
    }
    const program = ts.createProgram(files, {strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true,
      types: ['node'], paths});
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(ts.formatDiagnosticsWithColorAndContext(diagnostics, {getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n'})).toBe('');
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
}, 30000);
it('portable and Node example assertions execute without cloud credentials or Worker-native imports', async () => {
  const directory = await fs.mkdtemp(path.join(root, 'packages/cossack/.guide-runtime-'));
  try {
    for (const {guide} of await guides()) for (const example of guide.examples) {
      let source = example.source;
      for (const specifier of new Set([...guide.imports, ...importsOf(source)])) source = source.split(`'${specifier}'`).join(JSON.stringify(pathToFileURL(await publicEntry(specifier, 'import')).href));
      source = source.replace("'hono'", JSON.stringify(pathToFileURL(externalRequire.resolve('hono')).href));
      expect(source).not.toContain('cloudflare:workers');
      const compiled = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
      const file = path.join(directory, example.id + '.mjs'); await fs.writeFile(file, compiled);
      if (guide.id === 'browser-component-fixtures') {
        const domRequire = createRequire(path.join(root, 'packages/test-utils/package.json'));
        const runner = path.join(directory, 'browser-runner.mjs');
        await fs.writeFile(runner, `import {JSDOM} from ${JSON.stringify(pathToFileURL(domRequire.resolve('jsdom')).href)};
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'https://app.example.test'});
for (const name of ['window','document','HTMLElement','customElements','Node','NodeFilter','Element','Text','Comment','DocumentFragment','MutationObserver','Event','MouseEvent','HTMLInputElement','HTMLTextAreaElement','ShadowRoot']) Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()),0);
globalThis.cancelAnimationFrame = clearTimeout;
try {const module = await import(${JSON.stringify(pathToFileURL(file).href)}); await module.assertGreetingInBrowser();} finally {dom.window.close();}
`);
        await promisify(execFile)(process.execPath, [runner], {timeout:15000});
      } else await import(pathToFileURL(file).href);
    }
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
}, 30000);
it('native and browser guide boundaries preserve explicit unproven guarantees', async () => {
  const all = await guides();
  const workflow = all.find(item => item.guide.id === 'workflow-binding-client').guide;
  expect(workflow.markdown).toContain('@cossackframework/framework/workflows');
  expect(workflow.markdown).toContain('Native execution is required');
  expect(workflow.markdown).toContain('waiting-status');
  expect(all.find(item => item.guide.id === 'browser-component-fixtures').guide.markdown).toContain('actual generated browser acceptance');
});

it('owned package catalogs validate through production guidance discovery', async () => {
  for (const pkg of Object.keys(added)) {
    const directory = path.join(root, 'packages', pkg);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const discovered = await discoverExports(directory, manifest.name, manifest.exports);
    const guidance = await readPackageGuidance(directory, manifest.name, manifest.version, discovered.entries);
    expect(guidance.status, pkg).toBe('available');
    expect(guidance.omitted, pkg).toEqual([]);
  }
});
