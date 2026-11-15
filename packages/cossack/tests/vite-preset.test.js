import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '@cossackframework/scaffold';
import { cossackApp, projectModule } from '../src/vite.js';

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function install(root, name, files) {
  const directory = path.join(root, 'node_modules', name);
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, rel)), { recursive: true });
    await fs.writeFile(path.join(directory, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
}

// The preset composes plugins the project has installed. These stand-ins record the options
// each one is called with, which is what the preset decides.
const recorded = name => `options => ({ name: '${name}', options })`;
async function project(options, mounted = []) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-vite-preset-'));
  roots.push(cwd);
  const { projectDir: root } = await createApp('app', { cwd, interactive: false, preset: 'minimal', ...options });
  await install(root, '@cossackframework/framework', {
    'package.json': { name: '@cossackframework/framework', type: 'module', exports: {
      './vite-plugin': { types: './types.d.ts', import: './plugin.js' }, './vite-security-plugin': { import: './security.js' },
      './vite-ssg-plugin': { import: './ssg.js' }, './package-mounts': { import: './mounts.js' } } },
    'plugin.js': ['cossackPages', 'cossackLang', 'cossackMiddlewares', 'cossackConfig', 'cossackBuildBudgets', 'cossackWorkflows', 'cossackSchedules']
      .map(name => `export const ${name} = ${recorded(name)};`).join('\n'),
    'security.js': `export const cossackSecurityPlugin = ${recorded('cossackSecurityPlugin')};`,
    'ssg.js': `export const cossackSsg = ${recorded('cossackSsg')};`,
    'mounts.js': `export const mountedPackages = () => ${JSON.stringify(mounted)};`,
  });
  await install(root, '@cloudflare/vite-plugin', { 'package.json': { name: '@cloudflare/vite-plugin', type: 'module', exports: { '.': { import: './index.js' } } }, 'index.js': `export const cloudflare = ${recorded('cloudflare')};` });
  await install(root, '@cossackframework/node-adapter', { 'package.json': { name: '@cossackframework/node-adapter', type: 'module', exports: { './vite': { import: './vite.js' } } }, 'vite.js': `export const cossackNode = ${recorded('cossackNode')};` });
  await install(root, '@tailwindcss/vite', { 'package.json': { name: '@tailwindcss/vite', type: 'module', exports: { '.': { require: './no.cjs', import: './index.js' } } }, 'index.js': `export default ${recorded('tailwind')};` });
  return root;
}
const configOf = (root, options = {}, env = { mode: 'production', command: 'build' }) => cossackApp({ root, ...options })(env);
const plugin = (config, name) => config.plugins.find(entry => entry.name === name);
const names = config => config.plugins.map(entry => entry.name);

