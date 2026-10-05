import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
// Each acceptance case starts several real CLI workers.
vi.setConfig({ testTimeout: 30_000 });
const exec = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/cossack.js', import.meta.url));
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-config-command-')); roots.push(root);
  await fs.mkdir(path.join(root, 'src/config'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.writeFile(path.join(root, 'src/config/app.ts'), 'throw new Error("SECRET_FACTORY_EXECUTED"); export default () => ({ password: "SECRET_VALUE" });');
  await fs.writeFile(path.join(root, 'src/config/app.test.ts'), 'ignored');
  await fs.writeFile(path.join(root, 'src/config/types.d.ts'), 'ignored');
  return root;
}
async function cli(root, ...args) {
  let result;
  try { result = { ...(await exec(process.execPath, [bin, 'config', ...args, '--json'], { cwd: root })), code: 0 }; }
  catch (error) { result = { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toContain('SECRET');
  return { ...JSON.parse(result.stdout), exitCode: result.code };
}
it('catalogs type origins without evaluating modules or creating output, including from nested cwd', async () => {
  const root = await fixture();
  const result = await cli(path.join(root, 'src/config'));
  expect(result).toMatchObject({ ok: true, exitCode: 0, command: 'config', data: { count: 1, evaluation: 'not-performed', validation: 'not-performed', factories: [
    { key: 'app', source: 'src/config/app.ts', typeOrigin: { module: 'src/config/app.ts', export: 'default', inference: 'ReturnType' } },
  ] } });
  await expect(fs.access(path.join(root, '.cossack'))).rejects.toThrow();
});
it('generates deterministic types and tracks added and removed factories without exposing values', async () => {
  const root = await fixture(); const output = path.join(root, '.cossack/config.d.ts');
  expect((await cli(root, '--generate')).data.generation).toEqual({ file: '.cossack/config.d.ts', changed: true, written: true, dryRun: false });
  const first = await fs.readFile(output, 'utf8'); expect(first).not.toContain('SECRET');
  expect((await cli(root, '--generate')).data.generation).toMatchObject({ changed: false, written: false });
  expect(await fs.readFile(output, 'utf8')).toBe(first);
  await fs.writeFile(path.join(root, 'src/config/z-extra.ts'), 'export default () => ({ count: 1 });');
  expect((await cli(root, '--generate')).data.factories.map(factory => factory.key)).toEqual(['app', 'z-extra']);
  await fs.unlink(path.join(root, 'src/config/app.ts'));
  expect((await cli(root, '--generate')).data.factories.map(factory => factory.key)).toEqual(['z-extra']);
  expect(await fs.readFile(output, 'utf8')).not.toContain('../src/config/app.ts');
});
it('dry run leaves both missing and existing generated outputs untouched', async () => {
  const root = await fixture(); const output = path.join(root, '.cossack/config.d.ts');
  expect((await cli(root, '--generate', '--dry-run')).data.generation).toMatchObject({ changed: true, written: false, dryRun: true });
  await expect(fs.access(path.join(root, '.cossack'))).rejects.toThrow();
  await cli(root, '--generate'); const before = await fs.readFile(output, 'utf8');
  await fs.writeFile(path.join(root, 'src/config/cache.ts'), 'export default () => ({});');
  expect((await cli(root, '--generate', '--dry-run')).data.generation).toMatchObject({ changed: true, written: false });
  expect(await fs.readFile(output, 'utf8')).toBe(before);
});
it('preserves authored output with a coded failure while allowing a read-only catalog', async () => {
  const root = await fixture(); const output = path.join(root, '.cossack/config.d.ts');
  await fs.mkdir(path.dirname(output)); await fs.writeFile(output, '// authored');
  expect((await cli(root)).ok).toBe(true);
  for (const args of [['--generate'], ['--generate', '--dry-run']]) {
    expect(await cli(root, ...args)).toMatchObject({ ok: false, exitCode: 1, diagnostics: [{ code: 'COSSACK_CONFIG_GENERATION_CONFLICT' }] });
  }
  expect(await fs.readFile(output, 'utf8')).toBe('// authored');
});
it.each([
  [['--dry-run'], 'COSSACK_OPTION_CONFLICT'],
  [['--generate=false', '--dry-run'], 'COSSACK_OPTION_CONFLICT'],
  [['--env=production'], 'COSSACK_OPTION_UNKNOWN'],
  [['--force'], 'COSSACK_OPTION_UNKNOWN'],
  [['extra'], 'COSSACK_ARGUMENT_UNEXPECTED'],
])('rejects invalid options before writes: %j', async (args, code) => {
  const root = await fixture();
  expect(await cli(root, ...args)).toMatchObject({ ok: false, exitCode: 1, diagnostics: [{ code }] });
  await expect(fs.access(path.join(root, '.cossack'))).rejects.toThrow();
});
