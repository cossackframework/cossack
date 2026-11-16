import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assertRepositoryModulesIntact, linkInstalledPackage } from './fixtures/linked-app.js';

let root;
const write = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
};

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-linked-app-test-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('installs into a linked scope without touching the repository it links to', async () => {
  const repository = path.join(root, 'repository/node_modules');
  await write(path.join(repository, '@scope/a/index.js'), 'repository a');
  await write(path.join(repository, '@scope/b/index.js'), 'repository b');
  const app = path.join(root, 'app/node_modules');
  await fs.mkdir(app, { recursive: true });
  await fs.symlink(path.join(repository, '@scope'), path.join(app, '@scope'));
  await write(path.join(root, 'installed/a/index.js'), 'installed a');

  await linkInstalledPackage(app, path.join(root, 'installed/a'), '@scope/a');

  expect((await fs.lstat(path.join(repository, '@scope/a'))).isDirectory()).toBe(true);
  expect(await fs.readFile(path.join(repository, '@scope/a/index.js'), 'utf8')).toBe('repository a');
  expect((await fs.lstat(path.join(app, '@scope'))).isDirectory()).toBe(true);
  expect(await fs.readFile(path.join(app, '@scope/a/index.js'), 'utf8')).toBe('installed a');
  expect(await fs.readFile(path.join(app, '@scope/b/index.js'), 'utf8')).toBe('repository b');
});

it('links two packages of one scope, and an unscoped package', async () => {
  const app = path.join(root, 'app/node_modules');
  await fs.mkdir(app, { recursive: true });
  for (const name of ['a', 'b', 'c']) await write(path.join(root, 'installed', name, 'index.js'), name);
  await linkInstalledPackage(app, path.join(root, 'installed/a'), '@scope/a');
  await linkInstalledPackage(app, path.join(root, 'installed/b'), '@scope/b');
  await linkInstalledPackage(app, path.join(root, 'installed/c'), 'c');
  await linkInstalledPackage(app, path.join(root, 'installed/c'), 'c');
  expect(await fs.readFile(path.join(app, '@scope/a/index.js'), 'utf8')).toBe('a');
  expect(await fs.readFile(path.join(app, '@scope/b/index.js'), 'utf8')).toBe('b');
  expect(await fs.readFile(path.join(app, 'c/index.js'), 'utf8')).toBe('c');
});

it('reports repository packages that link into the test cache', async () => {
  const modules = path.join(root, 'node_modules');
  await write(path.join(modules, '@scope/real/index.js'), 'real');
  await write(path.join(modules, 'plain/index.js'), 'plain');
  await fs.symlink('../packages/workspace', path.join(modules, 'workspace'));
  await expect(assertRepositoryModulesIntact(modules)).resolves.toBeUndefined();

  await fs.symlink('/tmp/cossack-linked-app-cache/entry/installed/node_modules/@scope/core', path.join(modules, '@scope/core'));
  await expect(assertRepositoryModulesIntact(modules)).rejects.toThrow(/@scope\/core[\s\S]*optimistic-repeat-install/);
});
