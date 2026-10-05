import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspectConfigurationRequirements } from '../src/config-inspection.js';
const require = createRequire(import.meta.url);
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(config = {}, requirements = `{ variables: { PORT: { type: 'number', coerce: true }, FLAG: { type: 'boolean', coerce: true }, PRIVATE: { type: 'string', secret: true } }, bindings: { DB: { kind: 'd1' } } }`) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-requirements-')); roots.push(root);
  await fs.mkdir(path.join(root, 'src/config'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.symlink(path.dirname(require.resolve('wrangler/package.json')), path.join(root, 'node_modules/wrangler'), 'junction');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ cossack: { runtime: 'cloudflare' } }));
  await fs.writeFile(path.join(root, 'src/config/app.ts'), `export const requirements = ${requirements}; export default () => { throw new Error('SECRET_FACTORY_EXECUTED'); };`);
  await fs.writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'fixture', main: './index.ts', compatibility_date: '2026-06-06', ...config }));
  return root;
}
const valid = { vars: { PORT: '42', FLAG: 'false', EXTRA: 'SECRET_VALUE' }, secrets: { required: ['PRIVATE'] }, d1_databases: [{ binding: 'DB', database_name: 'db', database_id: '12345678-1234-1234-1234-123456789012' }] };
it('checks selected declarations without exposing values or evaluating factories', async () => {
  const root = await fixture(valid);
  const result = await inspectConfigurationRequirements(root, { check: true });
  expect(result).toMatchObject({ valid: true, evaluation: 'not-performed', validation: 'declarations-only', remoteSecrets: 'not-checked', unverifiedSecrets: ['PRIVATE'], declaredSecrets: ['PRIVATE'] });
  expect(JSON.stringify(result)).not.toContain('SECRET_VALUE');
  expect(JSON.stringify(result)).not.toContain('SECRET_FACTORY_EXECUTED');
  await expect(fs.access(path.join(root, '.cossack'))).rejects.toThrow();
});
it('does not inherit top-level variables or bindings into named environments', async () => {
  const root = await fixture({ ...valid, env: { staging: { vars: { FLAG: 'true' } } } });
  const result = await inspectConfigurationRequirements(root, { check: true, environment: 'staging' });
  expect(result.valid).toBe(false);
  expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'PORT', code: 'COSSACK_CONFIG_REQUIRED_MISSING' }), expect.objectContaining({ name: 'DB', code: 'COSSACK_CONFIG_REQUIRED_MISSING' })]));
});
it('rejects invalid numeric/boolean coercions and wrong binding kinds without values', async () => {
  const root = await fixture({ vars: { PORT: 'SECRET_NUMBER', FLAG: 'SECRET_BOOL' }, kv_namespaces: [{ binding: 'DB', id: '1234567890abcdef1234567890abcdef' }] });
  const result = await inspectConfigurationRequirements(root, { check: true });
  expect(result.diagnostics.map(item => item.code)).toEqual(['COSSACK_CONFIG_VARIABLE_INVALID', 'COSSACK_CONFIG_VARIABLE_INVALID', 'COSSACK_CONFIG_BINDING_INVALID']);
  expect(JSON.stringify(result)).not.toContain('SECRET_');
});
it('absent remote secret declarations remain unverified', async () => {
  const root = await fixture({ ...valid, secrets: { required: [] } });
  expect(await inspectConfigurationRequirements(root, { check: true })).toMatchObject({ valid: true, declaredSecrets: [], unverifiedSecrets: ['PRIVATE'] });
});
it('rejects unknown environments and sanitizes malformed Wrangler parser errors', async () => {
  const root = await fixture(valid);
  await expect(inspectConfigurationRequirements(root, { check: true, environment: 'missing' })).rejects.toMatchObject({ code: 'COSSACK_ENVIRONMENT_UNKNOWN' });
  await fs.writeFile(path.join(root, 'wrangler.jsonc'), '{ SECRET_BAD');
  try { await inspectConfigurationRequirements(root, { check: true }); throw new Error('unexpected success'); }
  catch (error) { expect(error.code).toBe('COSSACK_WRANGLER_CONFIG_INVALID'); expect(error.message).not.toContain('SECRET_BAD'); }
});
it('catalogs literal requirements, rejects dynamic metadata, and never fabricates Node values', async () => {
  const root = await fixture(valid);
  expect(await inspectConfigurationRequirements(root)).toMatchObject({ validation: 'not-performed', factories: [{ status: 'declared' }] });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ cossack: { runtime: 'node' } }));
  const result = await inspectConfigurationRequirements(root, { check: true });
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'COSSACK_CONFIG_CHECK_UNAVAILABLE' })]);
  await fs.writeFile(path.join(root, 'src/config/app.ts'), 'export const requirements = getSecretMetadata(); export default () => ({});');
  expect(await inspectConfigurationRequirements(root)).toMatchObject({ valid: false, factories: [{ status: 'unknown' }] });
});
