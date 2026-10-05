// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cossackBuildBudgets } from '../src/vite-build-budgets';
import { checkBuildBudgets } from '../src/build-budgets';
import { inspectBuiltDeployment } from '../src/deployment-artifact';
import { findCloudflareConfig, resolveConfigRuntime, readCloudflareDeclarationConfig } from '../src/config-preflight';
vi.mock('../src/build-budgets', async original => ({ ...await original<typeof import('../src/build-budgets')>(), checkBuildBudgets: vi.fn() }));
vi.mock('../src/deployment-artifact', () => ({ inspectBuiltDeployment: vi.fn() }));
vi.mock('../src/config-preflight', () => ({ findCloudflareConfig: vi.fn(async root => join(root, 'wrangler.jsonc')), resolveConfigRuntime: vi.fn(async () => 'cloudflare'), readCloudflareDeclarationConfig: vi.fn(async () => ({ name: 'selected' })) }));
const roots: string[] = [];
afterEach(async () => { vi.clearAllMocks(); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(budgets: unknown = { uploadKiB: { error: 100 } }) {
  const root = await mkdtemp(join(tmpdir(), 'cossack-vite-budgets-')); roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ cossack: { buildBudgets: budgets } }));
  const plugin = cossackBuildBudgets({ environment: 'staging' });
  const resolved = plugin.configResolved as (config: any) => Promise<void>;
  const hook = plugin.buildApp as { order: string; handler: (builder: any) => Promise<void> };
  const logger = { warn: vi.fn() };
  const builder = { environments: { ssr: { config: { consumer: 'server' }, isBuilt: true }, client: { config: { consumer: 'client' }, isBuilt: true } }, config: { logger } };
  vi.mocked(inspectBuiltDeployment).mockResolvedValue(join(root, 'dist/ssr/wrangler.json'));
  vi.mocked(checkBuildBudgets).mockResolvedValue({ valid: true, measurements: [], diagnostics: [] });
  return { root, plugin, resolved, hook, builder, logger };
}
it('runs after Cloudflare application completion and clears stale metadata before building', async () => {
  const { root, plugin, resolved, hook, builder } = await fixture();
  await mkdir(join(root, '.wrangler/deploy'), { recursive: true });
  await writeFile(join(root, '.wrangler/deploy/config.json'), '{"configPath":"stale"}');
  expect(plugin.enforce).toBe('post'); expect(hook.order).toBe('post');
  await resolved({ root });
  await expect(access(join(root, '.wrangler/deploy/config.json'))).rejects.toThrow();
  expect(readCloudflareDeclarationConfig).toHaveBeenCalledWith(root, join(root, 'wrangler.jsonc'), 'staging');
  await hook.handler(builder);
  expect(inspectBuiltDeployment).toHaveBeenCalledWith(root, { name: 'selected' });
  expect(checkBuildBudgets).toHaveBeenCalledWith(root, join(root, 'dist/ssr/wrangler.json'), { uploadKiB: { error: 100 } }, { env: { CLOUDFLARE_ENV: 'staging' } });
});
it('does not measure unfinished custom builders or client-only builds', async () => {
  const { root, resolved, hook, builder } = await fixture(); await resolved({ root });
  builder.environments.ssr.isBuilt = false;
  await expect(hook.handler(builder)).rejects.toMatchObject({ code: 'COSSACK_BUILD_BUDGET_BUILD_INCOMPLETE' });
  await expect(hook.handler({ ...builder, environments: { client: builder.environments.client } })).rejects.toMatchObject({ code: 'COSSACK_BUILD_BUDGET_BUILD_INCOMPLETE' });
  expect(checkBuildBudgets).not.toHaveBeenCalled();
});
it('rejects target mismatch before measurement', async () => {
  const { root, resolved, hook, builder } = await fixture(); await resolved({ root });
  vi.mocked(inspectBuiltDeployment).mockRejectedValue(Object.assign(Error('Fixed target mismatch'), { code: 'COSSACK_DEPLOY_TARGET_MISMATCH' }));
  await expect(hook.handler(builder)).rejects.toMatchObject({ code: 'COSSACK_DEPLOY_TARGET_MISMATCH' });
  expect(checkBuildBudgets).not.toHaveBeenCalled();
});
it('reports warnings and rejects hard-budget failures', async () => {
  const { root, resolved, hook, builder, logger } = await fixture(); await resolved({ root });
  vi.mocked(checkBuildBudgets).mockResolvedValue({ valid: true, measurements: [], diagnostics: [{ severity: 'warning', code: 'COSSACK_BUILD_BUDGET_EXCEEDED', message: 'Fixed warning.' }] });
  await hook.handler(builder); expect(logger.warn).toHaveBeenCalledWith('COSSACK_BUILD_BUDGET_EXCEEDED: Fixed warning.');
  vi.mocked(checkBuildBudgets).mockResolvedValue({ valid: false, measurements: [], diagnostics: [{ severity: 'error', code: 'COSSACK_BUILD_BUDGET_EXCEEDED', message: 'Fixed failure.' }] });
  await expect(hook.handler(builder)).rejects.toMatchObject({ code: 'COSSACK_BUILD_BUDGET_FAILED' });
});
it('leaves unconfigured builds unchanged', async () => {
  const { root, resolved, hook, builder } = await fixture({}); await resolved({ root }); await hook.handler(builder);
  expect(inspectBuiltDeployment).not.toHaveBeenCalled(); expect(checkBuildBudgets).not.toHaveBeenCalled();
});
it('rejects unsupported runtimes before artifact or measurement work', async () => {
  const { root, resolved } = await fixture(); vi.mocked(resolveConfigRuntime).mockResolvedValueOnce('node');
  await expect(resolved({ root })).rejects.toMatchObject({ code: 'COSSACK_BUILD_BUDGET_RUNTIME_UNSUPPORTED' });
  expect(checkBuildBudgets).not.toHaveBeenCalled();
});

