import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { createORM } from '../src/orm.js';
import { nodeSQLite } from '../src/runtime/node.js';
import { runORMCommand } from '../src/tooling/index.js';

it('runs status, JSON previews, and named checksum acceptance against a persistent tooling database', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cossack-rehash-tooling-'));
  let configPath = join(cwd, 'orm.config.mjs');
  const filename = join(cwd, 'target.sqlite');
  const config = (edited: boolean) => `
    import { nodeSQLite } from ${JSON.stringify(pathToFileURL(resolve('src/runtime/node.ts')).href)};
    export default {
      adapter: () => nodeSQLite({ filename: ${JSON.stringify(filename)} }), entities: [],
      migrations: ['001_addresses', '002_outreach', '003_unrelated'].map((name, index) => ({
        name,
        up: ${edited ? "index < 2 ? function editedUp() { throw Error('Rehash executed a callback'); } :" : ''}
          function up({ orm, schema }) { schema.raw(orm.sql.unsafe('CREATE TABLE ' + name.slice(4) + ' (id integer)')); },
        down({ schema }) { schema.dropTable(name.slice(4)); },
      })),
    };
  `;
  const run = async (args: string[], code = 0) => {
    const stdout: string[] = [], stderr: string[] = [];
    expect(await runORMCommand(['migration', ...args], { cwd, configPath,
      stdout: message => stdout.push(message), stderr: message => stderr.push(message),
    }), stderr.join('\n')).toBe(code);
    return { stdout, stderr };
  };
  const history = async () => {
    const orm = createORM({ adapter: await nodeSQLite({ filename }), entities: [] });
    try { return (await orm.executeFragment(orm.sql.unsafe('SELECT * FROM _cossack_migrations ORDER BY name'))).rows; }
    finally { await orm.close(); }
  };
  try {
    await writeFile(configPath, config(false));
    await run(['up']);
    const before = await history();
    configPath = join(cwd, 'orm.edited.config.mjs');
    await writeFile(configPath, config(true));
    const status = await run(['status']);
    expect(status.stdout.filter(line => line.startsWith('changed'))).toHaveLength(2);
    expect(status.stdout.filter(line => line.includes('stored:'))).toHaveLength(2);
    expect(status.stdout.filter(line => line.includes('current:'))).toHaveLength(2);
    const changed = JSON.parse((await run(['status', '--json'])).stdout[0]!).data.migrations;
    expect(changed.slice(0, 2)).toMatchObject([{ state: 'changed' }, { state: 'changed' }]);
    const preview = await run(['rehash', '001_addresses', '002_outreach', '--dry-run', '--json']);
    expect(preview.stdout).toHaveLength(1);
    const result = JSON.parse(preview.stdout[0]!);
    expect(result).toMatchObject({ ok: true, action: 'rehash', data: {
      dryRun: true, target: { readOnly: true }, migrations: changed.slice(0, 2).map((row: { name: string; checksum: string; applied: { checksum: string } }) => ({
        name: row.name, previousChecksum: row.applied.checksum, checksum: row.checksum,
      })),
    } });
    expect(await history()).toEqual(before);
    await run(['rehash', '001_addresses', 'unknown'], 1);
    expect(await history()).toEqual(before);
    const applied = JSON.parse((await run(['rehash', '001_addresses', '002_outreach', '--json'])).stdout[0]!);
    expect(applied.data).toMatchObject({ dryRun: false, target: { readOnly: false }, migrations: result.data.migrations });
    await run(['check']);
    expect((await history())[2]).toEqual(before[2]);
    const orm = createORM({ adapter: await nodeSQLite({ filename }), entities: [] });
    try {
      expect((await orm.executeFragment(orm.sql.unsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name != '_cossack_migrations' ORDER BY name"))).rows)
        .toEqual([{ name: 'addresses' }, { name: 'outreach' }, { name: 'unrelated' }]);
    } finally { await orm.close(); }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

it('rejects an empty rehash selection before importing configuration', async () => {
  const errors: string[] = [];
  expect(await runORMCommand(['migration', 'rehash'], { configPath: '/missing/orm.config.ts', stderr: message => errors.push(message) })).toBe(1);
  expect(errors).toEqual([expect.stringContaining('at least one migration name')]);
});
