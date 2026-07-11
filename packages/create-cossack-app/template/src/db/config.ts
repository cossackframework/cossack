import {
  createDatabase,
  type DbClient,
} from '@cossackframework/database';

/**
 * Build a per-request Kysely client from the D1 binding.
 * Used by src/middlewares/db.ts which is registered in src/bootstrap/middlewares.ts.
 */
export function createClient(env: { DB: D1Database }): DbClient {
  return createDatabase({ dialect: 'd1', binding: env.DB });
}

/**
 * Build a Kysely client for the CLI (migrations & seeders).
 *
 * D1 itself only exists inside a Worker, so for local migration development we
 * open a local SQLite file (same dialect) with better-sqlite3. Install it once:
 *
 *   pnpm add -D better-sqlite3
 *
 * Set D1_LOCAL_PATH to point at your wrangler local D1 file (under
 * .wrangler/state/v3/d1/...) or any scratch path. Defaults to ./local.db.
 *
 * The same migration files run unchanged against D1 in production.
 */
export async function getCliClient(): Promise<DbClient> {
  const localPath = process.env.D1_LOCAL_PATH ?? './local.db';
  const { Kysely, SqliteDialect } = await import('@cossackframework/database');
  const Database = (await import('better-sqlite3')).default;
  return new Kysely({ dialect: new SqliteDialect({ database: new Database(localPath) }) }) as DbClient;
}
