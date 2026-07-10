// src/cache-store.ts
//
// Database-backed cache store. Mirrors `session-store.ts` (DB-backed key/value
// storage with TTL) but for general-purpose cache data instead of per-session
// bags.
//
// This package intentionally does NOT depend on @cossackframework/framework
// (see the note in session-store.ts). So instead of importing the `CacheStore`
// interface from the framework, we declare a structurally-compatible local
// interface (`CacheStoreLike`). TypeScript's structural typing means a
// `DatabaseCacheStore` is assignable to the framework's `CacheStore` at the
// call site —
//
//   import { extendCacheDriver } from '@cossackframework/framework/cache';
//   import { DatabaseCacheStore } from '@cossackframework/database';
//   extendCacheDriver('database', () => new DatabaseCacheStore()); // ✓
//
// Register it once at startup. The store resolves the per-request `db()` client
// lazily on each operation, so a single instance serves every request. See
// docs/cache.md.
//
// Expected schema (shipped via `cossack cache:make-table`):
//   create table cache_items (
//     key         text primary key not null,
//     value       text not null,             -- JSON
//     expires_at  integer,                   -- epoch ms; null = never
//     updated_at  integer not null
//   );
//   create index cache_items_expires_at_index on cache_items (expires_at);

import type { DbClient } from './types';
import { db } from './store';

/** `cache_items` table row shape (snake_case to match the migration). */
export interface CacheItemRow {
    key: string;
    value: string;
    /** Epoch-millis expiry, or null for "never expires". */
    expires_at: number | null;
    /** Epoch-millis of the last write. */
    updated_at: number;
}

// Augment the Database interface so `selectFrom('cache_items')` is typed.
declare module './types' {
    interface Database {
        cache_items: CacheItemRow;
    }
}

/**
 * A local `CacheStore`-compatible interface, declared locally so this package
 * stays free of a framework dependency. Structurally identical to
 * `@cossackframework/framework/cache`'s `CacheStore`, so a `DatabaseCacheStore`
 * is assignable wherever a `CacheStore` is expected.
 */
export interface CacheStoreLike {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    flush(): Promise<void>;
    getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
    setMany<T = unknown>(
        entries: { key: string; value: T; ttlSeconds?: number }[],
    ): Promise<void>;
    deleteMany(keys: string[]): Promise<void>;
}

function expiryFromTtl(ttlSeconds?: number): number | null {
    if (ttlSeconds === undefined) return null;
    return Date.now() + Math.max(0, ttlSeconds) * 1000;
}

function isExpired(expiresAt: number | null): boolean {
    return expiresAt !== null && Date.now() >= expiresAt;
}

/**
 * Database-backed cache store. Each operation resolves the per-request `db()`
 * Kysely client from the database ALS scope (so it shares the same D1/Turso
 * connection as the rest of your app), unless you pass an explicit client for
 * scripts/tests.
 *
 * TTLs are in **seconds** (matching the rest of the cache API). Values are
 * stored as JSON text. Expired rows are reaped lazily on read and via
 * {@link DatabaseCacheStore.purgeExpired}.
 *
 * The client is resolved **lazily per operation** (not at construction), so a
 * single `DatabaseCacheStore()` instance works for every request. Register it
 * as a cache driver from your `src/index.ts` (or any server-only module loaded
 * at startup), then declare `database` as a store in `config/cache.ts`:
 *
 * @example
 * ```ts
 * // src/index.ts (or any startup module)
 * import { extendCacheDriver } from '@cossackframework/framework/cache';
 * import { DatabaseCacheStore } from '@cossackframework/database';
 *
 * // Register once — DatabaseCacheStore resolves `db()` per request.
 * extendCacheDriver('database', () => new DatabaseCacheStore());
 * ```
 *
 * ```ts
 * // src/config/cache.ts — declare the store
 * export default ({ env }) => ({
 *   default: 'database',
 *   stores: { database: { driver: 'database' } },
 * });
 * ```
 *
 * Requires the `cache_items` table — run `cossack cache:make-table` then
 * `cossack migration up`.
 */
export class DatabaseCacheStore implements CacheStoreLike {
    /**
     * @param client Optional explicit Kysely client. When omitted, each
     *   operation resolves the per-request client via `db()` — the one scoped
     *   by the database middleware. Registering one `DatabaseCacheStore()`
     *   globally (e.g. next to your db middleware) then works for every request,
     *   because `db()` picks up each request's client from AsyncLocalStorage.
     *   Pass an explicit client only for scripts/tests outside a request scope.
     */
    constructor(private readonly explicitClient?: DbClient) {}

