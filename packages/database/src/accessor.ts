// src/accessor.ts
import type { Context } from 'hono';
import type { DbClient } from './types';

/**
 * Returns the per-request {@link DbClient} from the Hono context (`c.get('db')`),
 * set by the database middleware.
 *
 * ```ts
 * export default async (c: Context) => {
 *   const users = await getDb(c).selectFrom('users').selectAll().execute()
 *   return c.json(users)
 * }
 * ```
 *
 * Throws if the database middleware isn't registered.
 */
export function getDb(c: Context): DbClient {
    const client = (c as any).get('db') as DbClient | undefined;
    if (!client) {
        throw new Error(
            '[Cossack] No database client on the request context. ' +
                'Register the database middleware (createDbMiddleware) on your app.',
        );
    }
    return client;
}
