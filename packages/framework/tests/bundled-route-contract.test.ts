// @vitest-environment node
import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { inspectDefaultClassExport, isHttpHandlerModule } from '../src/page-inspection';
import { scanPagesDir } from '../src/vite-plugin';
const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');

it.each([
  ['framework', path.resolve(import.meta.dirname, '../src/pages')],
  ['scaffold', path.resolve(import.meta.dirname, '../../scaffold/template/src/pages')],
  ['dashboard', path.resolve(import.meta.dirname, '../../dashboard/app/src/pages')],
])('keeps every %s route component selectable by its default export', async (_name, directory) => {
  const { pageKeys, layoutKeys } = scanPagesDir(directory, true);
  const loadingKeys = fs.readdirSync(directory, { recursive: true })
    .filter((file): file is string => typeof file === 'string' && /(^|\/)loading\.ts$/.test(file))
    .map(file => `/src/pages/${file}`);
  const failures: string[] = [];
  for (const key of [...pageKeys, ...layoutKeys, ...loadingKeys]) {
    if (!key.endsWith('.ts')) continue; // Markdown has its own generated class export.
    const source = fs.readFileSync(path.join(directory, key.slice('/src/pages/'.length)), 'utf8');
    // An endpoint is told by its shape, wherever it is: the OAuth routes sit beside the sign-in pages.
    if (await isHttpHandlerModule(source)) continue;
    const result = await inspectDefaultClassExport(source);
    if (result.status !== 'resolved') failures.push(`${key}: ${result.reason}`);
  }
  expect(pageKeys.length).toBeGreaterThan(0);
  expect(failures).toEqual([]);
});
