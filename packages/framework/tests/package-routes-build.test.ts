// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { cp, mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cossackConfig, cossackLang, cossackMiddlewares, cossackPages } from '../src/vite-plugin';
import { cossackSecurityPlugin } from '../src/vite-security-plugin';

const fixturePackage = fileURLToPath(new URL('./fixtures/page-package', import.meta.url));
const dependencies = fileURLToPath(new URL('../node_modules', import.meta.url));

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

/** An application that mounts the fixture package: a workspace link, or a copy as an install leaves it. */
async function application(mode: 'linked' | 'packed', files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), `cossack-package-routes-${mode}-`));
  roots.push(root);
  await mkdir(join(root, 'node_modules/@fixture'), { recursive: true });
  // The application's own dependencies, as installed for this package.
  for (const name of await readdir(dependencies)) {
    if (!name.startsWith('.')) await symlink(join(dependencies, name), join(root, 'node_modules', name), 'dir').catch(() => {});
  }
  const installed = join(root, 'node_modules/@fixture/page-package');
  if (mode === 'linked') await symlink(fixturePackage, installed, 'dir');
  else await cp(fixturePackage, installed, { recursive: true });
  const all: Record<string, string> = {
    'package.json': JSON.stringify({ type: 'module', cossack: { packages: ['@fixture/page-package'] } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler' } }),
    'src/kit/host.ts': "export const hostName = 'HOST_MODULE';\n",
    'src/pages/layout.ts': "import { Cossack, html } from '@cossackframework/core';\nexport default class Layout extends Cossack { render() { return html`<main data-app-layout>${this.children}</main>`; } }\n",
    'entry.ts': `
      import { Cossack, html } from '@cossackframework/core';
      import { createClientApp } from '@cossackframework/framework/client/app';
      class App extends Cossack { render() { return html\`\${this.children}\`; } }
      void createClientApp({ container: '#root', AppComponent: App });
    `,
    'server.ts': "export { default as registry } from 'virtual:cossack-pages';\nexport { default as realtime } from 'virtual:cossack-realtime-components';\nexport { default as config } from 'virtual:cossack-config';\n",
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), content);
  }
  return root;
}

const plugins = () => [cossackSecurityPlugin({ devWarning: false }), cossackPages({ templateDiagnostics: false }), cossackLang(), cossackMiddlewares(), cossackConfig()];
const alias = (root: string) => ({
  '@cossackframework/framework/client/app': fileURLToPath(new URL('../dist/esm/client/app.js', import.meta.url)),
  '@': join(root, 'src'),
});

