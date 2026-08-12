// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cossackPages, scanPagesDir } from '../src/vite-plugin';

describe('page discovery exclusions', () => {
  it('excludes conventional test, declaration, and fixture modules from Vite globs', () => {
    const plugin = cossackPages();
    const source = (plugin.load as Function).call(
      { environment: { name: 'client' } },
      '\0virtual:cossack-pages',
    );

    expect(source).toContain('!/src/pages/**/*.test.*');
    expect(source).toContain('!/src/pages/**/*.spec.*');
    expect(source).toContain('!/src/pages/**/*.d.ts');
    expect(source).toContain('!/src/pages/**/__tests__/**');
    expect(source).toContain('!/src/pages/**/__fixtures__/**');
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
