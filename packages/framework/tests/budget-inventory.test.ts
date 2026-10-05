// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink, truncate, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintBudgetInventory } from '../src/budget-inventory';

const roots: string[] = [];
const originalPath = process.env.MINIFLARE_WORKERD_PATH;
const originalGates = process.env.MINIFLARE_WORKERD_AUTOGATES;
beforeEach(() => { delete process.env.MINIFLARE_WORKERD_PATH; delete process.env.MINIFLARE_WORKERD_AUTOGATES; });
afterEach(async () => {
  if (originalPath === undefined) delete process.env.MINIFLARE_WORKERD_PATH; else process.env.MINIFLARE_WORKERD_PATH = originalPath;
  if (originalGates === undefined) delete process.env.MINIFLARE_WORKERD_AUTOGATES; else process.env.MINIFLARE_WORKERD_AUTOGATES = originalGates;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cossack-budget-inventory-')); roots.push(root);
  const artifacts: string[] = [];
  for (const target of ['primary', 'auxiliary']) {
    const dir = join(root, 'dist', target); await mkdir(join(dir, 'chunks'), { recursive: true });
    const config = join(dir, 'wrangler.json'); artifacts.push(config);
    await writeFile(config, JSON.stringify({ no_bundle: true, main: 'index.js' }));
    await writeFile(join(dir, 'index.js'), 'export default {fetch(){return new Response("PRIVATE")}}');
    await writeFile(join(dir, 'chunks', 'data.txt'), 'PRIVATE');
  }
  await writeFile(join(root, 'package.json'), '{}');
  const source = join(root, 'wrangler.jsonc'); await writeFile(source, '{"name":"PRIVATE"}');
  const tool = join(root, 'node_modules', 'wrangler'); await mkdir(tool, { recursive: true });
  await writeFile(join(tool, 'package.json'), '{"name":"wrangler","main":"cli.js","bin":"bin.js"}');
  await writeFile(join(tool, 'cli.js'), '// CLI'); await writeFile(join(tool, 'bin.js'), '// bin');
  const fingerprint = (startup = false, context = 'policy') => fingerprintBudgetInventory(root, artifacts, [source], context, startup);
  return { root, artifacts, source, tool, fingerprint };
}
it('binds multiple Worker inventories, source configuration, policy and target ordering', async () => {
  const f = await fixture(); const before = await f.fingerprint(); expect(before).toMatch(/^[a-f\d]{64}$/);
  expect(await f.fingerprint()).toBe(before);
  expect(await f.fingerprint(false, 'changed')).not.toBe(before);
  expect(await fingerprintBudgetInventory(f.root, [...f.artifacts].reverse(), [f.source], 'policy')).not.toBe(before);
  await writeFile(join(f.root, 'dist/auxiliary/chunks/data.txt'), 'CHANGED'); expect(await f.fingerprint()).not.toBe(before);
});
it.each(['source', 'manifest', 'cli', 'bin', 'module'])('invalidates changed %s content', async kind => {
  const f = await fixture(); const before = await f.fingerprint();
  const file = ({ source: f.source, manifest: join(f.tool, 'package.json'), cli: join(f.tool, 'cli.js'), bin: join(f.tool, 'bin.js'), module: join(f.root, 'dist/primary/index.js') })[kind]!;
  await writeFile(file, kind === 'manifest' ? '{"name":"wrangler","main":"cli.js","bin":"bin.js","version":"2"}' : 'changed');
  expect(await f.fingerprint()).not.toBe(before);
});
it.each([{ no_bundle: false }, { main: '../../outside.js' }, { base_dir: '../../' }, { build: { command: 'build' } },
  { site: {} }, { unsafe: {} }, { wasm_modules: {} }, { text_blobs: {} }, { data_blobs: {} }, { main: 'index.ts' }])('declines unsupported graph %j', async config => {
  const f = await fixture(); await writeFile(f.artifacts[0], JSON.stringify({ no_bundle: true, main: 'index.js', ...config }));
  expect(await f.fingerprint()).toBeUndefined();
});
it.each(['source', 'config', 'module', 'directory'])('declines symbolic %s', async kind => {
  const f = await fixture();
  const file = ({ source: f.source, config: f.artifacts[0], module: join(f.root, 'dist/primary/index.js'), directory: join(f.root, 'dist/primary/chunks') })[kind]!;
  await rename(file, `${file}.original`); await symlink(`${file}.original`, file, kind === 'directory' ? 'dir' : 'file');
  expect(await f.fingerprint()).toBeUndefined();
});
it('supports nested/overlapping roots conservatively and detects additions and removals', async () => {
  const f = await fixture(); const nested = join(f.root, 'dist/primary/nested'); await mkdir(nested);
  await writeFile(join(nested, 'wrangler.json'), '{"no_bundle":true,"main":"index.js"}'); await writeFile(join(nested, 'index.js'), 'export default 1');
  f.artifacts.push(join(nested, 'wrangler.json')); const before = await f.fingerprint(); expect(before).toMatch(/^[a-f\d]{64}$/);
  await writeFile(join(nested, 'added.js'), 'export default 2'); expect(await f.fingerprint()).not.toBe(before);
  await rm(join(nested, 'added.js')); expect(await f.fingerprint()).toBe(before);
});
it('declines outside source files and bounded artifact/source sizes', async () => {
  const f = await fixture(); expect(await fingerprintBudgetInventory(f.root, f.artifacts, ['/etc/passwd'], 'policy')).toBeUndefined();
  await truncate(f.source, 1024 * 1024 + 1); expect(await f.fingerprint()).toBeUndefined();
});
it('enforces the aggregate artifact byte limit without reading oversized files', async () => {
  const f = await fixture(); const large = join(f.root, 'dist/auxiliary/large.bin'); await writeFile(large, ''); await truncate(large, 64 * 1024 * 1024);
  expect(await f.fingerprint()).toBeUndefined();
});
it('enforces the aggregate file limit across Workers', async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 4096 }, (_, index) => writeFile(join(f.root, 'dist/auxiliary', `${index}.txt`), '')));
  expect(await f.fingerprint()).toBeUndefined();
}, 20000);
it('bounds empty directories across Worker inventories', async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 4096 }, (_, index) => mkdir(join(f.root, 'dist/auxiliary', `empty-${index}`))));
  expect(await f.fingerprint()).toBeUndefined();
}, 20000);
it('ignores tool-created empty directories but binds any files later added there', async () => {
  const f = await fixture(); const before = await f.fingerprint();
  const temporary = join(f.root, 'dist/primary/.wrangler/tmp'); await mkdir(temporary, { recursive: true });
  expect(await f.fingerprint()).toBe(before);
  await writeFile(join(temporary, 'added.js'), 'export default 1');
  expect(await f.fingerprint()).not.toBe(before);
});
async function runtime(f: Awaited<ReturnType<typeof fixture>>, alternate = false) {
  const miniflare = join(f.root, 'node_modules/miniflare'); const workerd = join(f.root, 'node_modules/workerd');
  const pkg = process.platform === 'darwin' ? `workerd-darwin-${process.arch === 'x64' ? '64' : 'arm64'}` : process.platform === 'win32' ? 'workerd-windows-64' : `workerd-linux-${process.arch === 'x64' ? '64' : 'arm64'}`;
  const native = join(f.root, 'node_modules/@cloudflare', pkg);
  await mkdir(miniflare, { recursive: true }); await mkdir(workerd); await mkdir(join(native, 'bin'), { recursive: true });
  await writeFile(join(miniflare, 'package.json'), '{"name":"miniflare","main":"index.js"}'); await writeFile(join(miniflare, 'index.js'), '// miniflare');
  await writeFile(join(workerd, 'package.json'), '{"name":"workerd","main":"index.cjs"}');
  const binary = join(native, 'bin', `workerd${process.platform === 'win32' ? '.exe' : ''}`); await writeFile(binary, 'runtime');
  await writeFile(join(native, 'package.json'), JSON.stringify({ name: `@cloudflare/${pkg}` }));
  await writeFile(join(workerd, 'index.cjs'), `module.exports={default:${JSON.stringify(alternate ? join(f.root, 'fallback') : binary)}}`);
  if (alternate) await writeFile(join(f.root, 'fallback'), 'fallback');
  return { miniflare, workerd, native, binary };
}
it('declines startup reuse without a resolvable runtime identity', async () => {
  const f = await fixture(); expect(await f.fingerprint(true)).toBeUndefined(); expect(await f.fingerprint()).toMatch(/^[a-f\d]{64}$/);
});
it.each(['binary', 'loader', 'miniflare', 'manifest'])('binds startup runtime %s identity', async kind => {
  const f = await fixture(); const r = await runtime(f); const before = await f.fingerprint(true); expect(before).toMatch(/^[a-f\d]{64}$/);
  const file = ({ binary: r.binary, loader: join(r.workerd, 'index.cjs'), miniflare: join(r.miniflare, 'index.js'), manifest: join(r.native, 'package.json') })[kind]!;
  await writeFile(file, 'changed'); expect(await f.fingerprint(true)).not.toBe(before);
});
it('declines downloaded/unsupported runtime fallback paths', async () => {
  const f = await fixture(); await runtime(f, true); expect(await f.fingerprint(true)).toBeUndefined();
});
it('binds explicit runtime override contents and autogates', async () => {
  const f = await fixture(); await runtime(f, true); const override = join(f.root, 'custom-runtime'); await writeFile(override, 'custom');
  process.env.MINIFLARE_WORKERD_PATH = override; const before = await f.fingerprint(true); expect(before).toMatch(/^[a-f\d]{64}$/);
  process.env.MINIFLARE_WORKERD_AUTOGATES = 'changed'; expect(await f.fingerprint(true)).not.toBe(before);
  delete process.env.MINIFLARE_WORKERD_AUTOGATES; await writeFile(override, 'different'); expect(await f.fingerprint(true)).not.toBe(before);
  await rm(override); await symlink(join(f.root, 'fallback'), override); expect(await f.fingerprint(true)).toBeUndefined();
});
it('declines relative runtime commands whose spawn resolution is not bound', async () => {
  const f = await fixture(); await runtime(f); await writeFile(join(f.root, 'custom-runtime'), 'project binary');
  for (const command of ['', 'custom-runtime', './custom-runtime']) {
    process.env.MINIFLARE_WORKERD_PATH = command;
    expect(await f.fingerprint(true)).toBeUndefined();
  }
});
it('enforces the separate runtime/tool byte bound', async () => {
  const f = await fixture(); const r = await runtime(f);
  await truncate(r.binary, 256 * 1024 * 1024);
  expect(await f.fingerprint(true)).toBeUndefined();
});
