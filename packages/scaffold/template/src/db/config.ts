import { createDatabase, type DbClient } from '@cossackframework/database';

/**
 * Build a per-request Kysely client from the D1 binding.
 * Used by src/middlewares/db.ts which is registered in src/bootstrap/middlewares.ts.
 */
export function createClient(env: { DB: D1Database }): DbClient {
  return createDatabase({ dialect: 'd1', binding: env.DB });
}
