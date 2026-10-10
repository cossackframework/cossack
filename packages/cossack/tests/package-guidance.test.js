import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { docsCommand } from '../src/commands/docs.js';
import { readDocumentation } from '../src/documentation-service.js';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const name = '@cossackframework/core';
const guide = { id: 'routes', title: 'Routes', summary: 'Build a URL', imports: [name + '/routes'],
  markdown: 'Use public route helpers.', examples: [{ id: 'route', language: 'typescript', source: 'throw new Error("DO_NOT_EXECUTE")' }] };
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-guidance-')); roots.push(root);
  const folder = path.join(root, 'node_modules', name); await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, version: '1.2.3', exports: { './routes': './routes.js' } }));
  await fs.writeFile(path.join(folder, 'routes.js'), 'throw new Error("DO_NOT_IMPORT")');
  await fs.writeFile(path.join(folder, 'agent-docs.json'), JSON.stringify({ schemaVersion: 1, guides: [guide] }));
  const read = () => readDocumentation(root, { package: name });
  return { root, folder, read };
}
it('reads version-owned prose and example source without executing either', async () => {
  const { read } = await fixture();
  const result = await read();
  expect(result.ok).toBe(true);
  expect(result.data.packages[0].guidance).toMatchObject({ status: 'available', package: name, version: '1.2.3',
    runtimeSupport: 'not-verified', exampleExecution: 'not-performed', guides: [guide] });
});
it('refreshes guide text and omits guides whose public imports were removed', async () => {
  const { folder, read } = await fixture();
  const before = (await read()).data.packages[0].guidance;
  await fs.writeFile(path.join(folder, 'agent-docs.json'), JSON.stringify({ schemaVersion: 1, guides: [{ ...guide, markdown: 'Changed' }] }));
  expect((await read()).data.packages[0].guidance.contentHash).not.toBe(before.contentHash);
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, version: '2.0.0', exports: { './routes': null } }));
  const result = await read();
  expect(result.data.packages[0].guidance).toMatchObject({ version: '2.0.0', status: 'partial', guides: [], omitted: [{ id: 'routes', reason: 'imports-unavailable' }] });
  expect(JSON.stringify(result)).not.toContain('Changed');
});
it.each(['{"secret":', JSON.stringify({ schemaVersion: 99, secret: 'PRIVATE' }), 'x'.repeat(262145)])('redacts invalid or oversized package guides (%#)', async text => {
  const { folder, read } = await fixture();
  await fs.writeFile(path.join(folder, 'agent-docs.json'), text);
  const result = await read();
  expect(result.data.packages[0].guidance.status).toBe('invalid');
  expect(result.diagnostics[0].code).toBe('COSSACK_DOCS_GUIDANCE_INCOMPLETE');
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('rejects guide symlinks that leave the package and treats absent guides as unavailable', async () => {
  const { root, folder, read } = await fixture();
  const file = path.join(folder, 'agent-docs.json');
  await fs.unlink(file);
  expect((await read()).data.packages[0].guidance.status).toBe('unavailable');
  const outside = path.join(root, 'private.json');
  await fs.writeFile(outside, JSON.stringify({ schemaVersion: 1, guides: [guide] }));
  await fs.symlink(outside, file);
  expect((await read()).data.packages[0].guidance.status).toBe('invalid');
});
it.each([
  [{ ...guide, imports: ['other-package'] }], [guide, guide],
  [{ ...guide, examples: [...guide.examples, ...guide.examples] }],
].map(guides => [guides]))('rejects foreign imports or duplicate identities (%#)', async guides => {
  const { folder, read } = await fixture();
  await fs.writeFile(path.join(folder, 'agent-docs.json'), JSON.stringify({ schemaVersion: 1, guides }));
  expect((await read()).data.packages[0].guidance.status).toBe('invalid');
});

it('prints package-owned prose and examples in the human CLI output', async () => {
  const { root } = await fixture();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(await docsCommand([], { cwd: root, flags: { package: name } })).toBe(0);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain(`${name}@1.2.3: Routes`);
    expect(output).toContain(guide.markdown);
    expect(output).toContain(guide.examples[0].source);
  } finally { log.mockRestore(); }
});

it('reads the authored core guides and omits input guidance when its installed export disappears', async () => {
  const { folder, read } = await fixture();
  const authored = JSON.parse(await fs.readFile(new URL('../../core/agent-docs.json', import.meta.url), 'utf8'));
  const exports = {};
  for (const specifier of new Set(authored.guides.flatMap(guide => guide.imports))) {
    const subpath = '.' + specifier.slice(name.length);
    const target = './' + (subpath === '.' ? 'index' : subpath.slice(2)) + '.js';
    exports[subpath] = target;
    await fs.writeFile(path.join(folder, target), 'throw new Error("DO_NOT_IMPORT_GUIDANCE_MODULES")');
  }
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, version: '0.9.0', exports }));
  await fs.writeFile(path.join(folder, 'agent-docs.json'), JSON.stringify(authored));
  const before = (await read()).data.packages[0].guidance;
  expect(before).toMatchObject({ status: 'available', version: '0.9.0', exampleExecution: 'not-performed' });
  expect(before.guides).toEqual(authored.guides);

  delete exports['./input'];
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, version: '0.9.1', exports }));
  const after = (await read()).data.packages[0].guidance;
  const inputGuides = authored.guides.filter(guide => guide.imports.includes(name + '/input'));
  expect(after).toMatchObject({ status: 'partial', version: '0.9.1' });
  expect(after.omitted).toEqual(inputGuides.map(guide => ({ id: guide.id, reason: 'imports-unavailable', imports: [name + '/input'] })));
  expect(after.omitted).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'validated-input', reason: 'imports-unavailable' }),
    expect.objectContaining({ id: 'nested-form-input', reason: 'imports-unavailable' }),
    expect.objectContaining({ id: 'component-actions', reason: 'imports-unavailable' }),
  ]));
  expect(after.guides.map(guide => guide.id)).toContain('typed-url-state');
  expect(after.guides.some(guide => guide.imports.includes(name + '/input'))).toBe(false);
});

