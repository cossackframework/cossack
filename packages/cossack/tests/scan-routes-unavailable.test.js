import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../src/page-options-ast.js', () => ({
  extractPageOptionsFromAst: async () => null,
  extractMethodClassificationsFromAst: async () => null,
}));
const { buildEffectiveRouteModel } = await import('../src/scan-routes.js');
let directory;
afterEach(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

it('keeps page and layout options unknown when the parser is unavailable', async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-no-parser-'));
  const pages = path.join(directory, 'src/pages');
  fs.mkdirSync(pages, { recursive: true });
  const source = "@Page({ transport: 'sse', ssg: true, services: [PrivateService] }) export default class P {}";
  fs.writeFileSync(path.join(pages, 'index.ts'), source);
  fs.writeFileSync(path.join(pages, 'layout.ts'), source);
  const model = await buildEffectiveRouteModel(directory);
  expect(model.pages[0]).toMatchObject({
    transport: null, ssg: null, services: [],
    extraction: { method: 'unknown' }, methodExtraction: { method: 'unknown' },
  });
  expect(model.layouts[0]).toMatchObject({ services: [], extraction: { method: 'unknown' } });
  expect(model.pages[0].extraction.reason).toContain('parser is unavailable');
  expect(model.layouts[0].extraction.reason).toContain('parser is unavailable');
});
