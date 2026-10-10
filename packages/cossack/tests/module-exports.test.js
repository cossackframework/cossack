import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectDefaultClassExport, extractPageOptionsFromAst } from '../src/page-options-ast.js';
import { checkCommand, inspectCommand } from '../src/commands/inspect.js';

const roots = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

it.each([
  'export default class Page {}',
  'class Page {}; export default Page;',
  'class Page {}; export { Page as default };',
  'export default class {}',
])('resolves a local default class without execution: %s', async source => {
  expect(await inspectDefaultClassExport(source)).toMatchObject({ status: 'resolved', line: 1 });
});
it.each([
  ['@Page() class P {}', 'missing'],
  ['@Page() export class P {}', 'missing'],
  ['export default () => {};', 'unknown'],
  ['export default factory();', 'unknown'],
  ["export { Page as default } from './base';", 'unknown'],
  ["import Page from './base'; export default Page;", 'unknown'],
  ['export default class {', 'unknown'],
])('keeps missing or unsupported module exports explicit: %s', async (source, status) => {
  expect(await inspectDefaultClassExport(source)).toMatchObject({ status });
});

it.each(['index.ts', 'layout.ts'])('fails checks for a missing %s default while keeping inspection readable', async file => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-module-export-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.mkdir(path.join(root, 'src/pages'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/index.ts'), '@Page() export default class P { render() { return 1; } }');
  await fs.writeFile(path.join(root, 'src/pages', file), '@Page() class P { constructor() { throw new Error("must not execute"); } render() { return 1; } }');
  const ctx = { cwd: root, flags: { json: true } };
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await checkCommand(['routes'], ctx)).toBe(1);
  const result = JSON.parse(output.mock.calls.at(-1)[0]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_ROUTE_DEFAULT_EXPORT_MISSING', source: expect.stringContaining(file) }));
  expect(await inspectCommand(['routes'], ctx)).toBe(0);
  const inspection = JSON.parse(output.mock.calls.at(-1)[0]);
  const items = [...inspection.data.routes, ...inspection.data.layouts];
  expect(items.find(item => item.filePath === `/src/pages/${file}`).moduleExport.status).toBe('missing');
  await fs.appendFile(path.join(root, 'src/pages', file), '\nexport default P;');
  expect(await checkCommand(['routes'], ctx)).toBe(0);
});

it('does not borrow inherited layout options from a decorated local base', async () => {
  const source = '@Page({ services: [Counter] }) class Base {} export default class Layout extends Base {}';
  expect(await inspectDefaultClassExport(source)).toMatchObject({ status: 'resolved', className: 'Layout' });
  expect(await extractPageOptionsFromAst(source)).toMatchObject({ method: 'unknown' });
});
it.each(['registry[key]', 'loadRegistry().Counter', 'registry?.Counter'])(
  'reports dynamic service references as unknown: %s', async service => {
    expect(await extractPageOptionsFromAst(`@Page({ services: [${service}] }) export default class P {}`))
      .toMatchObject({ method: 'unknown', reason: expect.stringContaining('services') });
  });

it.each([
  'export const POST = factory(); export async function GET(c) { throw new Error(\"must not execute\"); }',
  'export default async function handler(c) { throw new Error(\"must not execute\"); }',
  'const handler = c => c.json({ ok: true }); export default handler;',
])('checks and explains functional HTTP APIs without imposing component requirements: %s', async source => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-http-api-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.mkdir(path.join(root, 'src/pages/api'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/layout.ts'), '@Page({ services: [Counter] }) export default class Layout {}');
  await fs.writeFile(path.join(root, 'src/pages/api/items.ts'), source);
  const ctx = { cwd: root, flags: { json: true } };
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await checkCommand(['routes'], ctx)).toBe(0);
  const page = JSON.parse(output.mock.calls.at(-1)[0]).data.routes[0];
  expect(page).toMatchObject({ routeStyle: 'http-handlers', transport: 'http', layouts: [],
    methodExtraction: { method: 'not-applicable' }, declarationDispatch: { status: 'not-applicable' } });
  expect(await inspectCommand(['routes', '/api/items'], ctx)).toBe(0);
  const reasons = JSON.parse(output.mock.calls.at(-1)[0]).data.reasons.join(' ');
  expect(reasons).toContain('Functional HTTP handlers use HTTP routing');
  expect(reasons).not.toContain('No @Page');
  expect(reasons).not.toContain('set by the @Page decorator');
  await fs.writeFile(path.join(root, 'src/pages/not-api.ts'), source);
  expect(await checkCommand(['routes'], ctx)).toBe(1);
});
