import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspectDeployment, inspectBuiltDeployment } from '../src/deployment.js';

const require = createRequire(import.meta.url);
const roots = [];
async function project(config) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-deployment-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.symlink(path.dirname(require.resolve('wrangler/package.json')),
    path.join(root, 'node_modules/wrangler'), 'junction');
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.writeFile(path.join(root, 'index.ts'), 'export default { fetch: () => new Response("ok") };');
  await fs.writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({
    name: 'fixture', main: './index.ts', compatibility_date: '2026-06-06', ...config,
  }));
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('deployment inspection with project Wrangler', () => {
  it.each([undefined, false, ['/private/*'], ['/*'], ['!/assets/*', '/*'], ['/*', '!/assets/*', '!/private/*'], ['/*', '!/*']])(
    'rejects assets that can bypass the Worker (%j)', async runWorkerFirst => {
      const root = await project({ assets: { binding: 'ASSETS', run_worker_first: runWorkerFirst } });
      const inspection = await inspectDeployment(root);
      expect(inspection.diagnostics).toContainEqual({ code: 'COSSACK_ASSETS_WORKER_FIRST_REQUIRED', severity: 'error',
        message: 'Set assets.run_worker_first to true or to ["/*","!/assets/*"]. Any other value lets Cloudflare serve public files before authentication and route policies run.' });
    });

  it.each([true, ['/*', '!/assets/*']])('accepts %j and rejects a renamed framework binding', async runWorkerFirst => {
    const root = await project({ assets: { binding: 'ASSETS', run_worker_first: runWorkerFirst } });
    expect((await inspectDeployment(root)).diagnostics).toEqual([]);
    const invalid = await project({ assets: { binding: 'FILES', run_worker_first: runWorkerFirst } });
    expect((await inspectDeployment(invalid)).diagnostics).toEqual([expect.objectContaining({ code: 'COSSACK_ASSETS_BINDING_REQUIRED' })]);
  });

  it('reserves /assets for hashed build output', async () => {
    const root = await project({ assets: { binding: 'ASSETS', run_worker_first: ['/*', '!/assets/*'] } });
    await fs.mkdir(path.join(root, 'public/assets'), { recursive: true });
    await fs.mkdir(path.join(root, 'src/pages/(files)/assets'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/pages/(files)/assets/index.ts'), 'export default class Files {}');
    const { diagnostics } = await inspectDeployment(root);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'COSSACK_ASSETS_NAMESPACE_RESERVED', severity: 'error',
        message: expect.stringContaining('public/assets/ uses the /assets/ namespace, which is reserved for hashed build output') }),
      expect.objectContaining({ code: 'COSSACK_ASSETS_NAMESPACE_RESERVED', severity: 'error',
        message: expect.stringContaining('src/pages/(files)/assets/index.ts resolves to /assets') }),
    ]);
  });

  it('uses Wrangler environment inheritance and exposes names, not values', async () => {
    const root = await project({ vars: { APP_URL: 'https://production.test' },
      env: { staging: { vars: { APP_URL: 'https://staging.test' },
        secrets: { required: ['APP_SECRET'] },
        d1_databases: [{ binding: 'DB', database_name: 'staging-db' }] } } });
    const inspection = await inspectDeployment(root, 'staging');
    expect(inspection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'COSSACK_D1_DATABASE_ID_REQUIRED', severity: 'error',
    }));
    expect(inspection.config.vars.APP_URL).toBe('https://staging.test');
    expect(inspection.summary.worker).toBe('fixture-staging');
    expect(inspection.summary.requiredSecrets).toEqual(['APP_SECRET']);
    expect(inspection.summary.bindings).toContainEqual(expect.objectContaining({ type: 'd1_databases',
      name: 'DB', resource: 'staging-db', referenceKind: 'name', configuration: 'unresolved', remote: 'not-checked' }));
    expect(inspection.summary).not.toHaveProperty('vars');
  });

  it('plans binding setup without claiming resources exist or will be provisioned', async () => {
    const root = await project({
      d1_databases: [{ binding: 'DB', database_name: 'app-db' },
        { binding: 'DB_EXISTING', database_name: 'existing-db', database_id: '12345678-1234-1234-1234-123456789012' },
        { binding: 'DB_NO_NAME', database_id: 'abcdefab-cdef-abcd-efab-cdefabcdefab' }],
      kv_namespaces: [{ binding: 'CACHE', id: '1234567890abcdef1234567890abcdef' }],
      r2_buckets: [{ binding: 'FILES', bucket_name: 'app-files' }],
      hyperdrive: [{ binding: 'HYPERDRIVE', id: '00000000000000000000000000000000' }],
      queues: { producers: [{ binding: 'EVENTS', queue: 'app-events' }] },
    });
    const { summary, diagnostics } = await inspectDeployment(root);
    const byName = Object.fromEntries(summary.bindings.map(binding => [binding.name, binding]));
    expect(byName.DB).toMatchObject({ resource: 'app-db', referenceKind: 'name',
      configuration: 'unresolved', remote: 'not-checked',
      nextAction: expect.stringContaining('Set database_id for this D1 database') });
    expect(byName.DB_EXISTING).toMatchObject({ resource: '12345678-1234-1234-1234-123456789012', referenceKind: 'id',
      configuration: 'configured', remote: 'not-checked' });
    expect(byName.DB_NO_NAME).toMatchObject({ resource: 'abcdefab-cdef-abcd-efab-cdefabcdefab', referenceKind: 'id',
      configuration: 'unresolved', remote: 'not-checked',
      nextAction: expect.stringContaining('Set database_name to the name associated') });
    expect(byName.CACHE).toMatchObject({ resource: '1234567890abcdef1234567890abcdef', referenceKind: 'id',
      configuration: 'configured', remote: 'not-checked' });
    expect(byName.FILES).toMatchObject({ resource: 'app-files', referenceKind: 'name',
      configuration: 'configured', remote: 'not-checked' });
    expect(byName.HYPERDRIVE).toMatchObject({ configuration: 'unresolved', remote: 'not-checked',
      nextAction: expect.stringContaining('replace its placeholder ID') });
    expect(byName.EVENTS).toMatchObject({ resource: 'app-events', referenceKind: 'name',
      configuration: 'configured', remote: 'not-checked' });
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_BINDING_PLACEHOLDER' }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_D1_DATABASE_NAME_REQUIRED' }));
    expect(summary.bindings.every(binding => !Object.hasOwn(binding, 'provisioning'))).toBe(true);
    expect(JSON.stringify(summary.bindings)).not.toMatch(/"provisioning":"(?:existing|automatic)"/);
  });

  it('sanitizes a failed second Wrangler parse for environment inheritance', async () => {
    const root = await project({ env: { staging: {} } });
    await fs.unlink(path.join(root, 'node_modules/wrangler'));
    await fs.mkdir(path.join(root, 'node_modules/wrangler'));
    await fs.writeFile(path.join(root, 'node_modules/wrangler/package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
    await fs.writeFile(path.join(root, 'node_modules/wrangler/index.js'), `
      let reads = 0;
      export function experimental_readRawConfig() {
        if (++reads > 1) throw new Error('PRIVATE_WRANGLER_PARSE_SENTINEL');
        return { rawConfig: { env: { staging: {} } } };
      }
      export function unstable_readConfig() { return { name: 'fixture', vars: {} }; }
    `);
    await expect(inspectDeployment(root, 'staging')).rejects.toMatchObject({
      code: 'COSSACK_WRANGLER_CONFIG_INVALID',
      message: 'Wrangler could not validate the configuration. Check its syntax and binding declarations.',
    });
  });

  it('rejects unknown environments instead of silently using defaults', async () => {
    const root = await project({});
    await expect(inspectDeployment(root, 'typo')).rejects.toMatchObject({ code: 'COSSACK_ENVIRONMENT_UNKNOWN' });
  });

  it('flags Durable Object bindings that a named environment will not inherit', async () => {
    const root = await project({
      durable_objects: { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject' }] },
      env: { staging: { vars: { APP_URL: 'https://staging.test' } } },
    });
    const inspection = await inspectDeployment(root, 'staging');
    expect(inspection.diagnostics).toContainEqual(expect.objectContaining({
      code: 'COSSACK_ENV_BINDING_NOT_INHERITED',
      message: expect.stringContaining('env.staging'),
    }));
    // Re-declaring the binding in the environment clears the diagnostic.
    const fixed = await project({
      compatibility_flags: ['enable_request_signal'],
      durable_objects: { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject' }] },
      env: { staging: { vars: { APP_URL: 'https://staging.test' },
        durable_objects: { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject' }] } } },
    });
    expect((await inspectDeployment(fixed, 'staging')).diagnostics).toEqual([]);
    expect((await inspectDeployment(fixed)).diagnostics).toEqual([]);
  });

  it.each([{ flags: [] }, { flags: ['disable_request_signal'] }])('rejects selected coordinator flags without disconnect signals (%j)', async ({ flags }) => {
    const bindings = { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject' }] };
    const root = await project({ compatibility_flags: ['enable_request_signal'], durable_objects: bindings,
      env: { staging: { compatibility_flags: flags, durable_objects: bindings } } });
    expect((await inspectDeployment(root)).diagnostics).toEqual([]);
    expect((await inspectDeployment(root, 'staging')).diagnostics).toContainEqual(expect.objectContaining({
      code: 'COSSACK_REQUEST_SIGNAL_REQUIRED', message: expect.stringContaining('env.staging'),
    }));
  });

  it('reports secret names and placeholder resources without disclosing values', async () => {
    const secret = 'test-sensitive-value-do-not-print';
    const root = await project({ vars: { APP_SECRET: secret, APP_URL: 'https://example.com' },
      d1_databases: [{ binding: 'DB', database_name: 'placeholder', database_id: '00000000-0000-0000-0000-000000000000' }] });
    const { summary, diagnostics } = await inspectDeployment(root);
    expect(diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'COSSACK_SECRET_IN_VARS', 'COSSACK_APP_URL_INVALID', 'COSSACK_BINDING_PLACEHOLDER',
    ]));
    expect(JSON.stringify({ summary, diagnostics })).not.toContain(secret);
  });

  it('redacts values from Wrangler validation errors', async () => {
    const root = await project({ compatibility_date: { secret: 'do-not-echo-invalid-config' } });
    await expect(inspectDeployment(root)).rejects.toMatchObject({ code: 'COSSACK_WRANGLER_CONFIG_INVALID' });
    await expect(inspectDeployment(root)).rejects.not.toThrow('do-not-echo-invalid-config');
  });

  it('verifies the built environment before permitting deployment', async () => {
    const root = await project({ env: { staging: { vars: { APP_URL: 'https://staging.test' } } } });
    const inspection = await inspectDeployment(root, 'staging');
    await fs.mkdir(path.join(root, '.wrangler/deploy'), { recursive: true });
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, '.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../dist/wrangler.json' }));
    const artifact = path.join(root, 'dist/wrangler.json');
    const built = { name: 'fixture-staging', main: '../index.ts', compatibility_date: '2026-06-06', vars: { APP_URL: 'https://staging.test' } };
    await fs.writeFile(artifact, JSON.stringify(built));
    expect(await inspectBuiltDeployment(root, inspection.config)).toBe(artifact);
    await fs.writeFile(artifact, JSON.stringify({ ...built, vars: { APP_URL: 'https://wrong.test' } }));
    await expect(inspectBuiltDeployment(root, inspection.config)).rejects.toMatchObject({ code: 'COSSACK_DEPLOY_TARGET_MISMATCH' });
  });

  it.each([{ compatibility_flags: [] }, { compatibility_date: '2026-01-01' }])('rejects changed built compatibility settings (%j)', async change => {
    const root = await project({ compatibility_flags: ['enable_request_signal'] });
    const inspection = await inspectDeployment(root);
    await fs.mkdir(path.join(root, '.wrangler/deploy'), { recursive: true });
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, '.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../dist/wrangler.json' }));
    const artifact = path.join(root, 'dist/wrangler.json');
    const built = { name: 'fixture', main: '../index.ts', compatibility_date: '2026-06-06', compatibility_flags: ['enable_request_signal'] };
    await fs.writeFile(artifact, JSON.stringify(built));
    expect(await inspectBuiltDeployment(root, inspection.config)).toBe(artifact);
    await fs.writeFile(artifact, JSON.stringify({ ...built, ...change }));
    await expect(inspectBuiltDeployment(root, inspection.config)).rejects.toMatchObject({ code: 'COSSACK_DEPLOY_TARGET_MISMATCH' });
  });

  it.each([undefined, 'src/migrations'])('accepts rewritten D1 migration paths while rejecting changed targets (%s)', async migrationsDir => {
    const source = { binding: 'DB', database_name: 'staging-db', ...(migrationsDir ? { migrations_dir: migrationsDir } : {}) };
    const root = await project({ env: { staging: { d1_databases: [source] } } });
    const inspection = await inspectDeployment(root, 'staging');
    await fs.mkdir(path.join(root, '.wrangler/deploy'), { recursive: true });
    await fs.mkdir(path.join(root, 'dist/server'), { recursive: true });
    await fs.writeFile(path.join(root, '.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../dist/server/wrangler.json' }));
    const artifact = path.join(root, 'dist/server/wrangler.json');
    const built = { name: 'fixture-staging', main: '../../index.ts', compatibility_date: '2026-06-06',
      d1_databases: [{ ...source, migrations_dir: `../../${migrationsDir ?? 'migrations'}` }] };
    await fs.writeFile(artifact, JSON.stringify(built));
    expect(await inspectBuiltDeployment(root, inspection.config)).toBe(artifact);
    for (const change of [{ database_name: 'production-db' }, { migrations_dir: '../../different-migrations' }, { database_id: 'actual-other-database' }]) {
      await fs.writeFile(artifact, JSON.stringify({ ...built, d1_databases: [{ ...built.d1_databases[0], ...change }] }));
      await expect(inspectBuiltDeployment(root, inspection.config)).rejects.toMatchObject({ code: 'COSSACK_DEPLOY_TARGET_MISMATCH' });
    }
  });
});
