// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { build, createLogger } from 'vite';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { ASSETS_RUN_WORKER_FIRST, isPolicyPreservingRunWorkerFirst, isStaticAssetFile } from '@cossackframework/core/static-assets';
import { checkStaticAssetNamespace, uncoveredClientOutput } from '../src/static-asset-routing';
import { DeploymentError, inspectBuiltDeployment } from '../src/deployment-artifact';
import { readCloudflareDeclarationConfig } from '../src/config-preflight';
import { cossackPages } from '../src/vite-plugin';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(files: Record<string, string> = {}, directories: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'cossack-static-assets-')); roots.push(root);
  for (const directory of directories) await mkdir(join(root, directory), { recursive: true });
  for (const [file, source] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), source);
  }
  return root;
}

describe('framework asset routing pattern', () => {
  it('is one frozen pattern that excludes only hashed build output', () => {
    expect(ASSETS_RUN_WORKER_FIRST).toEqual(['/*', '!/assets/*']);
    expect(Object.isFrozen(ASSETS_RUN_WORKER_FIRST)).toBe(true);
  });
  it.each([true, ['/*', '!/assets/*']])('accepts %j', value => {
    expect(isPolicyPreservingRunWorkerFirst(value)).toBe(true);
  });
  it.each([false, undefined, 'true', [], ['/*'], ['!/assets/*', '/*'], ['/*', '!/assets/*', '!/private/*'], ['/private/*'], ['/*', '!/assets/**']])(
    'rejects %j', value => {
      expect(isPolicyPreservingRunWorkerFirst(value)).toBe(false);
    });
  it('classifies client output paths relative to the output root', () => {
    expect(isStaticAssetFile('assets/entry.abc12345.js')).toBe(true);
    expect(isStaticAssetFile('assets\\nested\\style.abc12345.css')).toBe(true);
    expect(isStaticAssetFile('entry.abc12345.js')).toBe(false);
    expect(isStaticAssetFile('assetsx/entry.js')).toBe(false);
  });
});

describe('reserved /assets namespace', () => {
  it('rejects public/assets, including a configured public directory', async () => {
    const root = await fixture({ 'public/assets/logo.svg': '<svg/>', 'static/assets/data.json': '{}' });
    expect(checkStaticAssetNamespace(root)).toEqual([expect.objectContaining({
      code: 'COSSACK_ASSETS_NAMESPACE_RESERVED', file: join(root, 'public/assets'),
      message: expect.stringContaining('public/assets/ uses the /assets/ namespace'),
    })]);
    expect(checkStaticAssetNamespace(root, { publicDir: join(root, 'static') })).toEqual([
      expect.objectContaining({ file: join(root, 'static/assets') })]);
    expect(checkStaticAssetNamespace(root, { publicDir: false })).toEqual([]);
  });
  it('rejects addressable page and API-style routes that resolve under /assets', async () => {
    const root = await fixture({
      'src/pages/assets/index.ts': '', 'src/pages/(group)/assets/[id]/index.ts': '', 'src/pages/assets.md': '# Assets',
      'src/pages/assets/404/index.ts': '', 'src/pages/assetsx/index.ts': '', 'src/pages/docs/assets/index.ts': '',
    });
    const routes = (options = {}) => checkStaticAssetNamespace(root, options).map(diagnostic => diagnostic.message.split(' ')[0]);
    expect(routes()).toEqual(['src/pages/(group)/assets/[id]/index.ts', 'src/pages/assets.md', 'src/pages/assets/index.ts']);
    expect(routes({ includeMarkdown: false })).toEqual(['src/pages/(group)/assets/[id]/index.ts', 'src/pages/assets/index.ts']);
    expect(checkStaticAssetNamespace(root)[0]!.message).toContain('resolves to /assets/:id, inside the /assets/ namespace');
    // Callers that already discovered routes are not rescanned.
    expect(checkStaticAssetNamespace(root, { routes: [] })).toEqual([]);
  });
  it('lists manifest files that the pattern does not cover', () => {
    expect(uncoveredClientOutput({
      'src/client/entry-client.ts': { file: 'assets/entry-client.a1b2c3d4.js', css: ['assets/style.a1b2c3d4.css'], assets: ['assets/logo.a1b2c3d4.svg'] },
    })).toEqual([]);
    expect(uncoveredClientOutput({
      'src/client/entry-client.ts': { file: 'entry-client.js', css: ['static/style.css'] },
      '_shared.js': { file: 'entry-client.js' },
    })).toEqual(['entry-client.js', 'static/style.css']);
    expect(uncoveredClientOutput(undefined)).toEqual([]);
  });
});

