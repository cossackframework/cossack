import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readBuildBindingNames } from '../src/build-bindings';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(config: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-build-bindings-'));
  roots.push(root);
  const require = createRequire(import.meta.url);
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.symlink(path.dirname(require.resolve('wrangler/package.json')), path.join(root, 'node_modules/wrangler'), 'junction');
  await fs.writeFile(path.join(root, 'wrangler.jsonc'), config);
  return root;
}
it('returns binding names without vars or resource values', async () => {
  const root = await fixture(JSON.stringify({ name: 'fixture', compatibility_date: '2026-01-01',
    vars: { APP_SECRET: 'PRIVATE_VALUE' },
    r2_buckets: [{ binding: 'FILES', bucket_name: 'private-bucket' }],
    durable_objects: { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject' }] },
  }));
  expect(await readBuildBindingNames(root)).toEqual(['COSSACK_SSE', 'FILES']);
});
it('sanitizes parser exceptions that can contain configuration excerpts', async () => {
  const root = await fixture('{ "vars": { "APP_SECRET": "PRIVATE_VALUE" }, broken-json');
  await expect(readBuildBindingNames(root)).rejects.toThrow('COSSACK_BUILD_BINDINGS_UNKNOWN: Wrangler configuration could not be validated.');
  try { await readBuildBindingNames(root); } catch (error) { expect(String(error)).not.toContain('PRIVATE_VALUE'); }
});
