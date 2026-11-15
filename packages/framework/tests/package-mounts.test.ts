// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostContractProblems, mountedPackages, PackageMountError } from '../src/package-mounts';
import { listPlugins, overrideReport, pluginLocations, readRenderedPlugins, scanPageSources } from '../src/plugin-sources';
import { discoverConfigSources, generateConfigTypes } from '../src/config-codegen';
import { discoverRoutes } from '../src/route-codegen';
import { getModulePreloads } from '../src/route-ids';
import { cossackConfig, cossackMiddlewares, cossackPages } from '../src/vite-plugin';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function write(root: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

const page = 'export default class Page {}';
const served = {
  'app/src/pages/(site)/index.ts': page,
  'app/src/pages/(site)/layout.ts': page,
  'app/src/pages/(site)/search/index.ts': page,
  'app/src/pages/(site)/search/loading.ts': page,
  'app/src/pages/api/kit/ping.ts': 'export const GET = () => new Response("pong");',
  'app/src/pages/dashboard/index.ts': page,
  // The package's own shell, rendered beside the served files: never mounted.
  'app/src/pages/dashboard/layout.ts': page,
  'app/src/pages/auth/login/index.ts': page,
  'app/src/plugins/kit-theme/plugin.json': JSON.stringify({ name: 'kit-theme', version: '2.0.0' }),
  'app/src/plugins/kit-theme/pages/theme/index.ts': page,
  'app/src/plugins/kit-theme/config/look.ts': 'export default () => ({ dark: true });',
  'app/src/plugins/unlisted/plugin.json': JSON.stringify({ name: 'unlisted', version: '1.0.0' }),
  'app/src/config/kit.ts': 'export default () => ({ name: "kit" });',
  'app/src/kit/middleware.ts': 'export default [];',
};
const field = {
  root: 'app/src', alias: 'kit',
  pages: ['pages/(site)/', 'pages/api/kit/', 'pages/dashboard/index.ts'],
  plugins: ['plugins/kit-theme/'], config: ['config/kit.ts'], middlewares: 'kit/middleware.ts',
  host: ['kit/database.ts'], hostTemplate: '0.10.0',
};

/** A project that mounts @acme/kit, installed under node_modules or linked from outside it. */
function project(files: Record<string, string> = {}, options: { linked?: boolean; cossack?: object } = {}): { root: string; kit: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cossack-mounts-')));
  roots.push(root);
  const installed = join(root, 'node_modules/@acme/kit');
  const kit = options.linked ? join(realpathSync(mkdtempSync(join(tmpdir(), 'cossack-kit-'))), 'kit') : installed;
  if (options.linked) roots.push(dirname(kit));
  write(kit, { 'package.json': JSON.stringify({ name: '@acme/kit', version: '1.4.0', cossack: { ...field, ...options.cossack } }), ...served });
  if (options.linked) { mkdirSync(dirname(installed), { recursive: true }); symlinkSync(kit, installed, 'dir'); }
  write(root, { 'package.json': JSON.stringify({ name: 'app', cossack: { packages: ['@acme/kit'] } }), 'src/kit/database.ts': 'export const db = 1;', ...files });
  return { root, kit };
}

describe('mounted packages', () => {
  it('reads what a package serves from its package.json', () => {
    const { root, kit } = project();
    expect(mountedPackages(root)).toEqual([expect.objectContaining({
      name: '@acme/kit', version: '1.4.0', alias: 'kit', directory: kit, root: join(kit, 'app/src'), linked: false,
      pages: field.pages, plugins: field.plugins, config: field.config, middlewares: 'kit/middleware.ts', host: ['kit/database.ts'], hostTemplate: '0.10.0',
    })]);
    expect(mountedPackages(project({}, { linked: true }).root)[0]).toMatchObject({ linked: true });
    // Installing a package mounts nothing: the application names it.
    const unnamed = project();
    writeFileSync(join(unnamed.root, 'package.json'), JSON.stringify({ name: 'app' }));
    expect(mountedPackages(unnamed.root)).toEqual([]);
    expect(scanPageSources(unnamed.root).pageKeys).toEqual([]);
  });

  it('rejects a package that is missing or serves nothing', () => {
    const { root } = project();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ cossack: { packages: ['@acme/absent'] } }));
    expect(() => mountedPackages(root)).toThrow(/@acme\/absent is named in package.json#cossack.packages and is not installed/);
    const escaping = project({}, { cossack: { pages: ['../outside/'] } });
    expect(() => mountedPackages(escaping.root)).toThrow(PackageMountError);
    const rootless = project({}, { cossack: { root: undefined } });
    expect(() => mountedPackages(rootless.root)).toThrow(/serves nothing/);
  });

  it.each([false, true])('gives served pages application keys and package origins (linked: %s)', linked => {
    const { root, kit } = project({ 'src/pages/about/index.ts': page }, { linked });
    const sources = scanPageSources(root);
    expect(sources.pageKeys).toEqual([
      '/src/pages/(site)/index.ts', '/src/pages/(site)/search/index.ts', '/src/pages/about/index.ts',
      '/src/pages/api/kit/ping.ts', '/src/pages/dashboard/index.ts', '/src/pages/theme/index.ts',
    ]);
    // Only the listed paths are mounted: the package's shell files beside them are not.
    expect(sources.layoutKeys).toEqual(['/src/pages/(site)/layout.ts']);
    expect(sources.loadingKeys).toEqual(['/src/pages/(site)/search/loading.ts']);
    expect(sources.origins['/src/pages/(site)/index.ts']).toEqual({ kind: 'package', name: '@acme/kit', file: join(kit, 'app/src/pages/(site)/index.ts') });
    expect(sources.origins['/src/pages/about/index.ts']).toEqual({ kind: 'app', file: join(root, 'src/pages/about/index.ts') });
    // A package page has no owner: it is not plugin-gated and takes the application's layouts.
    expect(sources.plugins).toEqual({ '/src/pages/theme/index.ts': 'kit-theme' });
    expect(sources.origins['/src/pages/theme/index.ts']).toMatchObject({ kind: 'plugin', name: 'kit-theme' });
    if (!linked) expect(sources.sources['/src/pages/(site)/index.ts']).toBe('/node_modules/@acme/kit/app/src/pages/(site)/index.ts');
    else expect(sources.sources['/src/pages/(site)/index.ts']).toMatch(/^\/\.\.\/.*\/kit\/app\/src\/pages\/\(site\)\/index\.ts$/);
    expect(sources.overrides).toEqual([]);

    const manifest = discoverRoutes(root);
    expect(manifest.routes.find(route => route.filePath === '/src/pages/(site)/search/index.ts')).toMatchObject({ pattern: '/search', layoutPaths: ['/src/pages/(site)/layout.ts'] });
    expect(manifest.routes.find(route => route.filePath === '/src/pages/api/kit/ping.ts')).toMatchObject({ kind: 'api', pattern: '/api/kit/ping' });

    // The build manifest is keyed by the real path, relative to the project.
    vi.stubEnv('DEV', false);
    const key = sources.sources['/src/pages/(site)/index.ts']!.slice(1);
    const preloads = getModulePreloads({ [key]: { file: 'assets/home.js' }, 'src/client/entry-client.ts': { file: 'assets/entry.js' } },
      '/src/pages/(site)/index.ts', [], sources.sources);
    expect(preloads).toEqual(['/assets/home.js']);
    vi.unstubAllEnvs();
  });

  it('lets an application file override the package file of the same key or the same URL', () => {
    const { root, kit } = project({
      'src/pages/(site)/index.ts': page,
      'src/pages/(site)/layout.ts': page,
      // Another key for the URL /search.
      'src/pages/search/index.ts': page,
    });
    const sources = scanPageSources(root);
    expect(sources.origins['/src/pages/(site)/index.ts']).toEqual({ kind: 'app', file: join(root, 'src/pages/(site)/index.ts') });
    expect(sources.pageKeys).not.toContain('/src/pages/(site)/search/index.ts');
    expect(sources.pageKeys).toContain('/src/pages/search/index.ts');
    expect(sources.overrides).toEqual([
      { path: 'src/pages/(site)/index.ts', package: '@acme/kit', file: join(kit, 'app/src/pages/(site)/index.ts') },
      { path: 'src/pages/(site)/layout.ts', package: '@acme/kit', file: join(kit, 'app/src/pages/(site)/layout.ts') },
      { path: 'src/pages/search/index.ts', package: '@acme/kit', file: join(kit, 'app/src/pages/(site)/search/index.ts') },
    ]);
    expect(overrideReport(root, sources.overrides)).toEqual([
      '[cossack] src/pages/(site)/index.ts overrides @acme/kit',
      '[cossack] src/pages/(site)/layout.ts overrides @acme/kit',
      '[cossack] src/pages/search/index.ts overrides @acme/kit',
    ]);

    // The overridden files are not imported, so they are not bundled.
    const plugin = cossackPages();
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    const client = (plugin.load as Function).call({ environment: { name: 'client' } }, '\0virtual:cossack-pages') as string;
    expect(client).toContain('"/src/pages/(site)/index.ts": () => import("/src/pages/(site)/index.ts"),');
    expect(client).not.toContain('kit/app/src/pages/(site)/index.ts');
    expect(client).not.toContain('kit/app/src/pages/(site)/search/index.ts');
    expect(client).toContain('"/src/pages/api/kit/ping.ts": () => import("/node_modules/@acme/kit/app/src/pages/api/kit/ping.ts"),');
    const server = (plugin.load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-pages') as string;
    expect(server).toContain('"/src/pages/dashboard/index.ts":"/node_modules/@acme/kit/app/src/pages/dashboard/index.ts"');
  });

  it('imports a linked package through its real path', () => {
    const { root, kit } = project({}, { linked: true });
    const plugin = cossackPages();
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    const client = (plugin.load as Function).call({ environment: { name: 'client' } }, '\0virtual:cossack-pages') as string;
    expect(client).toContain(`"/src/pages/dashboard/index.ts": () => import(${JSON.stringify(join(kit, 'app/src/pages/dashboard/index.ts'))}),`);
  });

  it('keeps a package page against a plugin page a conflict', () => {
    const { root } = project({
      'src/plugins/shop/plugin.json': JSON.stringify({ name: 'shop', version: '1.0.0' }),
      'src/plugins/shop/pages/(site)/search/index.ts': page,
    });
    expect(() => scanPageSources(root)).toThrow(expect.objectContaining({ code: 'COSSACK_PLUGIN_ROUTE_CONFLICT' }));
  });

  it('serves a package plugin like a rendered one, and lets an application plugin shadow it whole', () => {
    const { root, kit } = project();
    expect(listPlugins(root)).toEqual(['kit-theme']);
    expect(pluginLocations(root)).toEqual([{ name: 'kit-theme', directory: join(kit, 'app/src/plugins/kit-theme'), package: '@acme/kit' }]);
    expect(readRenderedPlugins(root)).toEqual([{ name: 'kit-theme', version: '2.0.0', manifest: 'node_modules/@acme/kit/app/src/plugins/kit-theme/plugin.json', directory: join(kit, 'app/src/plugins/kit-theme'), package: '@acme/kit' }]);

    write(root, { 'src/plugins/kit-theme/plugin.json': JSON.stringify({ name: 'kit-theme', version: '9.0.0' }) });
    expect(pluginLocations(root)).toEqual([{ name: 'kit-theme', directory: join(root, 'src/plugins/kit-theme') }]);
    const sources = scanPageSources(root);
    // The package's plugin pages go with it: nothing is merged file by file.
    expect(sources.pageKeys).not.toContain('/src/pages/theme/index.ts');
    expect(sources.overrides).toEqual([{ path: 'src/plugins/kit-theme', package: '@acme/kit', file: join(kit, 'app/src/plugins/kit-theme') }]);
  });

  it('adds package and package-plugin configuration, application files first', async () => {
    const { root, kit } = project({ 'src/config/app.ts': 'export default () => ({});' });
    expect(discoverConfigSources(root).map(entry => [entry.key, entry.file])).toEqual([
      ['app', join(root, 'src/config/app.ts')],
      ['kit', join(kit, 'app/src/config/kit.ts')],
      ['kit-theme::look', join(kit, 'app/src/plugins/kit-theme/config/look.ts')],
    ]);
    expect(generateConfigTypes(root, { write: false }).source).toContain('"kit": FactoryResult<typeof import("../node_modules/@acme/kit/app/src/config/kit.ts").default>;');
    const plugin = cossackConfig();
    await (plugin.configResolved as Function).call({}, { root, command: 'serve' });
    const source = (plugin.load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-config') as string;
    expect(source).toMatch(/import \* as (\w+) from "\/node_modules\/@acme\/kit\/app\/src\/config\/kit\.ts";[\s\S]*"\/src\/config\/kit\.ts": \1,/);
    expect(source).toMatch(/"\/src\/plugins\/kit-theme\/config\/look\.ts": \w+,/);

    // An application file of the same name wins.
    write(root, { 'src/config/kit.ts': 'export default () => ({ name: "mine" });' });
    expect(discoverConfigSources(root).find(entry => entry.key === 'kit')!.file).toBe(join(root, 'src/config/kit.ts'));
  });

  it('runs package middleware after the application list', () => {
    const { root } = project({ 'src/bootstrap/middlewares.ts': 'export default [];' });
    const plugin = cossackMiddlewares();
    (plugin.configResolved as Function).call({}, { root });
    const source = (plugin.load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-middlewares') as string;
    expect(source).toMatch(/import \* as (\w+) from "\/node_modules\/@acme\/kit\/app\/src\/kit\/middleware\.ts";[\s\S]*"@acme\/kit": \1,/);
    expect(source.indexOf('for (const key of Object.keys(packageModules)')).toBeLessThan(source.indexOf('for (const key of Object.keys(pluginModules)'));
  });

  it('checks the host contract: the modules a package needs, and the template they come from', () => {
    const { root } = project();
    expect(hostContractProblems(root)).toEqual([]);
    rmSync(join(root, 'src/kit/database.ts'));
    expect(hostContractProblems(root).map(problem => [problem.code, problem.message])).toEqual([
      ['COSSACK_PACKAGE_HOST_MISSING', expect.stringContaining('@acme/kit needs src/kit/database.ts in the application')],
    ]);
    write(root, { 'src/kit/database.ts': '', '.cossack/scaffold.json': JSON.stringify({ templateVersion: '0.9.3' }) });
    expect(hostContractProblems(root).map(problem => [problem.code, problem.message])).toEqual([
      ['COSSACK_PACKAGE_HOST_OUTDATED', expect.stringContaining('@acme/kit 1.4.0 needs project files from template 0.10.0, and this project is at 0.9.3. Run cossack upgrade.')],
    ]);
    write(root, { '.cossack/scaffold.json': JSON.stringify({ templateVersion: '0.10.0' }) });
    expect(hostContractProblems(root)).toEqual([]);
  });

  it('fails the build on a broken host contract and prints overrides once', async () => {
    const { root } = project({ 'src/pages/(site)/index.ts': page });
    const plugin = cossackPages({ templateDiagnostics: false });
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    const printed: string[] = [];
    const context = { environment: { mode: 'build' }, warn() {}, info: (line: string) => printed.push(line), error: (error: { message: string }) => { throw new Error(error.message); } };
    await (plugin.buildStart as Function).call(context);
    await (plugin.buildStart as Function).call(context);
    expect(printed).toEqual(['[cossack] src/pages/(site)/index.ts overrides @acme/kit']);
    rmSync(join(root, 'src/kit/database.ts'));
    await expect((plugin.buildStart as Function).call(context)).rejects.toThrow('COSSACK_PACKAGE_HOST_MISSING');
  });
});
