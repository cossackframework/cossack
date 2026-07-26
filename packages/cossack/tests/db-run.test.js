import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCliClient } from '../src/commands/db-run.js';

const temporaryDirectories = [];

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-db-run-'));
  temporaryDirectories.push(root);
  await fs.mkdir(path.join(root, 'src', 'db'), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('database CLI client loading', () => {
  it('loads getCliClient from the CLI-only database module', async () => {
    const root = await createProject();
    await fs.writeFile(
      path.join(root, 'src', 'db', 'cli.ts'),
      'export async function getCliClient() { return { source: "cli" }; }\n',
    );
    await fs.writeFile(
      path.join(root, 'src', 'db', 'config.ts'),
      'throw new Error("runtime config must not be loaded");\n',
    );

    await expect(loadCliClient(root)).resolves.toEqual({ source: 'cli' });
  });

  it('does not fall back to the runtime database module', async () => {
    const root = await createProject();
    await fs.writeFile(
      path.join(root, 'src', 'db', 'config.ts'),
      'export async function getCliClient() { return { source: "legacy" }; }\n',
    );

    await expect(loadCliClient(root)).rejects.toThrow('No src/db/cli.ts found');
  });

  it('requires getCliClient to be exported by the CLI module', async () => {
    const root = await createProject();
    await fs.writeFile(
      path.join(root, 'src', 'db', 'cli.ts'),
      'export const createClient = () => ({});\n',
    );

    await expect(loadCliClient(root)).rejects.toThrow(
      'src/db/cli.ts must export `getCliClient()`',
    );
  });
});
