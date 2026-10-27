// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cossackConfig, cossackLang, cossackMiddlewares, cossackPages } from '../src/vite-plugin';
import { listPlugins, pluginPageKey, pluginRegistryModule, PluginSourceError, readRenderedPlugins, scanPageSources } from '../src/plugin-sources';
import { discoverRoutes, renderRouteSource } from '../src/route-codegen';
import { discoverConfigSources, generateConfigTypes } from '../src/config-codegen';
import { isServerOnlyModule } from '../src/vite-security-plugin';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cossack-plugins-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

const page = 'export default class Page {}';
const manifest = (name: string, version = '1.0.0') => JSON.stringify({ name, version });

describe('plugin pages', () => {
  it('overlay the application tree with real sources and plugin owners', () => {
    const root = project({
      'src/pages/index.ts': page,
      'src/pages/layout.ts': page,
      'src/pages/admin/layout.ts': page,
      'src/plugins/support-desk/plugin.json': manifest('support-desk'),
      'src/plugins/support-desk/pages/admin/tickets/index.ts': page,
      'src/plugins/support-desk/pages/admin/tickets/[id]/index.ts': page,
      'src/plugins/support-desk/pages/admin/tickets/layout.ts': page,
      'src/plugins/support-desk/pages/admin/tickets/loading.ts': page,
      'src/plugins/support-desk/pages/api/tickets.ts': 'export const GET = () => new Response();',
    });
    const sources = scanPageSources(root);
    expect(sources.pageKeys).toEqual([
      '/src/pages/admin/tickets/[id]/index.ts', '/src/pages/admin/tickets/index.ts', '/src/pages/api/tickets.ts', '/src/pages/index.ts',
    ]);
    expect(sources.layoutKeys).toEqual(['/src/pages/admin/layout.ts', '/src/pages/admin/tickets/layout.ts', '/src/pages/layout.ts']);
    expect(sources.loadingKeys).toEqual(['/src/pages/admin/tickets/loading.ts']);
    expect(sources.sources['/src/pages/admin/tickets/index.ts']).toBe('/src/plugins/support-desk/pages/admin/tickets/index.ts');
    expect(sources.plugins['/src/pages/admin/tickets/index.ts']).toBe('support-desk');
    expect(sources.plugins['/src/pages/index.ts']).toBeUndefined();

    const routes = discoverRoutes(root);
    const tickets = routes.routes.find(route => route.pattern === '/admin/tickets')!;
    expect(tickets.layoutPaths).toEqual(['/src/pages/layout.ts', '/src/pages/admin/layout.ts', '/src/pages/admin/tickets/layout.ts']);
    expect(routes.routes.find(route => route.pattern === '/admin/tickets/:id')).toBeDefined();
    expect(renderRouteSource(routes)).toContain('typeof import("../src/plugins/support-desk/pages/api/tickets.ts")');
  });

  it('fails on a path both the application and a plugin define', () => {
    const root = project({
      'src/pages/tickets/index.ts': page,
      'src/plugins/support-desk/plugin.json': manifest('support-desk'),
      'src/plugins/support-desk/pages/tickets/index.ts': page,
    });
    expect(() => scanPageSources(root)).toThrow(expect.objectContaining({ code: 'COSSACK_PLUGIN_ROUTE_CONFLICT', file: 'src/plugins/support-desk/pages/tickets/index.ts' }));
    const two = project({
      'src/plugins/a/plugin.json': manifest('a'), 'src/plugins/a/pages/x/layout.ts': page,
      'src/plugins/b/plugin.json': manifest('b'), 'src/plugins/b/pages/x/layout.ts': page,
    });
    expect(() => scanPageSources(two)).toThrow(/both define \/x\/layout\.ts/);
  });

  it('rejects invalid plugin directory names and manifests', () => {
    expect(() => listPlugins(project({ 'src/plugins/Bad_Name/plugin.json': '{}' }))).toThrow(PluginSourceError);
    expect(() => readRenderedPlugins(project({ 'src/plugins/a/pages/index.ts': page }))).toThrow(expect.objectContaining({ code: 'COSSACK_PLUGIN_MANIFEST_INVALID' }));
    expect(() => readRenderedPlugins(project({ 'src/plugins/a/plugin.json': manifest('b') }))).toThrow(/must name the plugin "a"/);
    expect(readRenderedPlugins(project({ 'src/plugins/b/plugin.json': manifest('b', '2.0.0'), 'src/plugins/a/plugin.json': manifest('a') })))
      .toEqual([{ name: 'a', version: '1.0.0', manifest: 'src/plugins/a/plugin.json' }, { name: 'b', version: '2.0.0', manifest: 'src/plugins/b/plugin.json' }]);
    expect(pluginPageKey('/src/plugins/a/pages/x/index.ts')).toBe('/src/pages/x/index.ts');
    expect(pluginPageKey('/src/pages/x/index.ts')).toBe('/src/pages/x/index.ts');
  });

  it('globs plugin pages, layouts and loading states into the page registry', () => {
    const plugin = cossackPages();
    for (const name of ['client', 'ssr']) {
      const source = (plugin.load as Function).call({ environment: { name } }, '\0virtual:cossack-pages') as string;
      expect(source).toContain('/src/plugins/*/pages/**/*.ts');
      expect(source).toContain('!/src/plugins/*/pages/**/layout.ts');
      expect(source).toContain('/src/plugins/*/pages/**/loading.ts');
      expect(source).toContain('COSSACK_PLUGIN_ROUTE_CONFLICT');
    }
  });
});

