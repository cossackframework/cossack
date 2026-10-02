import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectScaffoldMetadata } from '../src/project-metadata.js';
let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-metadata-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(value) {
  await fs.mkdir(path.join(root, '.cossack'), { recursive: true });
  await fs.writeFile(path.join(root, '.cossack/scaffold.json'), JSON.stringify(value));
}
it('distinguishes missing metadata from malformed metadata', async () => {
  expect((await inspectScaffoldMetadata(root)).status).toBe('unrecorded');
  await write({ schemaVersion: 2, secret: 'PRIVATE_VALUE' });
  const result = await inspectScaffoldMetadata(root);
  expect(result.status).toBe('invalid');
  expect(result.diagnostics[0].code).toBe('COSSACK_SCAFFOLD_METADATA_INVALID');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
});
it('uses registry dependencies and excludes arbitrary recorded secrets', async () => {
  await write({ schemaVersion: 3, runtime: 'node', explicitFeatures: ['auth'],
    config: { database: 'sqlite', appSecret: 'PRIVATE_VALUE', unknown: 'PRIVATE_VALUE' } });
  const result = await inspectScaffoldMetadata(root);
  expect(result.status).toBe('recorded');
  expect(result.recipe.features).toEqual([
    { name: 'ui', requires: [] }, { name: 'database', requires: [] },
    { name: 'auth', requires: ['ui', 'database'] },
  ]);
  expect(result.recipe.runtime).toBe('node');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
});
it('rejects provider/runtime conflicts using the scaffold registry', async () => {
  await write({ schemaVersion: 3, runtime: 'node', explicitFeatures: ['database'], config: { database: 'd1' } });
  expect((await inspectScaffoldMetadata(root)).status).toBe('invalid');
});
it('joins recorded recipes with route facts in the effective project model', async () => {
  await write({ schemaVersion: 3, runtime: 'node', explicitFeatures: ['database'], config: { database: 'sqlite' } });
  await fs.mkdir(path.join(root, 'src/pages'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/pages/index.ts'), '@Page() export default class P { render() { return 1; } }');
  const { buildEffectiveRouteModel } = await import('../src/scan-routes.js');
  const model = await buildEffectiveRouteModel(root);
  expect(model.pages[0].methodExtraction.method).toBe('compiler');
  expect(model.scaffold.recipe).toMatchObject({ runtime: 'node', config: { database: 'sqlite' } });
});
