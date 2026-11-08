// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { bundleIsolatedPlugin, isolationReport, pluginInAppReason, pluginIsolation, PluginIsolationError } from '../src/plugin-isolation';
import { pluginRegistryModule, readRenderedPlugins } from '../src/plugin-sources';
import { cossackPages } from '../src/vite-plugin';
import { cloudflareBindingNames } from '../src/config-preflight';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A fake plugin runtime: an entrypoint that answers with the plugin's own export. */
const RUNTIME = `import { WorkerEntrypoint } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';
const calls = new AsyncLocalStorage();
export default function isolate(plugin, manifest) {
    return class extends WorkerEntrypoint {
        async describe() { return { name: manifest.name, exports: Object.keys(plugin).sort() }; }
        async answer(input) { return calls.run(input, () => plugin.answer(calls.getStore())); }
    };
}
`;

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cossack-isolation-'));
  roots.push(root);
  const all: Record<string, string> = {
    'package.json': '{ "name": "app", "private": true, "type": "module" }',
    'runtime/package.json': '{ "name": "runtime", "type": "module" }',
    'runtime/index.js': RUNTIME,
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

const manifest = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({ name, version: '1.0.0', ...extra });
const server = `import { label } from './lib/label';
export function register() {}
export function answer(input: { n: number }): string { return label(input.n); }
`;
const runtime = (root: string) => ({ runtime: join(root, 'runtime/index.js') });

describe('the isolated shape', () => {
  it('isolates a plugin with only server code and data', () => {
    const root = project({
      'src/plugins/desk/plugin.json': manifest('desk'), 'src/plugins/desk/server.ts': server,
      'src/plugins/desk/lang/en.json': '{}', 'src/plugins/desk/assets/logo.svg': '<svg/>',
    });
    expect(pluginInAppReason(root, readRenderedPlugins(root)[0]!)).toBeNull();
  });

  it('keeps a plugin in the application for each part that runs there', () => {
    const cases: [Record<string, string>, string][] = [
      [{ 'ui.ts': 'export {}' }, 'It has ui.ts, which runs in the application.'],
      [{ 'pages/dashboard/desk/index.ts': 'export {}', 'middlewares.ts': 'export default []' }, 'It has pages/, middlewares.ts, which run in the application.'],
      [{ 'components/x.ts': '', 'config/desk.ts': '', 'templates/home.ts': '' }, 'It has components/, config/, templates/, which run in the application.'],
    ];
    for (const [files, reason] of cases) {
      const root = project({ 'src/plugins/desk/plugin.json': manifest('desk'), ...Object.fromEntries(Object.entries(files).map(([file, content]) => [`src/plugins/desk/${file}`, content])) });
      expect(pluginInAppReason(root, readRenderedPlugins(root)[0]!)).toBe(reason);
    }
  });

  it('keeps unrestricted plugins and plugins added with --in-app in the application', () => {
    const unrestricted = project({ 'src/plugins/vault/plugin.json': manifest('vault', { permissions: { unrestricted: true } }) });
    expect(pluginInAppReason(unrestricted, readRenderedPlugins(unrestricted)[0]!)).toContain('unrestricted access');
    const inApp = project({ 'src/plugins/desk/plugin.json': manifest('desk', { isolation: false }) });
    expect(pluginInAppReason(inApp, readRenderedPlugins(inApp)[0]!)).toBe('It was added with --in-app.');
  });
});

describe('isolated bundles', () => {
  const desk = { 'src/plugins/desk/plugin.json': manifest('desk'), 'src/plugins/desk/server.ts': server, 'src/plugins/desk/lib/label.ts': 'export const label = (n: number) => `ticket #${n}`;\n' };

  it('bundles the server entry, its imports and the runtime into one module', async () => {
    const root = project(desk);
    const bundle = await bundleIsolatedPlugin(root, readRenderedPlugins(root)[0]!, runtime(root));
    expect(bundle.code).toContain('ticket #');
    expect(bundle.code).toMatch(/from ["']cloudflare:workers["']/);
    expect(bundle.code).not.toContain('import.meta.glob');
    expect(bundle.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.bytes).toBe(Buffer.byteLength(bundle.code));
    expect(bundle.watchFiles).toEqual(expect.arrayContaining([join(root, 'src/plugins/desk/server.ts'), join(root, 'src/plugins/desk/lib/label.ts')]));
    expect((await bundleIsolatedPlugin(root, readRenderedPlugins(root)[0]!, runtime(root))).hash).toBe(bundle.hash);
  });

  it('fails a plugin that imports a Node.js built-in or a platform module, naming the file', async () => {
    for (const [file, content, imported] of [
      ['server.ts', "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n", 'node:fs'],
      ['server.ts', "import { env } from 'cloudflare:workers';\nexport const bindings = env;\n", 'cloudflare:workers'],
      ['lib/label.ts', "import path from 'path';\nexport const label = (n: number) => path.join(String(n));\n", 'path'],
    ] as const) {
      const root = project({ ...desk, [`src/plugins/desk/${file}`]: content });
      const error = await bundleIsolatedPlugin(root, readRenderedPlugins(root)[0]!, runtime(root)).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PluginIsolationError);
      expect((error as PluginIsolationError).message).toContain(`src/plugins/desk/server.ts imports ${imported}`);
      if (file !== 'server.ts') expect((error as PluginIsolationError).message).toContain('through src/plugins/desk/lib/label.ts');
      expect((error as PluginIsolationError).message).toContain('--in-app');
    }
  });

  it('fails a plugin whose import cannot be found, instead of leaving it to fail the Worker', async () => {
    const root = project({ ...desk, 'src/plugins/desk/lib/label.ts': "import { label as base } from 'not-installed';\nexport const label = base;\n" });
    const error = await bundleIsolatedPlugin(root, readRenderedPlugins(root)[0]!, runtime(root)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PluginIsolationError);
    expect((error as Error).message).toContain('src/plugins/desk/server.ts imports not-installed through src/plugins/desk/lib/label.ts, which cannot be found.');
  });

  it('isolates on Cloudflare only, and reports sizes', async () => {
    const root = project({ ...desk, 'src/plugins/themed/plugin.json': manifest('themed'), 'src/plugins/themed/templates/home.ts': '', 'src/plugins/data/plugin.json': manifest('data') });
    const plugins = readRenderedPlugins(root);
    const cloudflare = await pluginIsolation(root, plugins, runtime(root), 'cloudflare');
    expect(cloudflare.entries.desk).toMatchObject({ mode: 'isolated', hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(cloudflare.entries.data).toEqual({ mode: 'isolated' });
    expect(cloudflare.entries.themed).toEqual({ mode: 'app', reason: 'It has templates/, which runs in the application.' });
    expect(isolationReport(cloudflare.entries)).toEqual([expect.stringMatching(/^\[cossack\] Isolated plugin desk: [0-9.]+ KB$/)]);
    const node = await pluginIsolation(root, plugins, runtime(root), 'node');
    expect(node.entries.desk).toEqual({ mode: 'app', reason: 'Node.js has no Worker Loader, so its server code runs in the application.' });
    expect(node.watchFiles).toEqual([]);
  });

  it('runs in a Worker of its own', async () => {
    const root = project(desk);
    const bundle = await bundleIsolatedPlugin(root, readRenderedPlugins(root)[0]!, runtime(root));
    const mf = new Miniflare({
      modules: true,
      compatibilityDate: '2026-06-06',
      workerLoaders: { LOADER: {} },
      script: `export default { async fetch(request, env) {
        const plugin = env.LOADER.get('desk@1.0.0', () => ({ compatibilityDate: '2026-06-06', compatibilityFlags: ['nodejs_als'], mainModule: 'plugin.js', modules: { 'plugin.js': ${JSON.stringify(bundle.code)} }, env: {}, globalOutbound: null })).getEntrypoint();
        return Response.json({ describe: await plugin.describe(), answer: await plugin.answer({ n: 7 }) });
      } };`,
    });
    try {
      expect(await (await mf.dispatchFetch('http://loader/')).json()).toEqual({ describe: { name: 'desk', exports: ['answer', 'register'] }, answer: 'ticket #7' });
    } finally {
      await mf.dispose();
    }
  }, 30_000);
});

describe('the Worker Loader binding', () => {
  it('is one of the Cloudflare bindings builds read', () => {
    expect(cloudflareBindingNames({ worker_loaders: [{ binding: 'LOADER' }], r2_buckets: [{ binding: 'MEDIA' }] })).toEqual(['LOADER', 'MEDIA']);
  });
});

describe('the registry with isolation', () => {
  it('leaves isolated server entries out of the application and carries where each runs', () => {
    const plugins = [{ name: 'desk', version: '1.0.0', manifest: 'src/plugins/desk/plugin.json' }, { name: 'shop', version: '2.0.0', manifest: 'src/plugins/shop/plugin.json' }];
    const source = pluginRegistryModule(plugins, true, { desk: { mode: 'isolated', code: 'export default 1;', hash: 'abc', bytes: 17 } as never, shop: { mode: 'app', reason: 'It has ui.ts, which runs in the application.' } as never });
    expect(source).toContain(`import.meta.glob(["/src/plugins/*/server.ts","!/src/plugins/desk/server.ts"], { eager: true })`);
    expect(source).toContain('"code":"export default 1;"');
    expect(source).toContain('isolation: freeze(isolation[name])');
    expect(pluginRegistryModule(plugins, true)).toContain("import.meta.glob('/src/plugins/*/server.ts', { eager: true })");
    expect(pluginRegistryModule(plugins, false)).not.toContain('isolation');
  });

  it('is built by the pages plugin for server environments, with a size report on builds', async () => {
    const root = project({ 'src/plugins/desk/plugin.json': manifest('desk'), 'src/plugins/desk/server.ts': server, 'src/plugins/desk/lib/label.ts': 'export const label = (n: number) => String(n);\n' });
    const plugin = cossackPages({ capabilities: { runtime: 'cloudflare', bindings: ['LOADER'] }, pluginIsolation: runtime(root) });
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    const watched: string[] = [];
    const logged: string[] = [];
    const context = (name: string) => ({ environment: { name, mode: 'build', logger: { info: (line: string) => logged.push(line) } }, addWatchFile: (file: string) => watched.push(file), error: (error: unknown) => { throw error; } });
    const client = (plugin.load as Function).call(context('client'), '\0virtual:cossack-plugins');
    expect(typeof client).toBe('string');
    const ssr = await (plugin.load as Function).call(context('ssr'), '\0virtual:cossack-plugins');
    expect(ssr).toContain('"mode":"isolated"');
    expect(ssr).toContain('!/src/plugins/desk/server.ts');
    expect(watched).toContain(join(root, 'src/plugins/desk/lib/label.ts'));
    expect(logged).toEqual([expect.stringContaining('Isolated plugin desk:')]);
  });

  it('fails a Cloudflare build that isolates a plugin without the Worker Loader binding', async () => {
    const root = project({ 'src/plugins/desk/plugin.json': manifest('desk'), 'src/plugins/desk/server.ts': 'export function register() {}\n', 'src/plugins/data/plugin.json': manifest('data') });
    const plugin = cossackPages({ capabilities: { runtime: 'cloudflare', bindings: ['ASSETS'] }, pluginIsolation: runtime(root) });
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    const context = { environment: { name: 'ssr', mode: 'build', logger: { info() {} } }, addWatchFile() {}, error: (error: { message: string }) => { throw new Error(error.message); } };
    await expect((plugin.load as Function).call(context, '\0virtual:cossack-plugins')).rejects.toThrow('desk runs isolated and needs the Worker Loader binding. Add "worker_loaders": [{ "binding": "LOADER" }]');
    // A plugin with no server code runs nothing, so it needs no binding.
    rmSync(join(root, 'src/plugins/desk'), { recursive: true });
    await expect((plugin.load as Function).call(context, '\0virtual:cossack-plugins')).resolves.toContain('"data"');
  });
});