it.each([{ build: { watch: {} } }, { build: { watch: true } }, { environments: { ssr: { build: { watch: {} } } } },
  { environments: { client: { build: { watch: {} } } } }])('rejects configured watch builds before deleting previous artifact metadata: %j', async config => {
  const { root, resolved } = await fixture();
  await mkdir(join(root, '.wrangler/deploy'), { recursive: true });
  await writeFile(join(root, '.wrangler/deploy/config.json'), '{"configPath":"preserved"}');
  await expect(resolved({ root, ...config })).rejects.toMatchObject({ code: 'COSSACK_BUILD_BUDGET_WATCH_UNSUPPORTED' });
  await expect(access(join(root, '.wrangler/deploy/config.json'))).resolves.toBeUndefined();
  expect(inspectBuiltDeployment).not.toHaveBeenCalled(); expect(checkBuildBudgets).not.toHaveBeenCalled();
});
it.each([null, undefined, false])('allows disabled watch configuration %j', async watch => {
  const { root, resolved, hook, builder } = await fixture(); await resolved({ root, build: { watch } });
  await hook.handler(builder); expect(checkBuildBudgets).toHaveBeenCalledOnce();
});
it('rejects custom builders that enable watching after resolution', async () => {
  const { root, resolved, hook, builder } = await fixture(); await resolved({ root });
  (builder.environments.ssr.config as any).build = { watch: {} };
  await expect(hook.handler(builder)).rejects.toMatchObject({ code: 'COSSACK_BUILD_BUDGET_WATCH_UNSUPPORTED' });
  expect(checkBuildBudgets).not.toHaveBeenCalled();
});
it('does not impose watch policy when no budgets are configured', async () => {
  const { root, resolved, hook, builder } = await fixture({}); await resolved({ root, build: { watch: {} } });
  await hook.handler(builder); expect(checkBuildBudgets).not.toHaveBeenCalled();
});
it('passes an explicit custom source path to the shared config selector', async () => {
  const { root } = await fixture();
  const plugin = cossackBuildBudgets({ configPath: 'deployment/worker.toml', environment: 'staging' });
  await (plugin.configResolved as (config: any) => Promise<void>)({ root });
  expect(findCloudflareConfig).toHaveBeenLastCalledWith(root, 'deployment/worker.toml');
});
