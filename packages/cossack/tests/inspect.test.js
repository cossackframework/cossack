import { inspectProject } from '../src/inspection-service.js';
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
        bindings: [expect.objectContaining({ type: 'd1_databases', name: 'DB', resource: 'staging-db',
          referenceKind: 'name', configuration: 'unresolved', remote: 'not-checked',
          nextAction: expect.stringContaining('Set database_id for this D1 database') })],
        readiness: { configuration: 'invalid', build: 'not-checked', remote: 'not-checked' } },
      diagnostics: [expect.objectContaining({ code: 'COSSACK_D1_DATABASE_ID_REQUIRED' })] });
    expect(output.mock.calls[0][0]).not.toContain('do-not-include-var-values');
    expect(await fs.readdir(ctx.cwd)).toEqual(files);
    expect(await fs.readFile(path.join(ctx.cwd, 'wrangler.jsonc'), 'utf8')).toBe(source);

    expect(await checkCommand(['cloudflare'], ctx)).toBe(1);
    expect(JSON.parse(output.mock.calls[1][0])).toMatchObject({ command: 'check', ok: false,
      diagnostics: [expect.objectContaining({ code: 'COSSACK_D1_DATABASE_ID_REQUIRED' })] });
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

  it('prints the unresolved setup action and does not claim remote readiness', async () => {
    const ctx = await fixture({ hyperdrive: [{ binding: 'HYPERDRIVE', id: '00000000000000000000000000000000' }] });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await inspectCommand(['cloudflare'], { ...ctx, flags: {} })).toBe(0);
    const text = output.mock.calls.map(([line]) => line).join('\n');
    expect(text).toContain('HYPERDRIVE: hyperdrive (needs setup: Create or select a Hyperdrive configuration');
    expect(text).toContain('remote existence/access not checked');
    expect(text).not.toContain('automatic');
    expect(text).not.toContain('existing');
  });

  it.each([{ env: ['staging', 'production'] }, { env: true }, { typo: true }])('rejects ambiguous/unknown flags: %j', async flags => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await inspectCommand(['cloudflare'], { cwd: '/missing-project', flags: { ...flags, json: true } })).toBe(1);
    expect(JSON.parse(output.mock.calls[0][0]).ok).toBe(false);
  });

  it('checks route bindings against the selected Wrangler environment', async () => {
    const durable_objects = { bindings: [{ name: 'COSSACK_SSE', class_name: 'SseDurableObject' }] };
    const ctx = await fixture({ durable_objects, env: {
      staging: { durable_objects: { bindings: [] } },
      production: { durable_objects },
    } });
    await fs.mkdir(path.join(ctx.cwd, 'src/pages'), { recursive: true });
    await fs.writeFile(path.join(ctx.cwd, 'src/pages/index.ts'), "@Page({ transport: 'sse' }) export default class P { render() { return 1; } }");
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await checkCommand(['routes'], { ...ctx, flags: { json: true, env: 'staging' } })).toBe(1);
    const missing = JSON.parse(output.mock.calls[0][0]);
    expect(missing.data.runtime.environment).toBe('staging');
    expect(missing.diagnostics.map(d => d.code)).toContain('COSSACK_TRANSPORT_BINDING_MISSING');
    output.mockClear();
    expect(await checkCommand(['routes'], { ...ctx, flags: { json: true, env: 'production' } })).toBe(0);
    const ready = JSON.parse(output.mock.calls[0][0]);
    expect(ready.data.runtime.transports[0]).toMatchObject({ status: 'available', missingBindings: [] });
    output.mockClear();
    expect(await inspectCommand(['routes', '/'], { ...ctx, flags: { json: true, env: 'production' } })).toBe(0);
    expect(JSON.parse(output.mock.calls[0][0]).data.reasons.join(' ')).toContain('Runtime cloudflare: sse transport is available');
  });

  it('checks configuration declarations with the same value-free diagnostics as config preflight', async () => {
    const ctx = await fixture({ vars: { PORT: 'PRIVATE_NUMERIC_SENTINEL' } });
    await fs.mkdir(path.join(ctx.cwd, 'src/config'), { recursive: true });
    await fs.writeFile(path.join(ctx.cwd, 'src/config/app.ts'), "export const requirements = { variables: { PORT: { type: 'number', coerce: true } } }; export default () => { throw new Error('FACTORY_EXECUTED'); };");
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await checkCommand(['cloudflare'], ctx)).toBe(1);
    const result = JSON.parse(output.mock.calls[0][0]);
    expect(await inspectProject(ctx.cwd, { scope: 'cloudflare', check: true })).toEqual({ ok: result.ok, data: result.data, diagnostics: result.diagnostics });
    expect(result.data.configurationRequirements.validation).toBe('declarations-only');
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'COSSACK_CONFIG_VARIABLE_INVALID', name: 'PORT' })]));
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_NUMERIC_SENTINEL|FACTORY_EXECUTED/);
  });

  it('rejects unknown environments with a structured diagnostic', async () => {
    const ctx = await fixture();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await checkCommand(['cloudflare'], { ...ctx, flags: { json: true, env: 'typo' } })).toBe(1);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ ok: false,
      diagnostics: [{ code: 'COSSACK_ENVIRONMENT_UNKNOWN' }] });
  });
});