async function chunksOf(root: string, input: string, ssr: boolean) {
  const result = await build({ root, configFile: false, logLevel: 'silent', mode: 'production',
    resolve: { alias: alias(root) }, plugins: plugins(),
    ...(ssr ? { ssr: { noExternal: true as const } } : {}),
    build: { write: false, minify: false, manifest: true, ...(ssr ? { ssr: join(root, input) } : {}), rolldownOptions: { input: join(root, input) } },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(bundle => 'output' in bundle ? bundle.output : []);
  return {
    chunks: output.filter(chunk => chunk.type === 'chunk'),
    manifest: JSON.parse(String(output.flatMap(item => item.type === 'asset' && item.fileName.endsWith('manifest.json') ? [item.source] : [])[0] ?? '{}')) as Record<string, { file: string }>,
  };
}

const SERVER_ONLY = ['KIT_SERVER_SECRET', 'KIT_RESOURCE_SECRET', 'KIT_API_SECRET', 'KIT_CONFIG_SECRET', 'KIT_ONLY_SERVER'];

describe('a mounted package in a real build', () => {
  it('strips server code from served files, the same for a linked package and an installed one', async () => {
    const built: Record<string, Record<string, string>> = {};
    for (const mode of ['linked', 'packed'] as const) {
      const root = await application(mode);
      const { chunks, manifest } = await chunksOf(root, 'entry.ts', false);
      const code = chunks.map(chunk => chunk.code).sort().join('\n');
      for (const marker of SERVER_ONLY) expect(code.includes(marker), `${mode}: ${marker}`).toBe(false);
      // The served page reached the browser with its client method, the application's host module and layouts.
      expect(code).toContain('KIT_CLIENT_MARKER');
      expect(code).toContain('HOST_MODULE');
      expect(code).toContain('data-kit-layout');
      expect(code).toContain('KIT_PLUGIN_PAGE');
      // The realtime component's id names the package, not where it is installed.
      expect(code).toContain('"@fixture/page-package/components/Counter.ts#Counter"');
      expect(code).not.toContain('.pnpm');
      // The build manifest has the served page under its real path, which the preloads use.
      const pageKey = Object.keys(manifest).find(key => key.endsWith('page-package/app/src/pages/kit/index.ts'));
      expect(pageKey, mode).toBeDefined();
      // Each served module's code as the browser gets it, keyed by its path under the served root.
      built[mode] = Object.fromEntries(chunks.flatMap(chunk => Object.entries(chunk.modules))
        .filter(([id]) => id.includes('/page-package/app/src/'))// The bundler's region comment names the file's location; everything else is the module's code.
        .map(([id, module]) => [id.split('/page-package/app/src/')[1]!, (module.code ?? '').replace(/^\/\/#region .*$/m, '//#region')]).sort());
    }
    // Byte for byte: where the package is installed changes nothing in the client's code.
    expect(Object.keys(built.linked!)).toEqual(['components/Counter.ts', 'pages/api/kit/ping.ts', 'pages/kit/index.ts', 'pages/kit/layout.ts', 'plugins/kit-plugin/pages/kit-plugin/index.ts']);
    expect(built.packed).toEqual(built.linked);
    // Decorators are compiled with the application's settings in both.
    expect(built.packed!['pages/kit/index.ts']).toContain('__decorate(');
    expect(built.packed!['pages/kit/index.ts']).not.toMatch(/^\s*@\w+\(/m);
  }, 120000);

  it('keeps server code on the server under the same generated names', async () => {
    const names: string[][] = [];
    for (const mode of ['linked', 'packed'] as const) {
      const root = await application(mode);
      const server = (await chunksOf(root, 'server.ts', true)).chunks.map(chunk => chunk.code).join('\n');
      for (const marker of SERVER_ONLY) expect(server.includes(marker), `${mode}: ${marker}`).toBe(true);
      // The registry builds the realtime component from the package's file, and config joins under its file name.
      expect(server).toContain('"@fixture/page-package/components/Counter.ts#Counter"');
      const client = (await chunksOf(root, 'entry.ts', false)).chunks.map(chunk => chunk.code).join('\n');
      const generated = [...new Set(server.match(/__cossack_server_resource_\w+/g))].sort();
      expect(generated).toHaveLength(1);
      // The browser calls the method the server registered.
      expect(client).toContain(generated[0]);
      names.push(generated);
    }
    expect(names[1]).toEqual(names[0]);
  }, 120000);

  it('leaves a file out of the bundle when the application overrides it', async () => {
    const root = await application('packed', {
      'src/pages/kit/index.ts': "import { Cossack, Page, html } from '@cossackframework/core';\n@Page({ transport: 'http' })\nexport default class Mine extends Cossack { render() { return html`<p>APP_OVERRIDE</p>`; } }\n",
    });
    const code = (await chunksOf(root, 'entry.ts', false)).chunks.map(chunk => chunk.code).join('\n');
    expect(code).toContain('APP_OVERRIDE');
    expect(code).not.toContain('KIT_CLIENT_MARKER');
    // The package's layout still wraps the application's page.
    expect(code).toContain('data-kit-layout');
  }, 120000);

  it('fails the build when the application lacks a module the package needs', async () => {
    const root = await application('packed');
    await rm(join(root, 'src/kit/host.ts'));
    await expect(chunksOf(root, 'entry.ts', false)).rejects.toThrow(/COSSACK_PACKAGE_HOST_MISSING/);
  }, 120000);
});
