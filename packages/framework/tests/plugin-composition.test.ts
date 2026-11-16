// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(routes.sources?.['/src/pages/api/tickets.ts']).toBe('/src/plugins/support-desk/pages/api/tickets.ts');
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
      .toEqual([expect.objectContaining({ name: 'a', version: '1.0.0', manifest: 'src/plugins/a/plugin.json' }), expect.objectContaining({ name: 'b', version: '2.0.0', manifest: 'src/plugins/b/plugin.json' })]);
    expect(pluginPageKey('/src/plugins/a/pages/x/index.ts')).toBe('/src/pages/x/index.ts');
    expect(pluginPageKey('/src/pages/x/index.ts')).toBe('/src/pages/x/index.ts');
  });

  it('imports plugin pages, layouts and loading states into the page registry by name', () => {
    const root = project({
      'src/pages/index.ts': page,
      'src/pages/layout.ts': page,
      'src/plugins/support-desk/plugin.json': manifest('support-desk'),
      'src/plugins/support-desk/pages/admin/tickets/index.ts': page,
      'src/plugins/support-desk/pages/admin/tickets/layout.ts': page,
      'src/plugins/support-desk/pages/admin/tickets/loading.ts': page,
    });
    const plugin = cossackPages();
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    const client = (plugin.load as Function).call({ environment: { name: 'client' } }, '\0virtual:cossack-pages') as string;
    // A plugin page keeps its route key and loads from its real path.
    expect(client).toContain('"/src/pages/admin/tickets/index.ts": () => import("/src/plugins/support-desk/pages/admin/tickets/index.ts"),');
    expect(client).toContain('"/src/pages/admin/tickets/layout.ts": () => import("/src/plugins/support-desk/pages/admin/tickets/layout.ts"),');
    // Loading states are eager in every environment.
    expect(client).toMatch(/import \* as (\w+) from "\/src\/plugins\/support-desk\/pages\/admin\/tickets\/loading\.ts";[\s\S]*"\/src\/pages\/admin\/tickets\/loading\.ts": \1,/);
    // The router asks the host whether a plugin's routes answer, by route key.
    expect(client).toContain('const owners = {"/src/pages/admin/tickets/index.ts":"support-desk","/src/pages/admin/tickets/layout.ts":"support-desk","/src/pages/admin/tickets/loading.ts":"support-desk"};');
    expect(client).toContain('const sources = {};');
    expect(client).toContain('export default { pages, layouts, loadings, components, owners, sources, handlers }');
    const server = (plugin.load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-pages') as string;
    // The server keeps the real paths, which key the build manifest.
    expect(server).toContain('"/src/pages/admin/tickets/index.ts":"/src/plugins/support-desk/pages/admin/tickets/index.ts"');
    expect(server).not.toContain('() => import(');
  });
});

