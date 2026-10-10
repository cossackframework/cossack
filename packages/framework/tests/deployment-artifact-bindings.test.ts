// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { readCloudflareDeclarationConfig } from '../src/config-preflight';
import { inspectBuiltDeployment } from '../src/deployment-artifact';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture(fields: Record<string, unknown>) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'cossack-deployment-bindings-'));
  roots.push(root);
  // Resolve the actual installed Wrangler through the fixture, without mocking its configuration APIs.
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.symlink(path.dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), path.join(root, 'node_modules/wrangler'), 'junction');
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const source = path.join(root, 'wrangler.json');
  const artifact = path.join(root, 'dist/server/wrangler.json');
  const config = { name: 'binding-fixture', main: 'worker.js', compatibility_date: '2026-06-06', ...fields };
  await fs.mkdir(path.dirname(artifact), { recursive: true });
  await fs.mkdir(path.join(root, '.wrangler/deploy'), { recursive: true });
  await fs.writeFile(path.join(root, '.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../dist/server/wrangler.json' }));
  await fs.writeFile(source, JSON.stringify(config));
  const expected = await readCloudflareDeclarationConfig(root, source, '');
  const write = async (changes: Record<string, unknown> = {}) => {
    await fs.writeFile(artifact, JSON.stringify({ ...config, main: 'index.js', no_bundle: true, ...changes }));
  };
  await write();
  return { root, artifact, expected, write };
}

const bindingCases = [
  { field: 'vectorize', original: [{ binding: 'INDEX', index_name: 'private-original-index' }], changed: [{ binding: 'INDEX', index_name: 'private-other-index' }] },
  { field: 'ai', original: { binding: 'AI' }, changed: { binding: 'OTHER_AI' } },
  { field: 'browser', original: { binding: 'BROWSER' }, changed: { binding: 'OTHER_BROWSER' } },
  { field: 'images', original: { binding: 'IMAGES' }, changed: { binding: 'OTHER_IMAGES' } },
  { field: 'version_metadata', original: { binding: 'VERSION' }, changed: { binding: 'OTHER_VERSION' } },
  { field: 'analytics_engine_datasets', original: [{ binding: 'EVENTS', dataset: 'private-original-events' }], changed: [{ binding: 'EVENTS', dataset: 'private-other-events' }] },
  { field: 'mtls_certificates', original: [{ binding: 'CERT', certificate_id: '11111111-1111-4111-8111-111111111111' }], changed: [{ binding: 'CERT', certificate_id: '22222222-2222-4222-8222-222222222222' }] },
  { field: 'send_email', original: [{ name: 'MAIL', allowed_destination_addresses: ['private-original@example.test'] }], changed: [{ name: 'MAIL', allowed_destination_addresses: ['private-other@example.test'] }] },
];

it.each(bindingCases)('verifies native normalized $field bindings without disclosing their values', async ({ field, original, changed }) => {
  const { root, artifact, expected, write } = await fixture({ [field]: original });
  expect(await inspectBuiltDeployment(root, expected)).toBe(artifact);
  await write({ [field]: changed });
  await expect(inspectBuiltDeployment(root, expected)).rejects.toMatchObject({
    code: 'COSSACK_DEPLOY_TARGET_MISMATCH',
    message: `Built ${field} differs from the selected Cloudflare environment. Check the Vite configuration.`,
  });
  // Removal is also a target change after Wrangler applies its family-specific defaults.
  await write({ [field]: undefined });
  await expect(inspectBuiltDeployment(root, expected)).rejects.toMatchObject({ code: 'COSSACK_DEPLOY_TARGET_MISMATCH' });
});

it.each([
  ['src/migrations', 'src/migrations/**/*.sql', '../../src/migrations', '../../src/migrations/**/*.sql'],
  ['.', '**/*.sql', '../..', '../../**/*.sql'],
])('accepts Vite-rewritten D1 migration patterns (%s)', async (directory, pattern, builtDirectory, builtPattern) => {
  const binding = { binding: 'DB', database_name: 'fixture-db', migrations_dir: directory, migrations_pattern: pattern };
  const { root, artifact, expected, write } = await fixture({ d1_databases: [binding] });
  const generated = { ...binding, migrations_dir: builtDirectory, migrations_pattern: builtPattern };
  await write({ d1_databases: [generated] });
  expect(await inspectBuiltDeployment(root, expected)).toBe(artifact);
  for (const migrations_pattern of ['../../different/**/*.sql', `${builtDirectory}/**/*.json`]) {
    await write({ d1_databases: [{ ...generated, migrations_pattern }] });
    await expect(inspectBuiltDeployment(root, expected)).rejects.toMatchObject({ code: 'COSSACK_DEPLOY_TARGET_MISMATCH' });
  }
});
it('normalizes absent and explicit empty Cron schedules without ignoring changed schedules', async () => {
  const { root, artifact, expected, write } = await fixture({});
  await write({ triggers: { crons: [] } });
  expect(await inspectBuiltDeployment(root, expected)).toBe(artifact);
  await write({ triggers: { crons: ['0 * * * *'] } });
  await expect(inspectBuiltDeployment(root, expected)).rejects.toMatchObject({ code: 'COSSACK_DEPLOY_TARGET_MISMATCH' });
});
