/**
 * A cache on RomeDB: JSON values by key with an optional expiry, the same for every isolate and
 * region, for values that are slow to compute and fine to be a little old, such as the media
 * library's summary. The shape is the framework's `CacheStore`; expired rows are read as missing.
 */
import type { RomeDB, Statement, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';

const WRITE = { kind: 'cms.cache', retryConflicts: 5 } as const;
const KEY = /^[\x21-\x7e]{1,200}$/;
/** A stored value's largest JSON. */
const MAX_JSON = 1024 * 1024;

export interface CacheEntry<T = unknown> { readonly key: string; readonly value: T; readonly ttlMs?: number }

export class CmsCache {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        return (await this.getMany<T>([key]))[0];
    }

    async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        const wanted = keys.filter(key => KEY.test(key));
        if (!wanted.length) return keys.map(() => undefined);
        const params: { [name: string]: Value } = Object.fromEntries(wanted.map((key, index) => [`$k${index}`, key]));
        const result = await this.#db.read([{ rql: `SELECT key, value, expires_at FROM cms_cache WHERE key IN (${wanted.map((_, index) => `$k${index}`).join(', ')})`, params }]);
        const now = this.#now();
        const found = new Map<string, T>();
        for (const [key, value, expires] of result.results[0]!.rows) {
            if (expires !== null && Number(expires as bigint) <= now) continue;
            try { found.set(key as string, JSON.parse(value as string) as T); } catch { /* a corrupt row reads as missing */ }
        }
        return keys.map(key => found.get(key));
    }

    async has(key: string): Promise<boolean> {
        return (await this.get(key)) !== undefined;
    }

    /** Store a value for `ttlMs` milliseconds, or until deleted; undefined deletes. */
    async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
        await this.setMany([{ key, value, ...(ttlMs !== undefined ? { ttlMs } : {}) }]);
    }

    async setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void> {
        const now = this.#now();
        const statements = entries.map((entry): Statement => {
            if (!KEY.test(entry.key)) throw new CmsError('CMS_VALIDATION', 'Cache keys are 1-200 printable characters without spaces.');
            if (entry.value === undefined) return { rql: 'DELETE FROM cms_cache WHERE key = $key', params: { $key: entry.key } };
            const json = JSON.stringify(entry.value);
            if (json.length > MAX_JSON) throw new CmsError('CMS_LIMIT', 'The cached value is larger than 1 MB.');
            const expires = entry.ttlMs !== undefined && Number.isFinite(entry.ttlMs) ? now + Math.max(0, entry.ttlMs) : null;
            return { rql: 'INSERT INTO cms_cache (key, value, expires_at) VALUES ($key, $value, $expires) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
                params: { $key: entry.key, $value: json, $expires: expires } };
        });
        if (statements.length) await this.#db.write(statements, WRITE);
    }

    async delete(key: string): Promise<void> {
        await this.deleteMany([key]);
    }

    async deleteMany(keys: string[]): Promise<void> {
        const wanted = keys.filter(key => KEY.test(key));
        if (wanted.length) await this.#db.write(wanted.map(key => ({ rql: 'DELETE FROM cms_cache WHERE key = $key', params: { $key: key } })), WRITE);
    }

    async flush(): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_cache' }], WRITE);
    }

    /** The cached value with the time it was computed, computing and storing it when missing, expired, or `fresh` is asked for. */
    async remember<T>(key: string, ttlMs: number, compute: () => Promise<T>, options: { fresh?: boolean } = {}): Promise<{ value: T; at: number }> {
        if (!options.fresh) {
            const cached = await this.get<{ value: T; at: number }>(key);
            if (cached) return cached;
        }
        const entry = { value: await compute(), at: this.#now() };
        await this.set(key, entry, ttlMs);
        return entry;
    }
}