describe('plugin registry', () => {
  it('sends names and versions to the browser and manifests plus server entries to the server', () => {
    const root = project({
      'src/plugins/support-desk/plugin.json': manifest('support-desk', '1.2.0'),
      'src/plugins/support-desk/server.ts': 'export const hooks = [];',
      'src/plugins/support-desk/ui.ts': 'export const slots = {};',
      'src/plugins/support-desk/templates/entry.ts': 'export default () => null;',
      'src/plugins/support-desk/templates/entry.test.ts': '',
      'src/plugins/support-desk/assets/logo.svg': '<svg/>',
      'src/plugins/support-desk/assets/notes.txt': '',
    });
    const plugins = readRenderedPlugins(root);
    const client = pluginRegistryModule(root, plugins, false);
    expect(client).toContain('"support-desk"');
    expect(client).not.toContain('server.ts');
    expect(client).not.toContain('plugin.json');
    expect(client).toMatch(/import \* as \w+ from "\/src\/plugins\/support-desk\/ui\.ts";/);
    // Logos, covers and theme stylesheets and fonts are build assets in both environments.
    expect(client).toMatch(/import \w+ from "\/src\/plugins\/support-desk\/assets\/logo\.svg\?url";/);
    expect(client).not.toContain('notes.txt');
    expect(client).toContain('assets: assetsOf(plugin.name)');
    // Theme templates are one module per file, in both environments.
    expect(client).toMatch(/import \* as \w+ from "\/src\/plugins\/support-desk\/templates\/entry\.ts";/);
    expect(client).not.toContain('entry.test.ts');
    expect(client).toContain('templates: templatesOf(plugin.name)');
    const server = pluginRegistryModule(root, plugins, true);
    expect(server).toMatch(/import \w+ from "\/src\/plugins\/support-desk\/plugin\.json";/);
    expect(server).toMatch(/import \* as \w+ from "\/src\/plugins\/support-desk\/server\.ts";/);
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
  /** Run a generated module: each import becomes the JSON content of the file it names. */
  function evaluate<T>(root: string, source: string): T {
    const load = (specifier: string) => ({ default: JSON.parse(readFileSync(join(root, specifier), 'utf8')) });
    const body = source
      .replace(/import \* as (\w+) from ("[^"]+");/g, 'const $1 = __load($2);')
      .replace(/import (\w+) from ("[^"]+");/g, 'const $1 = __load($2).default;')
      .replace(/\(\) => import\(("[^"]+")\)/g, 'async () => __load($1)')
      .replace(/export \{([^}]*)\};?/, 'return {$1};');
    return new Function('__load', body)(load) as T;
  }

  /** The generated catalog module of a project that holds these catalogs. */
  function langModule(environment: 'ssr' | 'client', files: Record<string, Record<string, string>>) {
    const root = project(Object.fromEntries(Object.entries(files).map(([file, messages]) => [file.slice(1), JSON.stringify(messages)])));
    const plugin = cossackLang();
    (plugin.configResolved as Function).call({}, { root });
    const source = (plugin.load as Function).call({ environment: { name: environment } }, '\0virtual:cossack-lang') as string;
    expect(source).not.toContain('import.meta.glob');
    return evaluate<{ supportedLocales: string[]; loadCatalog(locale: string): Promise<Record<string, string> | undefined> }>(root, source);
  }

  it.each(['ssr', 'client'] as const)('namespaces plugin catalogs and merges language packs (%s)', async environment => {
    const lang = langModule(environment, {
      '/src/lang/en.json': { Hello: 'Hello', Bye: 'Bye' },
      '/src/lang/vi.json': { Bye: 'Tạm biệt (app)' },
      '/src/plugins/support-desk/lang/en.json': { title: 'Support desk' },
      '/src/plugins/support-desk/lang/vi.json': { title: 'Bàn (plugin)', open: 'Mở' },
      '/src/plugins/support-desk/lang/de.json': { title: 'Helpdesk' },
      '/src/plugins/lang-vi/translations/vi.json': { Hello: 'Xin chào', Bye: 'Tạm biệt' },
      '/src/plugins/lang-vi/translations/vi/support-desk.json': { title: 'Bàn hỗ trợ' },
    });
    // Plugins' own catalogs join existing locales only; packs add theirs.
    expect(lang.supportedLocales).toEqual(['en', 'vi']);
    expect(await lang.loadCatalog('en')).toEqual({ Hello: 'Hello', Bye: 'Bye', 'support-desk::title': 'Support desk' });
    // Application keys override packs, and packs override a plugin's own catalog.
    expect(await lang.loadCatalog('vi')).toEqual({ Hello: 'Xin chào', Bye: 'Tạm biệt (app)', 'support-desk::title': 'Bàn hỗ trợ', 'support-desk::open': 'Mở' });
    expect(await lang.loadCatalog('de')).toBeUndefined();
  });

  it('gives a pack-only application an empty default catalog, so the source text stays the default', async () => {
    const lang = langModule('ssr', { '/src/plugins/lang-vi/translations/vi.json': { Hello: 'Xin chào' } });
    expect(lang.supportedLocales).toEqual(['en', 'vi']);
    expect(await lang.loadCatalog('en')).toEqual({});
    expect(langModule('ssr', { '/src/lang/es.json': { Hello: 'Hola' } }).supportedLocales).toEqual(['es']);
  });

  it('keys plugin configuration by plugin and file', async () => {
    const root = project({
      'src/config/app.ts': 'export default () => ({ name: "x" });',
      'src/plugins/support-desk/plugin.json': manifest('support-desk'),
      'src/plugins/support-desk/config/tickets.ts': 'export default () => ({ perPage: 20 });',
    });
    expect(discoverConfigSources(root)).toEqual([
      { key: 'app', source: 'src/config/app.ts', file: join(root, 'src/config/app.ts') },
      { key: 'support-desk::tickets', source: 'src/plugins/support-desk/config/tickets.ts', file: join(root, 'src/plugins/support-desk/config/tickets.ts') },
    ]);
    expect(generateConfigTypes(root, { write: false }).source).toContain('"support-desk::tickets": FactoryResult<typeof import("../src/plugins/support-desk/config/tickets.ts").default>;');
    const plugin = cossackConfig();
    writeFileSync(join(root, 'package.json'), '{}');
    await (plugin.configResolved as Function).call({}, { root, command: 'serve' });
    const source = (plugin.load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-config') as string;
    expect(source).toMatch(/import \* as \w+ from "\/src\/config\/app\.ts";/);
    expect(source).toMatch(/import \* as (\w+) from "\/src\/plugins\/support-desk\/config\/tickets\.ts";[\s\S]*"\/src\/plugins\/support-desk\/config\/tickets\.ts": \1,/);
    expect(source).toContain("parts[3] + '::' + file");
  });

  it('appends plugin middleware after the application list', () => {
    const root = project({
      'src/bootstrap/middlewares.ts': 'export default [];',
      'src/plugins/support-desk/plugin.json': manifest('support-desk'),
      'src/plugins/support-desk/middlewares.ts': 'export default [];',
    });
    const plugin = cossackMiddlewares();
    (plugin.configResolved as Function).call({}, { root });
    const server = (plugin.load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-middlewares') as string;
    expect(server).toMatch(/import \* as \w+ from "\/src\/plugins\/support-desk\/middlewares\.ts";/);
    expect(server.indexOf('"/src/bootstrap/middlewares.ts"')).toBeLessThan(server.indexOf('/src/plugins/support-desk/middlewares.ts'));
    // Tagged with the plugin's name, so the router runs them only while the plugin is active.
    expect(server).toContain('cossackPlugin: plugin');
    const client = (plugin.load as Function).call({ environment: { name: 'client' } }, '\0virtual:cossack-middlewares') as string;
    expect(client).not.toContain('plugins');
    // A project with no registry file has an empty list.
    const empty = cossackMiddlewares();
    (empty.configResolved as Function).call({}, { root: project({}) });
    expect((empty.load as Function).call({ environment: { name: 'ssr' } }, '\0virtual:cossack-middlewares')).toContain('const modules = {\n};');
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