    /** Resolve the active client — explicit, else the per-request `db()`. */
    private client(): DbClient {
        return this.explicitClient ?? db();
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        const c = this.client();
        const row = await c
            .selectFrom('cache_items')
            .select(['value', 'expires_at'])
            .where('key', '=', key)
            .executeTakeFirst();
        if (!row) return undefined;
        if (isExpired(row.expires_at as number | null)) {
            await c.deleteFrom('cache_items').where('key', '=', key).execute();
            return undefined;
        }
        try {
            return JSON.parse(row.value as string) as T;
        } catch {
            await c.deleteFrom('cache_items').where('key', '=', key).execute();
            return undefined;
        }
    }

    async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const c = this.client();
        if (value === undefined) {
            await c.deleteFrom('cache_items').where('key', '=', key).execute();
            return;
        }
        // Compute once — both the insert values and the onConflict update use these.
        const json = JSON.stringify(value);
        const expiresAt = expiryFromTtl(ttlSeconds);
        const now = Date.now();
        await c
            .insertInto('cache_items')
            .values({
                key,
                value: json,
                expires_at: expiresAt,
                updated_at: now,
            })
            .onConflict((oc) =>
                oc.column('key').doUpdateSet({
                    value: json,
                    expires_at: expiresAt,
                    updated_at: now,
                }),
            )
            .execute();
    }

    async has(key: string): Promise<boolean> {
        const c = this.client();
        const row = await c
            .selectFrom('cache_items')
            .select('expires_at')
            .where('key', '=', key)
            .executeTakeFirst();
        if (!row) return false;
        if (isExpired(row.expires_at as number | null)) {
            await c.deleteFrom('cache_items').where('key', '=', key).execute();
            return false;
        }
        return true;
    }

    async delete(key: string): Promise<void> {
        await this.client().deleteFrom('cache_items').where('key', '=', key).execute();
    }

    async flush(): Promise<void> {
        await this.client().deleteFrom('cache_items').execute();
    }

    async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        if (keys.length === 0) return [];
        const c = this.client();
        const rows = await c
            .selectFrom('cache_items')
            .select(['key', 'value', 'expires_at'])
            .where('key', 'in', keys)
            .execute();
        const byKey = new Map<string, { value: string; expires_at: number | null }>();
        const expiredKeys: string[] = [];
        for (const r of rows) {
            byKey.set(r.key, { value: r.value, expires_at: r.expires_at as number | null });
            if (isExpired(r.expires_at as number | null)) expiredKeys.push(r.key);
        }
        if (expiredKeys.length > 0) {
            await c.deleteFrom('cache_items').where('key', 'in', expiredKeys).execute();
            for (const k of expiredKeys) byKey.delete(k);
        }
        const corruptKeys: string[] = [];
        const out = keys.map((k) => {
            const entry = byKey.get(k);
            if (!entry) return undefined;
            try {
                return JSON.parse(entry.value) as T;
            } catch {
                corruptKeys.push(k);
                return undefined;
            }
        });
        if (corruptKeys.length > 0) {
            await c.deleteFrom('cache_items').where('key', 'in', corruptKeys).execute();
        }
        return out;
    }

    async setMany<T = unknown>(
        entries: { key: string; value: T; ttlSeconds?: number }[],
    ): Promise<void> {
        if (entries.length === 0) return;
        const c = this.client();
        const now = Date.now();
        const inserts = entries
            .filter((e) => e.value !== undefined)
            .map((e) => ({
                key: e.key,
                value: JSON.stringify(e.value),
                expires_at: expiryFromTtl(e.ttlSeconds),
                updated_at: now,
            }));
        if (inserts.length > 0) {
            await c
                .insertInto('cache_items')
                .values(inserts)
                .onConflict((oc) =>
                    oc.column('key').doUpdateSet({
                        value: (ov: any) => ov.ref('excluded.value'),
                        expires_at: (ov: any) => ov.ref('excluded.expires_at'),
                        updated_at: (ov: any) => ov.ref('excluded.updated_at'),
                    }),
                )
                .execute();
        }
        const deletes = entries.filter((e) => e.value === undefined).map((e) => e.key);
        if (deletes.length > 0) {
            await c.deleteFrom('cache_items').where('key', 'in', deletes).execute();
        }
    }

    async deleteMany(keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        await this.client().deleteFrom('cache_items').where('key', 'in', keys).execute();
    }

    /** Delete all expired rows. Call opportunistically (e.g. on a sample of requests). */
    async purgeExpired(): Promise<number> {
        const now = Date.now();
        const result = await this.client()
            .deleteFrom('cache_items')
            .where('expires_at', 'is not', null)
            .where('expires_at', '<', now)
            .executeTakeFirst();
        return Number(result?.numDeletedRows ?? 0);
    }
}
