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

/** The tables with a `meta` column, and how each engine stores JSON. */
const META_TABLES = ['api_tokens', 'oauth_accounts', 'roles', 'sessions', 'tenant_domains', 'tenant_members', 'tenants', 'users'];
const targets = [
  { name: 'sqlite', skip: false, open: () => nodeSQLite(), json: 'json',
    types: async orm => Object.fromEntries(await Promise.all(META_TABLES.map(async table => [table,
      (await orm.executeFragment(orm.sql.unsafe(`PRAGMA table_info(${table})`), 'select')).rows.find(row => row.name === 'meta')?.type]))) },
  { name: 'postgres', skip: !postgresUrl, open: () => postgres(postgresUrl), json: 'jsonb',
    types: async orm => Object.fromEntries((await orm.executeFragment(orm.sql.unsafe("SELECT table_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'meta'"), 'select')).rows
      .filter(row => META_TABLES.includes(row.table_name)).map(row => [row.table_name, row.data_type])) },
  { name: 'mysql', skip: !mysqlUrl, open: () => mysql(mysqlUrl), json: 'json',
    types: async orm => Object.fromEntries((await orm.executeFragment(orm.sql.unsafe("SELECT TABLE_NAME AS table_name, DATA_TYPE AS data_type FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'meta'"), 'select')).rows
      .filter(row => META_TABLES.includes(row.table_name)).map(row => [row.table_name, row.data_type])) },
];

describe.each(targets)('account migrations on $name', target => {
  it.skipIf(target.skip)('apply, keep meta as JSON, and revert', async () => {
    const all = await migrations();
    const orm = database.createORM({ adapter: await target.open(), entities: [] });
    try {
      await orm.run(async () => {
        const runner = new database.MigrationRunner(orm, all);
        // A run that stopped half way leaves tables behind: start from none.
        if ((await runner.status()).some(row => row.state !== 'pending')) await runner.down({ count: all.length });
        expect((await runner.up()).length).toBe(all.length);
        expect(await target.types(orm)).toEqual(Object.fromEntries(META_TABLES.map(table => [table, target.json])));
        await orm.executeFragment(orm.sql.fragment`INSERT INTO users (id, email, meta, created_at) VALUES (${'u1'}, ${'ada@example.com'}, ${JSON.stringify({ plan: 'pro', seats: 3 })}, ${'2026-01-01T00:00:00.000Z'})`, 'insert');
        const row = (await orm.executeFragment(orm.sql.unsafe("SELECT meta, status, network_admin FROM users WHERE id = 'u1'"), 'select')).rows[0];
        expect(typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta).toEqual({ plan: 'pro', seats: 3 });
        expect(row.status).toBe('active');
        expect(await runner.down({ count: all.length })).toHaveLength(all.length);
      });
    } finally { await orm.close(); }
  }, 120_000);
});
