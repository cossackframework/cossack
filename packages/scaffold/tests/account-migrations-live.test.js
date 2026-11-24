// The account migrations on real engines. SQLite always runs; PostgreSQL and MySQL run when
// COSSACK_TEST_POSTGRES_URL and COSSACK_TEST_MYSQL_URL name disposable databases, which
// `pnpm test:databases` sets (docs/testing.md).
import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import * as database from '../../database/src/index.ts';
import { mysql, nodeSQLite, postgres } from '../../database/src/runtime/node.ts';
import { renderRecipe, resolveRecipe } from '../src/index.js';

const postgresUrl = process.env.COSSACK_TEST_POSTGRES_URL || undefined;
const mysqlUrl = process.env.COSSACK_TEST_MYSQL_URL || undefined;
if (process.env.COSSACK_TEST_REQUIRE_LIVE === '1' && !(postgresUrl && mysqlUrl)) {
  throw new Error('COSSACK_TEST_REQUIRE_LIVE=1 requires COSSACK_TEST_POSTGRES_URL and COSSACK_TEST_MYSQL_URL.');
}

async function migrations() {
  const files = await renderRecipe(resolveRecipe({ adapter: 'node', preset: 'full-stack', oauth: 'github' }));
  return [...files].filter(([file]) => /^src\/migrations\/\d+_.*\.ts$/.test(file)).map(([, value]) => {
    const { code } = transformSync(value.content.toString(), { loader: 'ts', format: 'cjs', target: 'es2022' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(() => database, module, module.exports);
    return module.exports.default;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every JSON column of the account tables, as `table.column`. */
const JSON_COLUMNS = ['api_tokens.meta', 'oauth_accounts.meta', 'passkeys.transports', 'roles.meta', 'roles.permissions', 'sessions.data',
  'sessions.meta', 'tenant_domains.meta', 'tenant_members.meta', 'tenants.meta', 'user_security.recovery', 'users.meta'];
const TABLES = [...new Set(JSON_COLUMNS.map(name => name.split('.')[0]))];
const wanted = rows => Object.fromEntries(rows.map(row => [`${row.table_name}.${row.column_name}`, row.data_type]).filter(([name]) => JSON_COLUMNS.includes(name)));
const targets = [
  { name: 'sqlite', skip: false, open: () => nodeSQLite(), json: 'json',
    types: async orm => wanted((await Promise.all(TABLES.map(async table =>
      (await orm.executeFragment(orm.sql.unsafe(`PRAGMA table_info(${table})`), 'select')).rows.map(row => ({ table_name: table, column_name: row.name, data_type: row.type }))))).flat()) },
  { name: 'postgres', skip: !postgresUrl, open: () => postgres(postgresUrl), json: 'jsonb',
    types: async orm => wanted((await orm.executeFragment(orm.sql.unsafe('SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()'), 'select')).rows) },
  { name: 'mysql', skip: !mysqlUrl, open: () => mysql(mysqlUrl), json: 'json',
    types: async orm => wanted((await orm.executeFragment(orm.sql.unsafe('SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type FROM information_schema.columns WHERE table_schema = DATABASE()'), 'select')).rows) },
];

describe.each(targets)('account migrations on $name', target => {
  it.skipIf(target.skip)('apply, keep JSON columns as JSON, and revert', async () => {
    const all = await migrations();
    const orm = database.createORM({ adapter: await target.open(), entities: [] });
    const { sql } = orm;
    try {
      await orm.run(async () => {
        const runner = new database.MigrationRunner(orm, all);
        // A run that stopped half way leaves tables behind: start from none.
        if ((await runner.status()).some(row => row.state !== 'pending')) await runner.down({ count: all.length });
        expect((await runner.up()).length).toBe(all.length);
        expect(await target.types(orm)).toEqual(Object.fromEntries(JSON_COLUMNS.map(name => [name, target.json])));
        await orm.executeFragment(sql.fragment`INSERT INTO users (id, email, meta, created_at) VALUES (${'u1'}, ${'ada@example.com'}, ${sql.json({ plan: 'pro', seats: 3 })}, ${'2026-01-01T00:00:00.000Z'})`, 'insert');
        const row = (await orm.executeFragment(sql.unsafe("SELECT meta, status, network_admin FROM users WHERE id = 'u1'"), 'select')).rows[0];
        expect(typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta).toEqual({ plan: 'pro', seats: 3 });
        expect(row.status).toBe('active');
        // The sign-in code finds its rows by comparing JSON: a session by its purpose, recovery codes by the list read.
        const found = async value => (await orm.executeFragment(sql.fragment`SELECT id FROM users WHERE meta = ${value}`, 'select')).rows.length;
        expect(await found(sql.json({ plan: 'pro', seats: 3 }))).toBe(1);
        expect(await found(sql.json({ plan: 'free', seats: 3 }))).toBe(0);
        await orm.executeFragment(sql.fragment`INSERT INTO roles (id, name, permissions, created_at) VALUES (${'r1'}, ${'editor'}, ${sql.json(['posts.read', 'posts.write'])}, ${'2026-01-01T00:00:00.000Z'})`, 'insert');
        const swapped = await orm.executeFragment(sql.fragment`UPDATE roles SET permissions = ${sql.json(['posts.read'])} WHERE id = ${'r1'} AND permissions = ${sql.json(['posts.read', 'posts.write'])}`, 'update');
        expect(swapped.meta.rowsAffected).toBe(1);
        // A session's purpose is its `kind`, so the project's own `meta` does not hide it from the sign-in code.
        await orm.executeFragment(sql.fragment`INSERT INTO sessions (id, user_id, kind, meta, expires_at) VALUES (${'s1'}, ${'u1'}, ${'auth'}, ${sql.json({ device: 'ipad' })}, ${'2099-01-01T00:00:00.000Z'})`, 'insert');
        await orm.executeFragment(sql.fragment`INSERT INTO sessions (id, user_id, kind, expires_at) VALUES (${'s2'}, ${'u1'}, ${'password_reset'}, ${'2099-01-01T00:00:00.000Z'})`, 'insert');
        expect((await orm.executeFragment(sql.fragment`DELETE FROM sessions WHERE user_id = ${'u1'} AND kind = ${'auth'}`, 'delete')).meta.rowsAffected).toBe(1);
        expect(await runner.down({ count: all.length })).toHaveLength(all.length);
      });
    } finally { await orm.close(); }
  }, 120_000);
});
