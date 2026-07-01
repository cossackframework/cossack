// src/store.ts
import type { DbClient } from './types';

/**
 * Injected by {@link ensureDbAlsWired} so the global {@link db} helper reads
 * the per-request client from the framework's AsyncLocalStorage scope.
 */
let dbStoreGetter: (() => DbClient | undefined) | null = null;

/** @internal Framework wires the per-request store getter here (once). */
export function setDbStoreGetter(getter: (() => DbClient | undefined) | null): void {
    dbStoreGetter = getter;
}

/**
 * Returns the per-request {@link DbClient}. Must be called inside a request
 * scope (the database middleware wraps every request in `runWithDb`) or inside
 * an explicit `runWithDb(...)` block.
 *
 * Throws if no client is in scope — there is no sensible default database
 * client, so misuse fails loudly instead of silently.
 *
 * ```ts
 * import { db } from '@cossackframework/database'
 *
 * const users = await db().selectFrom('users').selectAll().execute()
 * ```
 */
export function db(): DbClient {
    const client = dbStoreGetter?.();
    if (!client) {
        throw new Error(
            '[Cossack] No database client in scope. `db()` must be called within a ' +
                'request handler (register the database middleware) or inside `runWithDb(...)`.',
        );
    }
    return client;
}