describe('plugin registry', () => {
  it('sends names and versions to the browser and manifests plus server entries to the server', () => {
    const plugins = [{ name: 'support-desk', version: '1.2.0', manifest: 'src/plugins/support-desk/plugin.json' }];
    const client = pluginRegistryModule(plugins, false);
    expect(client).toContain('"support-desk"');
    expect(client).not.toContain('server.ts');
    expect(client).not.toContain('plugin.json');
    expect(client).toContain("import.meta.glob('/src/plugins/*/ui.ts', { eager: true })");
    // Logos, covers and theme stylesheets and fonts are build assets in both environments.
    expect(client).toContain("import.meta.glob('/src/plugins/*/assets/*.{png,jpg,jpeg,webp,gif,avif,svg,css,woff2,woff,ttf,otf}', { eager: true, query: '?url', import: 'default' })");
    expect(client).toContain('assets: assetsOf(plugin.name)');
    // Theme templates are one module per file, in both environments.
    expect(client).toContain("import.meta.glob('/src/plugins/*/templates/*.ts', { eager: true })");
    expect(client).toContain('templates: templatesOf(plugin.name)');
    const server = pluginRegistryModule(plugins, true);
    expect(server).toContain("import.meta.glob('/src/plugins/*/plugin.json', { eager: true, import: 'default' })");
    expect(server).toContain("import.meta.glob('/src/plugins/*/server.ts', { eager: true })");
    expect(server).toContain('templates: templatesOf(name)');
  });

  it('is served by the pages plugin', () => {
    const root = project({ 'src/plugins/a/plugin.json': manifest('a') });
    const plugin = cossackPages();
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    expect((plugin.resolveId as Function)('virtual:cossack-plugins')).toBe('\0virtual:cossack-plugins');
    const watched: string[] = [];
    const source = (plugin.load as Function).call({ environment: { name: 'client' }, addWatchFile: (file: string) => watched.push(file) }, '\0virtual:cossack-plugins');
    expect(source).toContain('"a"');
    expect(watched).toEqual([join(root, 'src/plugins/a/plugin.json')]);
  });
});

describe('plugin translations, configuration and middleware', () => {
  it('namespaces plugin catalogs under the application locales', () => {
    const source = (cossackLang().load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-lang') as string;
    expect(source).toContain("import.meta.glob('/src/plugins/*/lang/*.json', { eager: true })");
    expect(source).toContain("plugin + '::' + name");
    // Application keys override plugin keys.
    expect(source).toContain('Object.assign(merged, messages)');
  });

  it('keys plugin configuration by plugin and file', () => {
    const root = project({
      'src/config/app.ts': 'export default () => ({ name: "x" });',
      'src/plugins/support-desk/plugin.json': manifest('support-desk'),
      'src/plugins/support-desk/config/tickets.ts': 'export default () => ({ perPage: 20 });',
    });
    expect(discoverConfigSources(root)).toEqual([
      { key: 'app', source: 'src/config/app.ts' },
      { key: 'support-desk::tickets', source: 'src/plugins/support-desk/config/tickets.ts' },
    ]);
    expect(generateConfigTypes(root, { write: false }).source).toContain('"support-desk::tickets": FactoryResult<typeof import("../src/plugins/support-desk/config/tickets.ts").default>;');
    const plugin = cossackConfig();
    const source = (plugin.load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-config') as string;
    expect(source).toContain('/src/plugins/*/config/*.ts');
    expect(source).toContain("parts[3] + '::' + file");
  });

  it('appends plugin middleware after the application list', () => {
    const plugin = cossackMiddlewares();
    const server = (plugin.load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-middlewares') as string;
    expect(server).toContain("import.meta.glob('/src/plugins/*/middlewares.ts', { eager: true })");
    expect(server.indexOf("'/src/bootstrap/middlewares.ts'")).toBeLessThan(server.indexOf('/src/plugins/*/middlewares.ts'));
    const client = (plugin.load as Function).call({ environment: { name: 'client' } }, '\0virtual:cossack-middlewares') as string;
    expect(client).not.toContain('plugins');
  });
});

describe('plugin source stripping', () => {
  it('treats RomeDB and CMS server entries as server-only but keeps typed values client-safe', () => {
    const root = project({
      'a.ts': "import { createRomeDB } from '@cossackframework/romedb'; export const x = createRomeDB;",
      'b.ts': "import { RomeDBPendingWrites } from '@cossackframework/romedb/cloudflare'; export { RomeDBPendingWrites };",
      'c.ts': "import { RecordId } from '@cossackframework/romedb/values'; export { RecordId };",
      'd.ts': "import { createResourceRepository } from '@cossackframework/cms/server'; export { createResourceRepository };",
      'e.ts': "import { defineResource } from '@cossackframework/cms'; export { defineResource };",
    });
    expect(isServerOnlyModule(join(root, 'a.ts'))).toBe(true);
    expect(isServerOnlyModule(join(root, 'b.ts'))).toBe(true);
    expect(isServerOnlyModule(join(root, 'c.ts'))).toBe(false);
    expect(isServerOnlyModule(join(root, 'd.ts'))).toBe(true);
    expect(isServerOnlyModule(join(root, 'e.ts'))).toBe(false);
  });
});
