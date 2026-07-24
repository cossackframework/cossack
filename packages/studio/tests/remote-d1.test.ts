import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRemoteD1Connection,
  readD1Bindings,
  selectD1Binding,
} from '../src/testing';

const directories: string[] = [];

async function fixture(config: string, filename = 'wrangler.jsonc') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-studio-remote-'));
  directories.push(root);
  await fs.writeFile(path.join(root, filename), config);
  return root;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('remote D1', () => {
  it('reads JSONC bindings and environment overrides', async () => {
    const root = await fixture(`{
      // default
      "d1_databases": [{ "binding": "DB", "database_name": "local", }],
      "env": { "production": {
        "d1_databases": [{ "binding": "PROD", "database_id": "123" }]
      }}
    }`);
    expect(await readD1Bindings(root)).toEqual([
      { binding: 'DB', databaseName: 'local', databaseId: undefined },
    ]);
    expect(await readD1Bindings(root, 'production')).toEqual([
      { binding: 'PROD', databaseName: undefined, databaseId: '123' },
    ]);
  });

  it('auto-selects one binding, validates requested bindings, and supports a prompt', async () => {
    const single = [{ binding: 'DB' }];
    expect((await selectD1Binding(single)).binding).toBe('DB');
    await expect(selectD1Binding(single, 'NOPE')).rejects.toThrow('Available bindings: DB');
    expect((await selectD1Binding(
      [{ binding: 'A' }, { binding: 'B' }],
      undefined,
      async () => 'B',
    )).binding).toBe('B');
  });

  it('spawns Wrangler with argument arrays and parses results', async () => {
    const root = await fixture(`{
      "d1_databases": [{ "binding": "DB", "database_name": "production" }]
    }`);
    const execute = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([{
        success: true,
        results: [{ id: 1 }],
        meta: { changes: 2, last_row_id: 3 },
      }]),
      stderr: '',
      exitCode: 0,
    });
    const connection = await createRemoteD1Connection({
      projectRoot: root,
      environment: 'production',
      wranglerCommand: 'wrangler',
      execute,
    });
    const result = await connection.execute('SELECT 1');
    expect(execute).toHaveBeenCalledWith('wrangler', [
      'd1', 'execute', 'DB', '--remote', '--json', '--command', 'SELECT 1',
      '--env', 'production',
    ], root);
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(result.affectedRows).toBe(2);
  });

  it('surfaces authentication exits and malformed output', async () => {
    const root = await fixture('{"d1_databases":[{"binding":"DB"}]}');
    const failed = await createRemoteD1Connection({
      projectRoot: root,
      execute: async () => ({ stdout: '', stderr: 'Not authenticated', exitCode: 1 }),
    });
    await expect(failed.execute('SELECT 1')).rejects.toThrow('Not authenticated');
    const malformed = await createRemoteD1Connection({
      projectRoot: root,
      execute: async () => ({ stdout: 'hello', stderr: '', exitCode: 0 }),
    });
    await expect(malformed.execute('SELECT 1')).rejects.toThrow('malformed JSON');
  });
});
