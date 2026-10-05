// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { build, type Plugin } from 'vite';
import { cossackConfig } from '../src/vite-plugin';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const privateValue = 'COSSACK_PRIVATE_CONFIG_VALUE_SENTINEL';
function fixture(requirements: string, config: Record<string, unknown> = {}, pkg: Record<string, unknown> = { cossack: { runtime: 'cloudflare' } }) {
  const root = mkdtempSync(join(tmpdir(), 'cossack-config-preflight-')); roots.push(root);
  mkdirSync(join(root, 'src/config'), { recursive: true }); mkdirSync(join(root, 'node_modules'));
  const require = createRequire(import.meta.url);
  symlinkSync(dirname(require.resolve('wrangler/package.json')), join(root, 'node_modules/wrangler'), 'junction');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', ...pkg }));
  writeFileSync(join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'preflight-fixture', compatibility_date: '2026-01-01', ...config }));
  writeFileSync(join(root, 'src/config/app.ts'), `export const requirements = ${requirements}; export default () => { throw new Error('FACTORY_EXECUTED_SENTINEL'); };`);
  writeFileSync(join(root, 'entry.ts'), `import factories, { requirements } from 'virtual:cossack-config'; console.log(factories, requirements);`);
  return root;
}
function actualBuild(root: string, options: Parameters<typeof cossackConfig>[0] = {}, plugins: Plugin[] = []) {
  return build({ root, configFile: false, logLevel: 'silent', plugins: [cossackConfig(options), ...plugins],
    build: { outDir: 'dist', emptyOutDir: true, lib: { entry: join(root, 'entry.ts'), formats: ['es'], fileName: 'client' } } });
}
async function rejectsWithCode(operation: Promise<unknown>, code: string) {
  let failure: any;
  try { await operation; } catch (error) { failure = error; }
  expect(failure, 'preflight must reject the build').toBeDefined();
  const text = String(failure) + String(failure?.code ?? '');
  expect(text).toContain(code);
  expect(text).not.toContain(privateValue);
  expect(text).not.toContain('FACTORY_EXECUTED_SENTINEL');
}
it.each([
  ['{ bindings: { DB: { kind: "d1" } } }', {}, 'COSSACK_CONFIG_REQUIRED_MISSING'],
  ['{ variables: { PORT: { type: "number", coerce: true } } }', { vars: { PORT: privateValue } }, 'COSSACK_CONFIG_VARIABLE_INVALID'],
  ['{ bindings: { DB: { kind: "d1" } } }', { kv_namespaces: [{ binding: 'DB', id: 'a'.repeat(32) }] }, 'COSSACK_CONFIG_BINDING_INVALID'],
  ['dynamicRequirements()', {}, 'COSSACK_CONFIG_REQUIREMENTS_UNKNOWN'],
])('rejects %s before factory transforms, output cleanup, SSG hooks or type generation', async (requirements, config, code) => {
  const root = fixture(requirements, config);
  mkdirSync(join(root, 'dist')); writeFileSync(join(root, 'dist/previous.txt'), 'preserved');
  const activity: string[] = [];
  const observer: Plugin = { name: 'observe-preflight-order', transform(_code, id) { activity.push('transform:' + id); }, closeBundle() { activity.push('closeBundle'); } };
  await rejectsWithCode(actualBuild(root, {}, [observer]), code);
  expect(activity).toEqual([]);
  expect(readFileSync(join(root, 'dist/previous.txt'), 'utf8')).toBe('preserved');
  expect(existsSync(join(root, 'dist/client.js'))).toBe(false);
  expect(existsSync(join(root, '.cossack/config.d.ts'))).toBe(false);
});
it('uses selected environment declarations rather than inherited base variables', async () => {
  const root = fixture('{ variables: { PORT: { type: "number", coerce: true } } }', {
    vars: { PORT: '81' }, env: { staging: { vars: {} }, complete: { vars: { PORT: '82' } } },
  });
  await rejectsWithCode(actualBuild(root, { environment: 'staging' }), 'COSSACK_CONFIG_REQUIRED_MISSING');
  await expect(actualBuild(root, { environment: 'complete' })).resolves.toBeDefined();
  await rejectsWithCode(actualBuild(root, { environment: 'missing' }), 'COSSACK_ENVIRONMENT_UNKNOWN');
});
it('allows unverified remote secrets and keeps values, metadata and factories out of client output', async () => {
  const root = fixture('{ variables: { TOKEN: { type: "string", secret: true } } }', { vars: { PUBLIC_SETTING: privateValue } });
  await actualBuild(root);
  const output = readFileSync(join(root, 'dist/client.js'), 'utf8');
  expect(output).not.toContain(privateValue);
  expect(output).not.toContain('TOKEN');
  expect(output).not.toContain('FACTORY_EXECUTED_SENTINEL');
});
it.each(['node', 'deno'] as const)('uses %s package metadata despite leftover Wrangler configuration', async runtime => {
  const root = fixture('{ bindings: { DB: { kind: "d1", runtimes: ["cloudflare"] } }, variables: { PORT: { type: "number" } } }', {}, { cossack: { runtime } });
  await expect(actualBuild(root)).resolves.toBeDefined();
});
it('uses explicit runtime before scaffold metadata, and scaffold metadata before package metadata', async () => {
  const root = fixture('{ bindings: { DB: { kind: "d1", runtimes: ["cloudflare"] } } }', {}, { cossack: { runtime: 'cloudflare' } });
  mkdirSync(join(root, '.cossack')); writeFileSync(join(root, '.cossack/scaffold.json'), JSON.stringify({ runtime: 'node' }));
  await expect(actualBuild(root)).resolves.toBeDefined();
  await rejectsWithCode(actualBuild(root, { runtime: 'cloudflare' }), 'COSSACK_CONFIG_REQUIRED_MISSING');
});
it('does not hard fail development startup against deployment declarations', async () => {
  const root = fixture('{ variables: { PORT: { type: "number", coerce: true } } }');
  const plugin = cossackConfig() as any;
  await expect(Promise.resolve(plugin.configResolved({ root, command: 'serve', plugins: [] }))).resolves.toBeUndefined();
  expect(existsSync(join(root, '.cossack/config.d.ts'))).toBe(true);
});
it('rechecks edited declarations at buildStart and watches their origins', async () => {
  const root = fixture('{ variables: { PORT: { type: "number", coerce: true } } }', { vars: { PORT: '81' } });
  const plugin = cossackConfig() as any;
  await plugin.configResolved({ root, command: 'build', plugins: [] });
  const watched: string[] = [];
  const context = { environment: { mode: 'build', name: 'client' }, addWatchFile(file: string) { watched.push(file); },
    error(error: any) { throw typeof error === 'string' ? new Error(error) : Object.assign(new Error(error.message), error); }, warn() {} };
  await plugin.buildStart.call(context);
  expect(watched).toContain(join(root, 'src/config/app.ts'));
  expect(watched).toContain(join(root, 'wrangler.jsonc'));
  writeFileSync(join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'preflight-fixture', compatibility_date: '2026-01-01', vars: { PORT: privateValue } }));
  await rejectsWithCode(Promise.resolve().then(() => plugin.buildStart.call(context)), 'COSSACK_CONFIG_VARIABLE_INVALID');
});

