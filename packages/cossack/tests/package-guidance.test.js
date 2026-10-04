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
  expect(after).toMatchObject({ status: 'partial', version: '0.9.1', omitted: [
    { id: 'validated-input', reason: 'imports-unavailable' },
    { id: 'nested-form-input', reason: 'imports-unavailable' },
    { id: 'component-actions', reason: 'imports-unavailable' },
  ] });
  expect(after.guides.map(guide => guide.id)).toContain('typed-url-state');
  expect(after.guides.some(guide => guide.imports.includes(name + '/input'))).toBe(false);
});
