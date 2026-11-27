// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cossackPages, scanPagesDir } from '../src/vite-plugin';

describe('page discovery exclusions', () => {
  it('excludes conventional test, declaration, and fixture modules from the page registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'cossack-pages-'));
    for (const file of ['blog/index.ts', 'blog/page.test.ts', 'blog/page.spec.ts', 'blog/types.d.ts', 'blog/__tests__/a.ts', 'blog/__fixtures__/b.ts', 'blog/layout.ts', 'blog/loading.ts']) {
      mkdirSync(join(root, 'src/pages', file, '..'), { recursive: true });
      writeFileSync(join(root, 'src/pages', file), 'export default class Page {}');
    }
    const plugin = cossackPages();
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    const source = (plugin.load as Function).call(
      { environment: { name: 'client' } },
      '\0virtual:cossack-pages',
    ) as string;

    // One explicit import per page, layout and loading state, and nothing else.
    expect([...source.matchAll(/import\("([^"]+)"\)|from "([^"]+)"/g)].map(match => match[1] ?? match[2]).sort())
      .toEqual(['/src/pages/blog/index.ts', '/src/pages/blog/layout.ts', '/src/pages/blog/loading.ts']);
    expect(source).toMatch(/const pages = \{\s*"\/src\/pages\/blog\/index\.ts": \(\) => import\("\/src\/pages\/blog\/index\.ts"\),\s*\};/);
  });

  it('lists the page files by name, without importing a page, in virtual:cossack-page-files', () => {
    const root = mkdtempSync(join(tmpdir(), 'cossack-pages-'));
    for (const file of ['src/pages/(site)/search/index.ts', 'src/pages/blog/index.ts', 'src/pages/blog/layout.ts', 'src/pages/blog/loading.ts',
      'src/pages/blog/page.test.ts', 'src/plugins/shop/pages/(site)/shop/index.ts']) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), 'export default class Page {}');
    }
    writeFileSync(join(root, 'src/plugins/shop/plugin.json'), JSON.stringify({ schemaVersion: 1, name: 'shop', version: '1.0.0', description: 'Shop.' }));
    const plugin = cossackPages();
    (plugin.configResolved as Function).call({}, { root, publicDir: false, base: '/' });
    expect((plugin.resolveId as Function).call({}, 'virtual:cossack-page-files')).toBe('\0virtual:cossack-page-files');
    for (const name of ['client', 'ssr']) {
      const source = (plugin.load as Function).call({ environment: { name } }, '\0virtual:cossack-page-files') as string;
      expect(source).not.toMatch(/\bimport\b/);
      // Route keys, as in the pages registry: a plugin's page is keyed where it answers.
      expect(source).toBe('export default ["/src/pages/(site)/search/index.ts","/src/pages/(site)/shop/index.ts","/src/pages/blog/index.ts"];\n');
    }
  });

  it('omits co-located tests and fixture directories from the route manifest scan', () => {
    const root = mkdtempSync(join(tmpdir(), 'cossack-pages-'));
    mkdirSync(join(root, 'blog', '__fixtures__'), { recursive: true });
    writeFileSync(join(root, 'blog', 'index.ts'), 'export default class Page {}');
    writeFileSync(join(root, 'blog', 'page.test.ts'), 'describe("page", () => {})');
    writeFileSync(join(root, 'blog', 'page.spec.ts'), 'describe("page", () => {})');
    writeFileSync(join(root, 'blog', 'types.d.ts'), 'declare const x: string');
    writeFileSync(join(root, 'blog', '__fixtures__', 'fixture.ts'), 'export default {}');

    const result = scanPagesDir(root, false);
    expect(result.pageKeys).toEqual(['/src/pages/blog/index.ts']);
  });
});
