/**
 * Counted attempts: how often something was tried for a key within a window, for the CMS's
 * own limits (a form sent again at once, comments posted too quickly, suggestions, site
 * registrations, recovery). Sign-in's limits are the application's, with its accounts.
 */
import type { RomeDB } from '@cossackframework/romedb';

const WRITE = { kind: 'cms.attempts', retryConflicts: 5 } as const;
const COUNT = { kind: 'cms.attempts', retryConflicts: 20 } as const;

function attemptKey(kind: string, key: string): string {
    return `attempt:${kind}:${key.replace(/[^\x21-\x7e]/g, '-').slice(0, 120)}`;
}

export class CmsAttempts {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /**
     * Count an attempt of `kind` (such as `form`) for a key within a window; false past `max`.
     * A refused attempt keeps the gate shut until the window ends. The database does the
     * counting in one write (an ended window starts again, then a conditional increment), so
     * attempts sent at once are each counted once and no more than `max` are let through.
     */
    async attempt(kind: string, key: string, max: number, windowMs: number): Promise<boolean> {
        const id = attemptKey(kind, key);
        const now = this.#now();
        try {
            const result = await this.#db.write([
                { rql: 'DELETE FROM cms_attempts WHERE key = $key AND until <= $now', params: { $key: id, $now: now } },
                { rql: 'INSERT INTO cms_attempts (key, count, until) VALUES ($key, 0, $until) ON CONFLICT (key) DO NOTHING', params: { $key: id, $until: now + windowMs } },
                { rql: 'UPDATE cms_attempts SET count = count + 1 WHERE key = $key AND count < $max', params: { $key: id, $max: max } },
            ], COUNT);
            return result.results[2]!.affected === 1n;
        } catch (error) {
            // A key under a burst of attempts can keep conflicting past the retries: refuse this
            // attempt, as the limit would, rather than fail the request.
            if ((error as { code?: string }).code === 'RDB_WRITE_CONFLICT') return false;
            throw error;
        }
    }

    /** Give back an attempt `attempt()` counted, for one that did not go ahead after all. */
    async release(kind: string, key: string): Promise<void> {
        try { await this.#db.write([{ rql: 'UPDATE cms_attempts SET count = count - 1 WHERE key = $key AND count > 0', params: { $key: attemptKey(kind, key) } }], COUNT); }
        catch (error) {
            // Under a burst on the same key the attempt stays counted: the limit errs shut.
            if ((error as { code?: string }).code !== 'RDB_WRITE_CONFLICT') throw error;
        }
    }

    /** Forget the counters whose window ended, some at a time. */
    async purge(): Promise<void> {
        const now = this.#now();
        const expired = await this.#db.read([{ rql: 'SELECT 1 FROM cms_attempts WHERE until <= $now LIMIT 1', params: { $now: now } }]);
        if (!expired.results[0]!.rows.length) return;
        await this.#db.write([{ rql: 'DELETE FROM cms_attempts WHERE key IN (SELECT key FROM cms_attempts WHERE until <= $now LIMIT 500)', params: { $now: now } }], WRITE);
    }
}
