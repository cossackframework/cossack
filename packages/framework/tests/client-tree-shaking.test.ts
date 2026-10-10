// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { build, resolveConfig } from 'vite';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cossackPages, cossackLang } from '../src/vite-plugin';
import { cossackSecurityPlugin } from '../src/vite-security-plugin';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(styled = false) {
  const root = await mkdtemp(join(tmpdir(), 'cossack-client-tree-'));
  roots.push(root);
  // Exercise the published JS entries and their real export conditions, rather
  // than source aliases that could hide a library build freezing SSR to false.
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'src/pages/index.ts'), `
    import { Cossack, Page, Client, html${styled ? ', css' : ''} } from '@cossackframework/core';
    @Page({ transport: 'http' })
    export default class Hello extends Cossack {
      ${styled ? 'static styles = css`button { color: red; }`;' : ''}
      @Client() clickme() { console.log('Clicked'); }
      render() { return html\`<button @click=\${this.clickme}>Hello</button>\`; }
    }
  `);
  await writeFile(join(root, 'entry.ts'), `
    import { Cossack, html } from '@cossackframework/core';
    import { createClientApp } from '@cossackframework/framework/client/app';
    class App extends Cossack { render() { return html\`\${this.children}\`; } }
    void createClientApp({ container: '#root', AppComponent: App });
  `);
  return root;
}

async function clientBundle(styled = false) {
  const root = await fixture(styled);
  const result = await build({ root, configFile: false, logLevel: 'silent', mode: 'production',
    resolve: { alias: {
      '@cossackframework/framework/client/app': fileURLToPath(new URL('../dist/esm/client/app.js', import.meta.url)),
    } },
    plugins: [cossackSecurityPlugin(), cossackPages(), cossackLang()],
    build: { write: false, minify: false, rolldownOptions: { input: join(root, 'entry.ts') } },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap(bundle => 'output' in bundle ? bundle.output : []).filter(chunk => chunk.type === 'chunk');
  return { code: chunks.map(chunk => chunk.code).join('\n') };
}

describe('published client dependency boundaries', () => {
  it('removes unused libraries and server action implementations from a hello-world app', async () => {
    const { code } = await clientBundle();
    expect(code).toContain('Clicked');
    for (const name of ['reactive-store', 'origin-security', 'rate-limit', 'rate-limit-policy',
      'rate-limit-io', 'action-input', 'action-authorization', 'input-schema', 'css-scoping']) {
      // Inspect emitted code: Rolldown's chunk.modules currently reports the
      // pre-shaking length for some modules even when their code is removed.
      expect(code.includes(`/${name}.js`), name).toBe(false);
    }
    for (const dependency of ['css-tree', 'source-map-js', 'parse5']) {
      expect(code.includes(`/${dependency}/`), dependency).toBe(false);
    }
    for (const marker of ['Upstash', 'RedisRateLimitStore', 'Server input schema', 'COSSACK_RPC_REQUEST_DUPLICATE']) {
      expect(code).not.toContain(marker);
    }
    // Default SPA navigation and translation globals still use these modules.
    expect(code.includes('/navigation-draft.js')).toBe(true);
    expect(code.includes('/i18n.js')).toBe(true);
  }, 30000);

  it('retains the CSS parser when a component actually declares styles', async () => {
    const { code } = await clientBundle(true);
    expect(code.includes('/css-tree/')).toBe(true);
    expect(code.includes('/css-scoping.js')).toBe(true);
    expect(code).toContain('button { color: red; }');
  }, 30000);

  it.each([undefined, ['workerd', 'browser'], ['worker', 'browser']])(
    'preserves server dispatch with server conditions %j', async conditions => {
      const root = await fixture();
      const entry = join(root, 'server.ts');
      await writeFile(entry, "export { Cossack, isServer } from '@cossackframework/core';");
      const result = await build({ root, configFile: false, logLevel: 'silent',
        ssr: { noExternal: true, ...(conditions ? { resolve: { conditions } } : {}) },
        build: { write: false, minify: false, ssr: entry },
      });
      const chunks = (Array.isArray(result) ? result : [result])
        .flatMap(bundle => 'output' in bundle ? bundle.output : []).filter(chunk => chunk.type === 'chunk');
      const code = chunks.map(chunk => chunk.code).join('\n');
      expect(code.includes('COSSACK_RPC_REQUEST_DUPLICATE')).toBe(true);
      expect(code.includes('Upstash')).toBe(true);
      const compiled = join(root, 'compiled.mjs');
      await writeFile(compiled, code);
      expect((await import(compiled)).isServer).toBe(true);
      const core = await import('@cossackframework/core');
      expect(core.isServer).toBe(true);
    }, 30000);

  it('keeps explicitly imported browser APIs and rejects local server dispatch', async () => {
    const root = await fixture();
    const entry = join(root, 'browser.ts');
    await writeFile(entry, "export { Cossack, isServer, createStore, input } from '@cossackframework/core';");
    const result = await build({ root, configFile: false, logLevel: 'silent',
      build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
    });
    const chunks = (Array.isArray(result) ? result : [result])
      .flatMap(bundle => 'output' in bundle ? bundle.output : []).filter(chunk => chunk.type === 'chunk');
    const compiled = join(root, 'browser-compiled.mjs');
    await writeFile(compiled, chunks.map(chunk => chunk.code).join('\n'));
    const api = await import(compiled);
    expect(api.isServer).toBe(false);
    const store = api.createStore(1);
    const updates: number[] = [];
    store.subscribe((value: number) => updates.push(value));
    store.update((value: number) => value + 1);
    expect(updates).toEqual([1, 2]);
    expect(await api.input.string().parse('hello')).toBe('hello');
    await expect(new api.Cossack().executeAction('get', [], undefined, {})).rejects.toThrow(/only execute on the server/);
  }, 30000);

  it('pre-bundles linked libraries in dev and preserves user optimizer configuration', async () => {
    const root = await fixture();
    const config = await resolveConfig({ root, configFile: false, plugins: [cossackPages()],
      environments: { client: { optimizeDeps: { include: ['hono'], exclude: ['custom-library'] } } },
    }, 'serve');
    expect(config.environments.client.optimizeDeps.include).toEqual(expect.arrayContaining([
      'hono', '@cossackframework/core', '@cossackframework/core/devtools', '@cossackframework/renderer',
    ]));
    expect(config.environments.client.optimizeDeps.exclude).toContain('custom-library');
    expect(config.environments.ssr.optimizeDeps.include ?? []).not.toContain('@cossackframework/core');
  });
});
