import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const roots = [];
const bin = fileURLToPath(new URL('../bin/cossack.js', import.meta.url));
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(database = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack database cli '));
  roots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module',
    dependencies: database ? { '@cossackframework/database': '^0.9.0' } : {} }));
  if (database) {
    await fs.mkdir(path.join(root, 'node_modules/@cossackframework'), { recursive: true });
    await fs.symlink(fileURLToPath(new URL('../../database/', import.meta.url)),
      path.join(root, 'node_modules/@cossackframework/database'), 'junction');
    await fs.writeFile(path.join(root, 'orm.config.ts'), `
import { defineConfig } from '@cossackframework/database';
import { MemoryDriver } from '@cossackframework/database/adapter';
import { spawnSync } from 'node:child_process';
console.log('sensitive-fixture-config-log');
console.error('sensitive-fixture-config-error');
spawnSync(process.execPath, ['--eval', 'process.stdout.write("sensitive-fixture-subprocess-log\\\\n")'], {stdio: 'inherit'});
export default defineConfig({
  entities: [],
  adapter(context) {
    console.log('sensitive-fixture-adapter-log');
    const driver = new MemoryDriver();
    driver.close = async () => { process.stderr.write('sensitive-fixture-close-log\\n'); };
    return {driver, tooling: {provider: 'integration', target: context.target}};
  },
  migrations: [{name: '001_fixture', up({orm, schema}) {
    console.log('sensitive-fixture-migration-log');
    schema.raw(orm.sql.unsafe('CREATE TABLE example (id integer)'));
  }, down() {}}],
  seeds: [{name: 'fixture', run() { throw new Error('Dry-run must not execute seeder'); }}],
});
`);
  }
  return root;
}

function execute(root, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...argv], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', exitCode => resolve({ stdout, stderr, exitCode }));
  });
}

describe('database CLI JSON contract', () => {
  it.each([
    ['migration:plan', '--env=staging', '--target=remote'],
    ['schema', 'diff'],
    ['seeder', 'run', '--dry-run'],
    ['seed', 'list'],
  ])('returns one result through the actual CLI with noisy configuration: %j', async (...argv) => {
    const root = await fixture();
    const { stdout, stderr, exitCode } = await execute(root, [...argv, '--json']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1, ok: true, diagnostics: [] });
    expect(stdout).not.toContain('sensitive-fixture');
    expect(await fs.readdir(root)).toEqual(['node_modules', 'orm.config.ts', 'package.json']);
  });

  it.each([
    ['migration', 'typo'],
    ['schema', 'typo'],
    ['seeder', 'typo'],
    ['migration', 'plan', '--remote=maybe'],
    ['unknown-command'],
  ])('returns JSON diagnostics for invalid actions/options: %j', async (...argv) => {
    const { stdout, stderr, exitCode } = await execute(await fixture(false), [...argv, '--json']);
    expect(exitCode).toBe(1);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1, ok: false,
      diagnostics: [{ severity: 'error', code: expect.any(String) }] });
  });

  it('returns a structured missing ORM diagnostic and command help without importing configuration', async () => {
    const root = await fixture(false);
    const missing = await execute(root, ['migration', 'plan', '--json']);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toBe('');
    expect(JSON.parse(missing.stdout)).toMatchObject({ ok: false,
      diagnostics: [{ code: 'COSSACK_ORM_UNAVAILABLE' }] });
    const help = await execute(root, ['migration', '--help', '--json']);
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toBe('');
    expect(JSON.parse(help.stdout)).toMatchObject({ ok: true, data: { help: expect.stringContaining('migration plan') } });
  });
});
