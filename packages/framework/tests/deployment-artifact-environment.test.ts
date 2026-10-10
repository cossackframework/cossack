// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { inspectBuiltDeployment } from '../src/deployment-artifact';
import { readCloudflareDeclarationConfig } from '../src/config-preflight';
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it('validates a built target without applying the ambient environment twice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cossack-artifact-environment-')); roots.push(root);
  await mkdir(join(root, 'node_modules')); await mkdir(join(root, '.wrangler/deploy'), { recursive: true });
  await symlink(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), join(root, 'node_modules/wrangler'), 'junction');
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'entry.ts'), 'export default {};');
  const common = { main: './entry.ts', compatibility_date: '2026-01-01' };
  await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify({ ...common, name: 'base', env: { staging: { name: 'selected-target', vars: { MARKER: 'selected' } } } }));
  await writeFile(join(root, 'built.json'), JSON.stringify({ ...common, name: 'selected-target', vars: { MARKER: 'selected' } }));
  await writeFile(join(root, '.wrangler/deploy/config.json'), '{"configPath":"../../built.json"}');
  vi.stubEnv('CLOUDFLARE_ENV', 'staging');
  const expected = await readCloudflareDeclarationConfig(root, join(root, 'wrangler.jsonc'), 'staging');
  expect(expected.name).toBe('selected-target');
  await expect(inspectBuiltDeployment(root, expected)).resolves.toBe(join(root, 'built.json'));
});