describe('cossackPages build checks', () => {
  const logger = () => {
    const warnings: string[] = [];
    const customLogger = createLogger('warn', { allowClearScreen: false });
    customLogger.warn = message => { warnings.push(message); };
    return { warnings, customLogger };
  };
  const clientBuild = (root: string, entryFileNames = 'assets/[name].[hash].js', customLogger = createLogger('silent')) => build({
    root, configFile: false, logLevel: 'warn', customLogger, plugins: [cossackPages()],
    build: { outDir: 'dist/client', emptyOutDir: true, manifest: true, minify: false,
      rolldownOptions: { input: join(root, 'src/client/entry-client.ts'), output: { entryFileNames, chunkFileNames: entryFileNames } } },
  });
  const entry = { 'src/client/entry-client.ts': 'export const loaded = true;' };

  it('fails the build when public/assets exists', async () => {
    const root = await fixture({ ...entry, 'public/assets/private.txt': 'secret' });
    await expect(clientBuild(root)).rejects.toMatchObject({ message: expect.stringContaining('public/assets/ uses the /assets/ namespace') });
  });
  it('fails the build when a route resolves under /assets', async () => {
    const root = await fixture({ ...entry, 'src/pages/assets/[file]/index.ts': 'export default class Files {}' });
    await expect(clientBuild(root)).rejects.toMatchObject({ message: expect.stringContaining('resolves to /assets/:file') });
  });
  it('warns when hashed client output leaves assets/ and stays quiet otherwise', async () => {
    const root = await fixture(entry);
    const covered = logger();
    await clientBuild(root, 'assets/[name].[hash].js', covered.customLogger);
    expect(covered.warnings.join('\n')).not.toContain('outside assets/');
    const moved = logger();
    await clientBuild(root, 'static/[name].[hash].js', moved.customLogger);
    expect(moved.warnings.join('\n')).toMatch(/The client build wrote static\/entry-client\.[\w-]+\.js outside assets\/\./);
    expect(existsSync(join(root, 'dist/client/cossack-manifest.json'))).toBe(true);
  });
});

describe('built artifact coverage', () => {
  async function artifactProject(runWorkerFirst: unknown, files: string[]) {
    const root = await fixture({ 'entry.ts': 'export default {};', 'package.json': '{"type":"module"}',
      'dist/client/.vite/manifest.json': JSON.stringify({ 'src/client/entry-client.ts': { file: files[0], css: files.slice(1) } }) },
    ['node_modules', '.wrangler/deploy']);
    await symlink(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), join(root, 'node_modules/wrangler'), 'junction');
    const config = { name: 'artifact', main: './entry.ts', compatibility_date: '2026-01-01',
      assets: { binding: 'ASSETS', run_worker_first: runWorkerFirst } };
    await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify(config));
    // The Cloudflare Vite plugin writes the artifact beside the Worker bundle.
    await mkdir(join(root, 'dist/worker'), { recursive: true });
    await writeFile(join(root, 'dist/worker/wrangler.json'), JSON.stringify({ ...config, main: '../../entry.ts', assets: { ...config.assets, directory: '../client' } }));
    await writeFile(join(root, '.wrangler/deploy/config.json'), '{"configPath":"../../dist/worker/wrangler.json"}');
    return { root, expected: await readCloudflareDeclarationConfig(root, join(root, 'wrangler.jsonc')) };
  }
  it('keeps the pattern array through the artifact comparison', async () => {
    const { root, expected } = await artifactProject([...ASSETS_RUN_WORKER_FIRST], ['assets/entry.a1b2c3d4.js', 'assets/style.a1b2c3d4.css']);
    expect(expected.assets.run_worker_first).toEqual(['/*', '!/assets/*']);
    await expect(inspectBuiltDeployment(root, expected)).resolves.toBe(join(root, 'dist/worker/wrangler.json'));
    await expect(inspectBuiltDeployment(root, { ...expected, assets: { ...expected.assets, run_worker_first: true } }))
      .rejects.toMatchObject({ code: 'COSSACK_DEPLOY_TARGET_MISMATCH' });
  });
  it('rejects client output the pattern no longer covers', async () => {
    const { root, expected } = await artifactProject([...ASSETS_RUN_WORKER_FIRST], ['entry.js', 'assets/style.a1b2c3d4.css']);
    const failure = await inspectBuiltDeployment(root, expected).catch(error => error);
    expect(failure).toBeInstanceOf(DeploymentError);
    expect(failure).toMatchObject({ code: 'COSSACK_ASSETS_PATTERN_UNCOVERED', message: expect.stringContaining('wrote entry.js outside assets/') });
    expect(failure.message).toContain('or set assets.run_worker_first to true');
  });
  it('accepts any output layout when every request runs the Worker first', async () => {
    const { root, expected } = await artifactProject(true, ['entry.js']);
    await expect(inspectBuiltDeployment(root, expected)).resolves.toBe(join(root, 'dist/worker/wrangler.json'));
  });
});
