/**
 * Reads that requests share through a per-isolate cache: settings, the site a host names, the
 * activation state, definitions.
 *
 * On Workers a request's database calls end with it (the CMS passes the request's signal to
 * its database; see `requestSignal` in `@cossackframework/romedb`): when its visitor leaves or
 * it fails, a read it started ends with `RDB_CANCELLED`, and so does every request that waits
 * on the same cached read. Those requests did not end, so they read again for themselves.
 */
import { ClientError } from '@cossackframework/romedb';

/** A database call that ended because its signal aborted or its deadline passed. */
export function cancelled(error: unknown): boolean {
    return error instanceof ClientError && error.code === 'RDB_CANCELLED';
}

/**
 * Run a cached read; when it ended with the request that started it, run it once more. The
 * cache must forget a read that failed (a `.catch` it attaches when it starts the read), so the
 * second run starts a new read under this request's own signal.
 */
export async function sharedRead<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (error) {
        if (!cancelled(error)) throw error;
        return read();
    }
}

/** The table a read names does not exist: the site is not set up yet. */
export function missingTable(error: unknown, table: RegExp): boolean {
    return error instanceof ClientError && table.test(error.message) && /no such table|not found|does not exist/i.test(error.message);
}
