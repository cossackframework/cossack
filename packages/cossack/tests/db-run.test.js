import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadORMTooling } from '../src/commands/db-run.js';

const temporaryDirectories = [];

async function createProject(toolingSource) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-orm-tooling-'));
  temporaryDirectories.push(root);
  const packageRoot = path.join(root, 'node_modules', '@cossackframework', 'orm');
  await fs.mkdir(path.join(packageRoot, 'dist', 'tooling'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
  await fs.writeFile(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@cossackframework/orm',
      version: '1.1.0',
      type: 'module',
      exports: { './package.json': './package.json' },
    }),
  );
  if (toolingSource !== undefined) {
    await fs.writeFile(path.join(packageRoot, 'dist', 'tooling', 'index.js'), toolingSource);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('application ORM tooling loading', () => {
  it('loads runORMCommand from the application ORM package', async () => {
    const root = await createProject(
      'export async function runORMCommand() { return 0; }\n',
    );
    const tooling = await loadORMTooling(root);
    await expect(tooling.runORMCommand([])).resolves.toBe(0);
  });

  it('does not fall back when the application ORM package is absent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-orm-tooling-'));
    temporaryDirectories.push(root);
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
    await expect(loadORMTooling(root)).rejects.toThrow(
      '@cossackframework/orm is not installed',
    );
  });

  it('requires ORM 1.1 tooling to export runORMCommand', async () => {
    const root = await createProject('export const unsupported = true;\n');
    await expect(loadORMTooling(root)).rejects.toThrow(
      'does not export tooling support',
    );
  });
});
