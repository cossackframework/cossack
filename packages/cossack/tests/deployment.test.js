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
  it.each([undefined, false, ['/private/*']])('rejects assets that can bypass the Worker (%j)', async runWorkerFirst => {
    const root = await project({ assets: { binding: 'ASSETS', run_worker_first: runWorkerFirst } });
    const inspection = await inspectDeployment(root);
    expect(inspection.diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_ASSETS_WORKER_FIRST_REQUIRED' }));
  });

  it('accepts Worker-first assets and rejects a renamed framework binding', async () => {
    const root = await project({ assets: { binding: 'ASSETS', run_worker_first: true } });
    expect((await inspectDeployment(root)).diagnostics).toEqual([]);
    const invalid = await project({ assets: { binding: 'FILES', run_worker_first: true } });
    expect((await inspectDeployment(invalid)).diagnostics).toContainEqual(expect.objectContaining({ code: 'COSSACK_ASSETS_BINDING_REQUIRED' }));
  });

  it('uses Wrangler environment inheritance and exposes names, not values', async () => {
    const root = await project({ vars: { APP_URL: 'https://production.test' },
      env: { staging: { vars: { APP_URL: 'https://staging.test' },
        secrets: { required: ['APP_SECRET'] },
        d1_databases: [{ binding: 'DB', database_name: 'staging-db' }] } } });
    const inspection = await inspectDeployment(root, 'staging');
    expect(inspection.diagnostics).toEqual([]);
    expect(inspection.config.vars.APP_URL).toBe('https://staging.test');
    expect(inspection.summary.worker).toBe('fixture-staging');
    expect(inspection.summary.requiredSecrets).toEqual(['APP_SECRET']);
    expect(inspection.summary.bindings).toContainEqual({ type: 'd1_databases', name: 'DB', resource: null, provisioning: 'automatic' });
    expect(inspection.summary).not.toHaveProperty('vars');
  });

  it('rejects unknown environments instead of silently using defaults', async () => {
    const root = await project({});
    await expect(inspectDeployment(root, 'typo')).rejects.toMatchObject({ code: 'COSSACK_ENVIRONMENT_UNKNOWN' });
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
