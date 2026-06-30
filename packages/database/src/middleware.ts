// src/middleware.ts
import type { MiddlewareHandler } from 'hono';
import { ensureDbAlsWired, runWithDb } from './als';
import type { DbClient } from './types';

export interface DbMiddlewareOptions {
    /**
     * The Kysely client to expose on the request, or a factory that builds one
     * per request (e.g. reading a D1 binding off `c.env`).
     *
     * For stateless HTTP clients (Turso) pass a single shared instance.
     * For D1 pass `(c) => createDatabase({ dialect: 'd1', binding: c.env.DB })`.
     */
    client: DbClient | ((c: any) => DbClient | Promise<DbClient>);
}

/**
 * Hono middleware that exposes the database on the request:
 *
 *  - sets `c.set('db', client)` so routes read it via `getDb(c)` / `c.get('db')`,
 *  - wraps the rest of the request in `runWithDb` so the global `db()` helper
 *    resolves to the same per-request client.
 *
 * Register it globally next to your auth/locale middleware.
 *
 * ```ts
 * import { createDbMiddleware, createDatabase } from '@cossackframework/database'
 *
 * app.use('*', createDbMiddleware({
 *   client: (c) => createDatabase({ dialect: 'd1', binding: c.env.DB }),
 * }))
 * ```
 */
export function createDbMiddleware(options: DbMiddlewareOptions): MiddlewareHandler {
    return async (c, next) => {
        ensureDbAlsWired();
        const client =
            typeof options.client === 'function' ? await options.client(c) : options.client;
        (c as any).set('db', client);
        return runWithDb(client, () => next());
    };
}
