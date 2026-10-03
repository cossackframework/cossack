/** Private cache validation. Public durations are integer milliseconds. */
export const CACHE_MAX_KEY_BYTES = 512;
export const CACHE_MAX_VALUE_BYTES = 1024 * 1024;
export const CACHE_MAX_BATCH_ENTRIES = 128;
export const CACHE_MAX_BATCH_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();

export function cacheKey(key: unknown): asserts key is string {
    if (typeof key !== 'string' || key.length === 0 || encoder.encode(key).length > CACHE_MAX_KEY_BYTES ||
        new TextDecoder().decode(encoder.encode(key)) !== key) {
        throw new Error('[Cossack] Cache keys must be nonempty valid UTF-8 strings of at most 512 bytes.');
    }
}

export function cacheExpiry(ttlMs?: number): number | undefined {
    if (ttlMs === undefined) return undefined;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0) {
        throw new Error('[Cossack] Cache ttlMs must be a nonnegative integer with a valid expiration timestamp.');
    }
    const expiresAt = Date.now() + ttlMs;
    if (expiresAt > 8_640_000_000_000_000) {
        throw new Error('[Cossack] Cache ttlMs must be a nonnegative integer with a valid expiration timestamp.');
    }
    return expiresAt;
}

export function cacheJson(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    let raw: string | undefined;
    try { raw = JSON.stringify(value); } catch { /* Report no payload or secret values. */ }
    if (raw === undefined || encoder.encode(raw).length > CACHE_MAX_VALUE_BYTES) {
        throw new Error('[Cossack] Cache values must serialize to JSON of at most 1 MiB.');
    }
    return raw;
}

export function cacheKeys(keys: unknown): asserts keys is string[] {
    if (!Array.isArray(keys) || keys.length > CACHE_MAX_BATCH_ENTRIES) {
        throw new Error('[Cossack] Cache batches accept at most 128 entries.');
    }
    for (const key of keys) cacheKey(key);
}

export type PreparedCacheEntry = { key: string; raw?: string | undefined; expiresAt?: number | undefined; ttlMs?: number | undefined };

/** Snapshot values and validate the entire batch before performing any writes. */
export function prepareCacheEntries(entries: unknown): PreparedCacheEntry[] {
    if (!Array.isArray(entries) || entries.length > CACHE_MAX_BATCH_ENTRIES) {
        throw new Error('[Cossack] Cache batches accept at most 128 entries.');
    }
    let bytes = 0;
    return entries.map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || 'ttlSeconds' in entry) {
            throw new Error('[Cossack] Cache batch entries require key, value and optional ttlMs; ttlSeconds is unsupported.');
        }
        cacheKey(entry.key);
        const expiresAt = cacheExpiry(entry.ttlMs);
        const raw = cacheJson(entry.value);
        bytes += encoder.encode(entry.key).length + (raw === undefined ? 0 : encoder.encode(raw).length) + 128;
        if (bytes > CACHE_MAX_BATCH_BYTES) throw new Error('[Cossack] Cache batch JSON exceeds 2 MiB.');
        return { key: entry.key, raw, expiresAt, ttlMs: entry.ttlMs };
    });
}