it('reads the authored database guide only through its published runtime exports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-database-guidance-'));
  roots.push(root);
  const name = '@cossackframework/database';
  const folder = path.join(root, 'node_modules', '@cossackframework', 'database');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  const authored = JSON.parse(await fs.readFile(new URL('../../database/agent-docs.json', import.meta.url), 'utf8'));
  const exports = {};
  for (const specifier of new Set(authored.guides.flatMap(guide => guide.imports))) {
    const subpath = '.' + specifier.slice(name.length);
    const target = './' + (subpath === '.' ? 'index' : subpath.slice(2)) + '.js';
    exports[subpath] = target;
    await fs.writeFile(path.join(folder, target), 'throw new Error("DO_NOT_IMPORT_DATABASE_GUIDANCE_MODULES")');
  }
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, version: '0.8.3', exports }));
  await fs.writeFile(path.join(folder, 'agent-docs.json'), JSON.stringify(authored));
  const result = await readDocumentation(root, { package: name });
  expect(result.ok).toBe(true);
  expect(result.data.packages[0].guidance).toMatchObject({
    status: 'available', package: name, version: '0.8.3', guides: authored.guides,
  });
});

it('discovers legacy TypeScript root guidance without inventing an exports map or running source', async () => {
  const { folder, read } = await fixture();
  const rootGuide = { ...guide, imports: [name] };
  await fs.writeFile(path.join(folder, 'agent-docs.json'), JSON.stringify({ schemaVersion: 1, guides: [rootGuide] }));
  await fs.writeFile(path.join(folder, 'main.ts'), 'throw new Error("DO_NOT_EVALUATE_SOURCE_MAIN")');
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'main.ts' }));
  const pkg = (await read()).data.packages[0];
  expect(pkg.exports).toEqual([]);
  expect(pkg.guidance).toMatchObject({ status: 'available', guides: [rootGuide], runtimeSupport: 'not-verified', exampleExecution: 'not-performed' });
  await fs.rm(path.join(folder, 'main.ts'));
  expect((await read()).data.packages[0].guidance).toMatchObject({ status: 'partial', guides: [], omitted: [{ id: guide.id, reason: 'imports-unavailable' }] });
  await fs.writeFile(path.join(folder, 'main.ts'), 'throw new Error("DO_NOT_EVALUATE_SOURCE_MAIN")');
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name, version: '1.1.0', main: 'main.ts', exports: { '.': null } }));
  const blocked = (await read()).data.packages[0];
  expect(blocked.implicitEntry).toBeNull();
  expect(blocked.guidance.guides).toEqual([]);
});
