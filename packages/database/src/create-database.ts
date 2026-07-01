// src/create-database.ts
import { Kysely } from 'kysely';
import { D1Dialect } from './dialects/d1';
import { LibsqlDialect } from './dialects/libsql';
import type { Database, D1Config, DbClient, LibsqlConfig } from './types';

/**
 * Creates a {@link DbClient} (a typed Kysely instance) for the configured
 * dialect.
 *
 * - **D1**: pass the Cloudflare binding.
 * - **libSQL / Turso**: pass a client created from `@tursodatabase/serverless/compat`
 *   (recommended) or `@libsql/client/web`.
 *
 * ```ts
 * // Cloudflare D1
 * const db = createDatabase({ dialect: 'd1', binding: env.DB })
 *
 * // Turso
 * import { createClient } from '@tursodatabase/serverless/compat'
 * const db = createDatabase({
 *   dialect: 'libsql',
 *   client: createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN }),
 * })
 * ```
 */
export function createDatabase(config: D1Config | LibsqlConfig): DbClient;
export function createDatabase(config: D1Config): DbClient;
export function createDatabase(config: LibsqlConfig): DbClient;
export function createDatabase(config: D1Config | LibsqlConfig): DbClient {
    const dialect =
        config.dialect === 'd1'
            ? new D1Dialect(config.binding)
            : new LibsqlDialect(config.client);
    return new Kysely<Database>({ dialect });
}