it('uses adapter dependency metadata without requiring Wrangler, and permits schema-only unknown targets', async () => {
  for (const pkg of [{ dependencies: { '@cossackframework/node-adapter': '0.8.3' } }, {}]) {
    const root = fixture('{ variables: { PORT: { type: "number" } } }', {}, pkg);
    rmSync(join(root, 'wrangler.jsonc'));
    await expect(actualBuild(root)).resolves.toBeDefined();
  }
});
it('rechecks changed requirement source instead of caching a successful inspection', async () => {
  const root = fixture('{}'); const plugin = cossackConfig() as any;
  await plugin.configResolved({ root, command: 'build', plugins: [] });
  const context = { environment: { mode: 'build', name: 'client' }, addWatchFile() {},
    error(error: any) { throw typeof error === 'string' ? new Error(error) : Object.assign(new Error(error.message), error); }, warn() {} };
  await plugin.buildStart.call(context);
  writeFileSync(join(root, 'src/config/app.ts'), 'export const requirements = { bindings: { DB: { kind: "d1" } } }; export default () => ({});');
  await rejectsWithCode(Promise.resolve().then(() => plugin.buildStart.call(context)), 'COSSACK_CONFIG_REQUIRED_MISSING');
});
it('rejects required Cloudflare binding kinds on an active Node target', async () => {
  const root = fixture('{ bindings: { DB: { kind: "d1" } } }', {}, { cossack: { runtime: 'node' } });
  await rejectsWithCode(actualBuild(root), 'COSSACK_CONFIG_RUNTIME_UNSUPPORTED');
});
it('checks conflicting scalar declarations without claiming Node environment values were inspected', async () => {
  const root = fixture('{ variables: { PORT: { type: "number" } } }', {}, { cossack: { runtime: 'node' } });
  writeFileSync(join(root, 'src/config/other.ts'), 'export const requirements = { variables: { PORT: { type: "string" } } }; export default () => ({});');
  await rejectsWithCode(actualBuild(root), 'COSSACK_CONFIG_REQUIREMENT_CONFLICT');
});

it('validates an explicit nested source config instead of a misleading root config', async () => {
  const root = fixture('{ variables: { PORT: { type: "number", coerce: true } } }', { vars: {} });
  mkdirSync(join(root, 'deployment'));
  writeFileSync(join(root, 'deployment/worker.jsonc'), JSON.stringify({ name: 'custom-preflight', compatibility_date: '2026-01-01', vars: { PORT: '82' } }));
  await expect(actualBuild(root, { configPath: 'deployment/worker.jsonc' })).resolves.toBeDefined();
  await rejectsWithCode(actualBuild(root), 'COSSACK_CONFIG_REQUIRED_MISSING');
});
it('does not fall back to root declarations when the explicit source config is missing', async () => {
  const root = fixture('{}');
  await rejectsWithCode(actualBuild(root, { configPath: 'missing.jsonc' }), 'COSSACK_CONFIG_CHECK_UNAVAILABLE');
});