describe('cossack/vite preset', () => {
  it('resolves a project dependency by its import condition', async () => {
    const root = await project({ adapter: 'node' });
    expect(projectModule(root, '@tailwindcss/vite')).toBe(path.join(await fs.realpath(root), 'node_modules/@tailwindcss/vite/index.js'));
    expect(projectModule(root, '@cossackframework/framework/vite-plugin')).toMatch(/plugin\.js$/);
    expect(projectModule(root, 'not-installed')).toBeNull();
  });

  it('composes the Cloudflare runtime, and sends one Wrangler configuration path to every plugin that reads it', async () => {
    const root = await project({ adapter: 'cloudflare' });
    const config = await configOf(root, { configPath: 'deployment/worker.jsonc', cloudflare: { auxiliaryWorkers: [] } });
    expect(names(config)).toEqual(['tailwind', 'cloudflare', 'cossackBuildBudgets', 'cossackSecurityPlugin', 'cossackPages', 'cossackLang', 'cossackMiddlewares', 'cossackConfig', 'cossackSsg']);
    expect(plugin(config, 'cloudflare').options).toEqual({ viteEnvironment: { name: 'ssr' }, configPath: 'deployment/worker.jsonc', auxiliaryWorkers: [] });
    for (const name of ['cossackBuildBudgets', 'cossackConfig', 'cossackPages']) expect(plugin(config, name).options.configPath).toBe('deployment/worker.jsonc');
    expect(plugin(config, 'cossackPages').options.capabilities).toEqual({ runtime: 'cloudflare', requirements: [] });
    expect(config.resolve.alias).toEqual({ '@': path.join(root, 'src'), '~': path.join(root, 'dist/client') });
    expect(config.build.minify).toBe(true);
    expect(config.server.watch.ignored).toEqual(['**/.wrangler/**', '**/storage/**', '**/.cossack/*-pending/**']);
  });

  it('gives the build what the recorded features need from the runtime, for the web and for Desktop', async () => {
    const root = await project({ adapter: 'node', preset: 'database', features: ['desktop'] });
    const source = { file: '.cossack/scaffold.json' };
    const web = await configOf(root);
    expect(names(web)).toContain('cossackNode');
    expect(names(web)).not.toContain('cloudflare');
    expect(plugin(web, 'cossackPages').options.capabilities).toEqual({ runtime: 'node', requirements: [{ feature: 'database/sqlite', source, requires: { filesystem: true } }] });
    expect(web.environments.ssr.resolve.noExternal).toEqual(expect.arrayContaining(['hono', 'css-tree']));
    expect(web.environments.ssr.optimizeDeps.include).toContain('@cossackframework/database');
    expect(web.environments.ssr.build.sourcemap).toBe(true);

    const desktop = await configOf(root, {}, { mode: 'desktop', command: 'build' });
    expect(names(desktop)).not.toContain('cossackNode');
    expect(plugin(desktop, 'cossackPages').options.capabilities).toEqual({ runtime: 'desktop', requirements: [
      { feature: 'database/sqlite', source, requires: { filesystem: true } }, { feature: 'desktop', source, requires: { filesystem: true } }] });
    expect(desktop.environments.ssr.resolve).toEqual({ external: ['electron'], noExternal: true });
    expect(desktop.environments.ssr.build.sourcemap).toBe(false);
    // A project can state other capabilities; they are merged with the recorded ones.
    const stated = await configOf(root, { pages: { capabilities: { bindings: [], runtime: 'cloudflare' } } });
    expect(plugin(stated, 'cossackPages').options.capabilities).toMatchObject({ bindings: [], runtime: 'cloudflare', requirements: [expect.objectContaining({ feature: 'database/sqlite' })] });
  });

  it('names only the optional packages the project has', async () => {
    const minimal = await configOf(await project({ adapter: 'node' }));
    expect(minimal.resolve.dedupe).toEqual(['@cossackframework/core', '@cossackframework/renderer', '@cossackframework/framework', 'hono', 'reflect-metadata']);
    expect(minimal.environments.ssr.optimizeDeps.include).not.toContain('@cossackframework/ui');
    const full = await configOf(await project({ adapter: 'node', preset: 'full-stack' }));
    expect(full.resolve.dedupe).toEqual(expect.arrayContaining(['@cossackframework/ui', '@cossackframework/solar-icons', '@cossackframework/auth']));
    expect(full.environments.ssr.resolve.noExternal).toEqual(expect.arrayContaining(['@cossackframework/ui', '@cossackframework/solar-icons']));
    expect(full.environments.ssr.optimizeDeps.include).toEqual(expect.arrayContaining(['@cossackframework/ui', '@cossackframework/auth', '@cossackframework/database']));
  });

  it('adds the plugins of the workflow and schedule features', async () => {
    const config = await configOf(await project({ adapter: 'cloudflare', features: ['workflows', 'schedules'] }));
    expect(names(config)).toEqual(expect.arrayContaining(['cossackWorkflows', 'cossackSchedules']));
    expect(names(await configOf(await project({ adapter: 'cloudflare' })))).not.toContain('cossackWorkflows');
  });

  it('adds the part of a mounted package: its plugins, its options and its configuration', async () => {
    const root = await project({ adapter: 'node' }, []);
    const part = path.join(root, 'part.js');
    await fs.writeFile(part, `export const cossackVite = ({ runtime }) => ({
      setup: [{ name: 'database-dev' }], plugins: [{ name: 'icons' }], pluginPolicy: true,
      pages: { pluginIsolation: { runtime: 'kit/isolate' } }, cloudflare: { config: 'vars' },
      config: { environments: { ssr: { resolve: { external: ['native-' + runtime] } } } },
    });`);
    await install(root, '@cossackframework/framework', { 'mounts.js': `export const mountedPackages = () => [{ name: 'kit', vite: ${JSON.stringify(part)} }];` });
    const config = await configOf(root);
    expect(names(config)[0]).toBe('database-dev');
    expect(names(config).indexOf('icons')).toBeGreaterThan(names(config).indexOf('cossackConfig'));
    expect(names(config)).toContain('cossack-plugin-policy');
    expect(plugin(config, 'cossackPages').options.pluginIsolation).toEqual({ runtime: 'kit/isolate' });
    expect(config.environments.ssr.resolve.external).toEqual(['native-node']);
    expect(config.environments.ssr.resolve.noExternal).toContain('hono');
  });

  it('takes the project\'s own options last', async () => {
    const root = await project({ adapter: 'node', features: ['markdown'] });
    const processor = () => null;
    const config = await configOf(root, {
      markdownProcessor: processor, ssg: false, plugins: [{ name: 'own' }], pages: { developmentTraces: true },
      config: ({ mode }) => ({ build: { minify: false }, define: { MODE: JSON.stringify(mode) } }),
    });
    expect(plugin(config, 'cossackPages').options).toMatchObject({ markdownProcessor: processor, developmentTraces: true });
    expect(names(config)).not.toContain('cossackSsg');
    expect(names(config).at(-1)).toBe('own');
    expect(config.build.minify).toBe(false);
    expect(config.define).toEqual({ MODE: '"production"' });
    expect((await configOf(root, { ssg: { baseUrl: 'https://example.test' } })).plugins.find(entry => entry.name === 'cossackSsg').options).toEqual({ baseUrl: 'https://example.test' });
  });
});