describe('Route inspection and explanation (CLI-04)', () => {
  async function routeFixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-inspect-routes-'));
    const write = async (relative, content) => {
      await fs.mkdir(path.join(root, path.dirname(relative)), { recursive: true });
      await fs.writeFile(path.join(root, relative), content);
    };
    await write('package.json', '{}');
    await write('src/pages/layout.ts', 'export default class Layout {}');
    await write('src/pages/dashboard/layout.ts', "@Page({ services: [Session, Audit] })\nexport default class Dash {}");
    await write('src/pages/dashboard/users/[id]/index.ts',
      "@Page({ transport: 'sse', middlewares: [async (c, next) => { await next(); }] })\nexport default class Users {\n  @Server() async *load() {}\n  @Client() onClick() {}\n}");
    await write('src/pages/dashboard/404/index.ts', 'export default class NotFound {}');
    return { cwd: root, flags: {}, force: false, dryRun: false };
  }

  it('lists effective route facts with source locations', async () => {
    const ctx = await routeFixture();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await inspectCommand(['routes'], { ...ctx, flags: { json: true } })).toBe(0);
    const result = JSON.parse(output.mock.calls[0][0]);
    expect(result.command).toBe('inspect');
    const users = result.data.routes.find((route) => route.route === '/dashboard/users/:id');
    expect(users).toMatchObject({
      transport: 'sse',
      middlewares: 1,
      source: expect.stringMatching(/\[id\]\/index\.ts:1$/),
      layouts: ['/src/pages/layout.ts', '/src/pages/dashboard/layout.ts'],
      notFoundBoundary: '/src/pages/dashboard/404/index.ts',
      params: [{ name: 'id', catchAll: false }],
    });
    // Service ownership matches what DI resolution finds: the dashboard
    // layout declares Session and Audit for its subtree.
    const dashboardLayout = result.data.layouts.find((layout) => layout.filePath === '/src/pages/dashboard/layout.ts');
    expect(dashboardLayout).toMatchObject({ services: ['Session', 'Audit'] });
  });

  it('explains a route with reasons and source locations', async () => {
    const ctx = await routeFixture();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await inspectCommand(['routes', '/dashboard/users/:id'], { ...ctx, flags: { json: true } })).toBe(0);
    const result = JSON.parse(output.mock.calls[0][0]);
    expect(result.data).toMatchObject({ scope: 'routes', route: '/dashboard/users/:id', kind: 'page' });
    const reasons = result.data.reasons.join('\n');
    expect(reasons).toContain('Transport "sse"');
    expect(reasons).toContain('src/pages/layout.ts');
    expect(reasons).toContain('1 middleware(s)');
    expect(reasons).toContain('Nearest 404 boundary');
    expect(reasons).toContain('Session, Audit (/src/pages/dashboard/layout.ts)');
    // Method classification: @Server becomes an RPC proxy; @Client stays local.
    expect(reasons).toContain('Server methods (RPC proxies on the client): load');
    expect(reasons).toContain('Explicit server decorator.');
    expect(reasons).toContain('Client/shared methods (no transport): onClick');
  });

  it('fails with a coded diagnostic for unknown routes', async () => {
    const ctx = await routeFixture();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await inspectCommand(['routes', '/nope'], { ...ctx, flags: { json: true } })).toBe(1);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      ok: false, diagnostics: [{ code: 'COSSACK_ROUTE_UNKNOWN' }],
    });
  });

  it('does not explain a different dynamic route with the same prefix', async () => {
    const ctx = await routeFixture();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await inspectCommand(['routes', '/dashboard/users/:missing'], { ...ctx, flags: { json: true } })).toBe(1);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ ok: false,
      diagnostics: [{ code: 'COSSACK_ROUTE_UNKNOWN' }] });
  });

  it('explains boundaries by source identity and rejects a public boundary alias', async () => {
    const ctx = await routeFixture();
    roots.push(ctx.cwd);
    const source = '/src/pages/(group)/dashboard/404/index.ts';
    await fs.mkdir(path.join(ctx.cwd, 'src/pages/(group)/dashboard/404'), { recursive: true });
    await fs.writeFile(path.join(ctx.cwd, source.slice(1)), 'export default class GroupNotFound {}');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await inspectCommand(['routes', source], { ...ctx, flags: { json: true } })).toBe(0);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ ok: true,
      data: { kind: '404', source, routeId: expect.any(String) } });
    output.mockClear();
    expect(await inspectCommand(['routes', '/dashboard/404'], { ...ctx, flags: { json: true } })).toBe(1);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ ok: false,
      diagnostics: [{ code: 'COSSACK_ROUTE_BOUNDARY_SOURCE_REQUIRED' }] });
  });
});
