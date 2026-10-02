import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspectCommand, checkCommand } from '../src/commands/inspect.js';

const roots = [];
const require = createRequire(import.meta.url);
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(config = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-inspection-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.symlink(path.dirname(require.resolve('wrangler/package.json')), path.join(root, 'node_modules/wrangler'), 'junction');
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.writeFile(path.join(root, 'index.js'), 'export default {fetch(){return new Response("ok")}}');
  await fs.writeFile(path.join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'fixture', main: './index.js',
    compatibility_date: '2026-06-06', ...config }));
  return { cwd: root, flags: { json: true } };
}

describe('Cloudflare configuration inspection', () => {
  it('reports the selected environment without creating artifacts or disclosing values', async () => {
    vi.stubEnv('CLOUDFLARE_ENV', 'staging');
    const ctx = await fixture({ env: { staging: {
      vars: { APP_URL: 'https://staging.test', PUBLIC_VALUE: 'do-not-include-var-values' },
      secrets: { required: ['APP_SECRET'] },
      d1_databases: [{ binding: 'DB', database_name: 'staging-db' }],
    } } });
    const files = await fs.readdir(ctx.cwd);
    const source = await fs.readFile(path.join(ctx.cwd, 'wrangler.jsonc'), 'utf8');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await inspectCommand(['cloudflare'], ctx)).toBe(0);
    expect(output).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ schemaVersion: 1, command: 'inspect', ok: true,
      data: { scope: 'cloudflare', environment: 'staging', worker: 'fixture-staging', requiredSecrets: ['APP_SECRET'],
        readiness: { configuration: 'valid', build: 'not-checked', remote: 'not-checked' } }, diagnostics: [] });
    expect(output.mock.calls[0][0]).not.toContain('do-not-include-var-values');
    expect(await fs.readdir(ctx.cwd)).toEqual(files);
    expect(await fs.readFile(path.join(ctx.cwd, 'wrangler.jsonc'), 'utf8')).toBe(source);
  });

  it('lets inspection describe invalid configuration while checks fail with the same diagnostics', async () => {
    const ctx = await fixture({ vars: { APP_SECRET: 'private-fixture-value', APP_URL: 'https://example.com' } });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await inspectCommand(['cloudflare'], ctx)).toBe(0);
    const inspection = JSON.parse(output.mock.calls[0][0]);
    expect(inspection.data.readiness.configuration).toBe('invalid');
    expect(await checkCommand(['cloudflare'], ctx)).toBe(1);
    const check = JSON.parse(output.mock.calls[1][0]);
    expect(check).toMatchObject({ command: 'check', ok: false, diagnostics: inspection.diagnostics });
    expect(JSON.stringify(output.mock.calls)).not.toContain('private-fixture-value');
  });

  it.each([{ env: ['staging', 'production'] }, { env: true }, { typo: true }])('rejects ambiguous/unknown flags: %j', async flags => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await inspectCommand(['cloudflare'], { cwd: '/missing-project', flags: { ...flags, json: true } })).toBe(1);
    expect(JSON.parse(output.mock.calls[0][0]).ok).toBe(false);
  });

  it('rejects unknown environments with a structured diagnostic', async () => {
    const ctx = await fixture();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await checkCommand(['cloudflare'], { ...ctx, flags: { json: true, env: 'typo' } })).toBe(1);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ ok: false,
      diagnostics: [{ code: 'COSSACK_ENVIRONMENT_UNKNOWN' }] });
  });
});
