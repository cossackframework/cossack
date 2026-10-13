// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRouteBuilder } from '@cossackframework/core/routes';
import { discoverRoutes, generateRoutes } from '../src/route-codegen';
import { cossackPages } from '../src/vite-plugin';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function project() { const root = mkdtempSync(join(tmpdir(), 'cossack-route-codegen-')); roots.push(root); return root; }
function write(root: string, file: string, content = 'export default class Page {}') {
  const absolute = join(root, file); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, content); return absolute;
}

describe('shared structural route model', () => {
  it('keeps winning source identities, source ancestry and nearest boundaries in generated metadata', () => {
    const root = project();
    for (const file of ['layout.ts', '(public)/layout.ts', '(public)/users/[id]/index.ts',
      '(public)/users/404/index.ts', '(public)/error/index.ts', 'error/index.ts', '404/index.ts',
      'docs/[...path]/index.ts', 'api/items/[id].ts', 'home/index.ts', '(shadow)/home/index.ts']) write(root, `src/pages/${file}`);
    const generated = generateRoutes(root);
    expect(generated.manifest.routes.find(route => route.name === '/users/[id]')).toMatchObject({
      pattern: '/users/:id', filePath: '/src/pages/(public)/users/[id]/index.ts',
      parameters: [{ name: 'id', catchAll: false }],
      layoutPaths: ['/src/pages/layout.ts', '/src/pages/(public)/layout.ts'],
      errorBoundary: '/src/pages/(public)/error/index.ts', notFoundBoundary: '/src/pages/(public)/users/404/index.ts',
    });
    expect(generated.manifest.routes.find(route => route.name === '/home')?.filePath).toBe('/src/pages/home/index.ts');
    expect(generated.source).toContain('"/docs/[...path]": "/docs/:path{.+}"');
    expect(generated.source).toContain('"/api/items/[id]": "/api/items/:id"');
    expect(generated.source).toContain('typeof import("../src/pages/api/items/[id].ts")');
    expect(generated.source).not.toMatch(/^import\s.*["']\.\.\/src\/pages/m);
    expect(generated.source).not.toContain('404');
    expect(generated.source).not.toContain('error');
    const patterns = Object.fromEntries(generated.manifest.routes.filter(route => route.addressable).map(route => [route.name, route.pattern]));
    const routes = (createRouteBuilder as (patterns: Record<string, string>) => (...args: any[]) => string)(patterns);
    expect(routes('/users/[id]', { id: 'alice' })).toBe('/users/alice');
  });

  it('excludes declarations, tests, fixtures and Markdown without an explicit processor selection', () => {
    const root = project();
    for (const file of ['home.ts', 'types.d.ts', 'page.test.ts', 'page.spec.ts', '__tests__/layout.ts',
      '__fixtures__/p.ts', 'fixtures/q.ts', 'guide.mdx', 'intro.md', 'loading.ts']) write(root, `src/pages/${file}`);
    expect(discoverRoutes(root).pageKeys).toEqual(['/src/pages/home.ts']);
    expect(discoverRoutes(root).layoutKeys).toEqual([]);
    expect(discoverRoutes(root, true).pageKeys).toEqual(['/src/pages/guide.mdx', '/src/pages/home.ts', '/src/pages/intro.md']);
  });

  it('previews generation without writes, preserves authored files and avoids rewriting unchanged contracts', () => {
    const root = project(); write(root, 'src/pages/index.ts');
    const preview = generateRoutes(root, { write: false });
    expect(preview.changed).toBe(true); expect(existsSync(preview.file)).toBe(false);
    const first = generateRoutes(root); const mtime = statSync(first.file).mtimeMs;
    expect(generateRoutes(root).changed).toBe(false); expect(statSync(first.file).mtimeMs).toBe(mtime);
    writeFileSync(first.file, 'export const authored = true;');
    expect(() => generateRoutes(root)).toThrowError(expect.objectContaining({ code: 'COSSACK_ROUTE_GENERATION_CONFLICT' }));
    expect(readFileSync(first.file, 'utf8')).toBe('export const authored = true;');
  });

  it('rejects ambiguous files before producing a contract', () => {
    const root = project(); write(root, 'src/pages/users/[id].ts'); write(root, 'src/pages/users/[slug].ts');
    expect(() => generateRoutes(root)).toThrow('Duplicate page route');
    expect(existsSync(join(root, '.cossack/routes.ts'))).toBe(false);
  });

  it('uses Vite root for types, warnings and emitted manifest when cwd belongs to another project', async () => {
    const root = project(); write(root, 'src/pages/only-here.ts'); write(root, 'src/pages/omitted.md');
    const plugin = cossackPages();
    (plugin.configResolved as Function)({ root });
    const warn = vi.fn();
    await (plugin.buildStart as Function).call({ warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Markdown routes were omitted'));
    const file = (plugin.resolveId as Function)('virtual:cossack-routes');
    expect(file).toBe(join(root, '.cossack/routes.ts'));
    expect(readFileSync(file, 'utf8')).toContain('/only-here');
    write(root, 'dist/client/.vite/manifest.json', '{}');
    (plugin.writeBundle as Function).call({ environment: { name: 'client', config: { build: { outDir: 'dist/client' } } } });
    expect(JSON.parse(readFileSync(join(root, 'dist/client/cossack-routes.json'), 'utf8'))).toEqual(discoverRoutes(root));
  });

  it.each(['dist/client', '../dist/app/client'])('emits the SSR manifest in the configured client output %s', outDir => {
    const root = join(project(), 'app');
    write(root, 'src/pages/index.ts');
    const plugin = cossackPages();
    (plugin.configResolved as Function)({ root });
    const manifest = JSON.stringify({ 'src/client/entry-client.ts': { file: 'assets/client.js' } });
    write(root, `${outDir}/.vite/manifest.json`, manifest);
    (plugin.writeBundle as Function).call({ environment: { name: 'client', config: { build: { outDir } } } });
    expect(readFileSync(join(root, outDir, 'cossack-manifest.json'), 'utf8')).toBe(manifest);
    expect(existsSync(join(root, outDir, 'cossack-routes.json'))).toBe(true);
  });

  it('updates additions and deletions under the selected root and releases watcher listeners', () => {
    const root = project(); write(root, 'src/pages/home.ts');
    const plugin = cossackPages(); (plugin.configResolved as Function)({ root });
    const watcher = new EventEmitter(); const httpServer = new EventEmitter(); const module = {};
    const invalidateModule = vi.fn(); const error = vi.fn();
    (plugin.configureServer as { handler: Function }).handler({ watcher, httpServer, ws: { send: vi.fn() }, moduleGraph: { getModuleById: () => module, invalidateModule }, config: { logger: { error } } });
    const file = write(root, 'src/pages/new/[id].ts'); watcher.emit('add', file);
    expect(readFileSync(join(root, '.cossack/routes.ts'), 'utf8')).toContain('/new/:id');
    unlinkSync(file); watcher.emit('unlink', file);
    expect(readFileSync(join(root, '.cossack/routes.ts'), 'utf8')).not.toContain('/new/:id');
    expect(invalidateModule).toHaveBeenCalledTimes(2); expect(error).not.toHaveBeenCalled();
    httpServer.emit('close');
    expect(watcher.listenerCount('add')).toBe(0); expect(watcher.listenerCount('unlink')).toBe(0); expect(watcher.listenerCount('change')).toBe(0);
  });
});
