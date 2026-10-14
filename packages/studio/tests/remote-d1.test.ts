import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRemoteD1Connection,
  readD1Bindings,
  resolveWranglerInvocation,
  selectD1Binding,
} from '../src/testing';

const directories: string[] = [];

async function fixture(config: string, filename = 'wrangler.jsonc') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-studio-remote-'));
  directories.push(root);
  const require = createRequire(import.meta.url);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.symlink(path.dirname(require.resolve('wrangler/package.json')), path.join(root, 'node_modules/wrangler'), 'junction');
  await fs.writeFile(path.join(root, 'package.json'), '{}');
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
      { binding: 'DB', databaseName: 'local' },
    ]);
    expect(await readD1Bindings(root, 'production')).toEqual([
      { binding: 'PROD', databaseId: '123' },
    ]);
  });

  it('never falls back to top-level bindings for named environments', async () => {
    const root = await fixture('{"d1_databases":[{"binding":"PRODUCTION"}],"env":{"staging":{}}}');
    expect(await readD1Bindings(root, 'staging')).toEqual([]);
    await expect(readD1Bindings(root, 'typo')).rejects.toThrow('not configured');
  });

  it('reads quoted TOML environment names with the project Wrangler parser', async () => {
    const root = await fixture(`
[[d1_databases]]
binding = "PRODUCTION"
database_name = "production-db"
[env."preview.branch"]
[[env."preview.branch".d1_databases]]
binding = "PREVIEW"
database_name = "preview-db"
`, 'wrangler.toml');
    expect(await readD1Bindings(root, 'preview.branch')).toEqual([
      { binding: 'PREVIEW', databaseName: 'preview-db' },
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
      "env": { "production": { "d1_databases": [{ "binding": "DB", "database_name": "production" }] } }
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

  it('runs the project Wrangler entry with Node instead of a shell shim', async () => {
    const root = await fixture('{"d1_databases":[{"binding":"DB"}]}');
    const entry = await fs.realpath(path.join(root, 'node_modules/wrangler/bin/wrangler.js'));
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      const invocation = resolveWranglerInvocation(root, {
        platform,
        execPath: platform === 'win32' ? 'C:\\node\\node.exe' : '/usr/bin/node',
      });
      expect(invocation.command).toBe(platform === 'win32' ? 'C:\\node\\node.exe' : '/usr/bin/node');
      expect(invocation.args).toHaveLength(1);
      expect(await fs.realpath(invocation.args[0]!)).toBe(entry);
      expect(invocation.args[0]).not.toMatch(/\.cmd$/);
    }

    const execute = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([{ success: true, results: [], meta: { changes: 0 } }]),
      stderr: '',
      exitCode: 0,
    });
    const connection = await createRemoteD1Connection({ projectRoot: root, execute });
    await connection.execute('SELECT 1');
    const [command, args] = execute.mock.calls[0]!;
    expect(command).toBe(process.execPath);
    expect(await fs.realpath(args[0])).toBe(entry);
    expect(args.slice(1)).toEqual(['d1', 'execute', 'DB', '--remote', '--json', '--command', 'SELECT 1']);
  });

  it('sends a batch as one Wrangler command and maps one result per statement', async () => {
    const root = await fixture('{"d1_databases":[{"binding":"DB"}]}');
    const execute = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([
        { success: true, results: [{ n: 1 }], meta: { changes: 0 } },
        { success: true, results: [], meta: { changes: 1, last_row_id: 7 } },
      ]),
      stderr: '',
      exitCode: 0,
    });
    const connection = await createRemoteD1Connection({ projectRoot: root, wranglerCommand: 'wrangler', execute });
    const results = await connection.batch([
      { sql: 'SELECT 1 AS n -- first;' },
      { sql: "DELETE FROM items WHERE name = 'a;b';  " },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![1]).toEqual([
      'd1', 'execute', 'DB', '--remote', '--json', '--command',
      "SELECT 1 AS n -- first\n;\nDELETE FROM items WHERE name = 'a;b'",
    ]);
    expect(results.map(({ rows, affectedRows, insertId }) => ({ rows, affectedRows, insertId }))).toEqual([
      { rows: [{ n: 1 }], affectedRows: 0, insertId: undefined },
      { rows: [], affectedRows: 1, insertId: '7' },
    ]);
    await expect(connection.batch([{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }, { sql: 'SELECT 3' }]))
      .rejects.toThrow('Wrangler returned 2 result(s) for 3 statement(s).');
    await expect(connection.batch([{ sql: 'SELECT ?', parameters: [1] }]))
      .rejects.toThrow('escaped SQLite literals');
    expect(await connection.batch([])).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('explains how to fix a project without Wrangler', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-studio-no-wrangler-'));
    directories.push(root);
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    expect(() => resolveWranglerInvocation(root, { platform: 'win32' }))
      .toThrow(/Wrangler is not installed/);
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
