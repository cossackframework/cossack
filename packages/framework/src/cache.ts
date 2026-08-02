// src/cache.ts
//
// Server-side cache, inspired by Laravel's cache system. A pluggable store
// interface with memory / KV / Durable Object drivers, driven by a Laravel-style
// config file (`src/config/cache.ts`). The `cache` facade resolves the default
// store per-request from the config system (`config('cache.default')`), while
// store instances are memoized per-isolate (bindings are stable per deployment).
//
// Lives in `@cossackframework/framework` (not core) because it needs direct
// access to the config system, which is framework-owned. Bindings (KV/DO
// namespaces) are resolved from the request env via `getRequestContext().env`
// (the core injection point the framework wires once at startup).
//
// TTLs are expressed in **seconds** throughout (Laravel-compatible). KV's native
// `expirationTtl` is also seconds, so it maps directly.

import { getRequestContext } from '@cossackframework/core';
import { config } from './config.js';

/** Default in-memory store size before lazy pruning kicks in. */
const DEFAULT_MAX_ENTRIES = 10_000;

/** Default TTL (seconds) when none is given to `set` / `remember`. */
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/**
 * Pluggable cache storage backend. Implement this to back the cache with
 * anything — Cloudflare KV, a Durable Object, D1, Redis, etc. Register an
 * instance via {@link CacheManager.extend} or declare it in `config/cache.ts`.
 *
 * Values are stored as-is by the built-in stores (JSON-serialized for the
 * persistent backends). Implementations must treat `undefined` as "absent" —
 * `set(key, undefined)` is equivalent to `delete(key)`.
 */
export interface CacheStore {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    flush(): Promise<void>;
    getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
    setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void>;
    deleteMany(keys: string[]): Promise<void>;
}

/** A single write in a `setMany` batch. */
export interface CacheEntry<T = unknown> {
    key: string;
    value: T;
    ttlSeconds?: number;
}

// ---------------------------------------------------------------------------
// In-memory store (default)
// ---------------------------------------------------------------------------

interface MemoryEntry {
    raw: string;
    expiresAt?: number;
}

/**
 * Simple in-process cache backed by a `Map`. Entries are pruned lazily once the
 * store grows beyond `maxEntries` (default 10 000).
 *
 * Per-process — a single Node.js instance or one Workers isolate. Not shared
 * across instances or regions. For shared/global cache data, use a KV, Durable
 * Object, or database store.
 */
export class InMemoryCacheStore implements CacheStore {
    private readonly entries = new Map<string, MemoryEntry>();
    private readonly maxEntries: number;

    constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
        this.maxEntries = maxEntries;
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        this.pruneIfLarge();
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (isExpired(entry.expiresAt)) {
            this.entries.delete(key);
            return undefined;
        }
        try {
            return JSON.parse(entry.raw) as T;
        } catch {
            this.entries.delete(key);
            return undefined;
        }
    }

    async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        if (value === undefined) {
            this.entries.delete(key);
            return;
        }
        this.entries.set(key, {
            raw: JSON.stringify(value),
            expiresAt: expiryMs(ttlSeconds),
        });
        this.pruneIfLarge();
    }

    async has(key: string): Promise<boolean> {
        const entry = this.entries.get(key);
        if (!entry) return false;
        if (isExpired(entry.expiresAt)) {
            this.entries.delete(key);
            return false;
        }
        return true;
    }

    async delete(key: string): Promise<void> {
        this.entries.delete(key);
    }

    async flush(): Promise<void> {
        this.entries.clear();
    }

    async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        return Promise.all(keys.map((k) => this.get<T>(k)));
    }

    async setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void> {
        for (const { key, value, ttlSeconds } of entries) {
            await this.set(key, value, ttlSeconds);
        }
    }

    async deleteMany(keys: string[]): Promise<void> {
        for (const k of keys) this.entries.delete(k);
    }

    private pruneIfLarge(): void {
        if (this.entries.size <= this.maxEntries) return;
        const now = Date.now();
        for (const [k, v] of this.entries) {
            if (isExpired(v.expiresAt)) this.entries.delete(k);
        }
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function expiryMs(ttlSeconds?: number): number | undefined {
    if (ttlSeconds === undefined) return undefined;
    return Date.now() + Math.max(0, ttlSeconds) * 1000;
}

function isExpired(expiresAt?: number): boolean {
    return expiresAt !== undefined && Date.now() >= expiresAt;
}

// ---------------------------------------------------------------------------
// KV store (eventually consistent)
// ---------------------------------------------------------------------------

/**
 * Structural subset of Cloudflare's `KVNamespace` (the methods we use). Declared
 * locally so the store doesn't depend on generated types; a real `KVNamespace`
 * binding is structurally compatible and can be passed directly.
 */
export interface CacheKvNamespace {
    get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<unknown>;
    put(key: string, value: string, options?: { expirationTtl?: number; expirationTime?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    getMany?(
        keys: string[],
        options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' },
    ): Promise<unknown[]>;
    deleteMany?(keys: string[]): Promise<void>;
}

export interface KvCacheStoreOptions {
    /** Prefix for KV keys. Default `'cossack:cache:'`. */
    namespace?: string;
}

/**
 * Cache store backed by Cloudflare KV (or any KV-like namespace).
 *
 * Values are stored as JSON. Expiry leans on KV's native `expirationTtl`, so
 * expired keys are garbage-collected by KV automatically — there is no
 * unbounded growth.
 *
 * > **Eventually consistent.** KV writes take up to ~60s to propagate globally,
 * > and there is no atomic read-modify-write. Fine for most cache use cases; if
 * > you need strict consistency, use a Durable Object store instead.
 */
export class KvCacheStore implements CacheStore {
    private readonly namespace: string;

    constructor(
        private readonly kv: CacheKvNamespace,
        options: KvCacheStoreOptions = {},
    ) {
        this.namespace = options.namespace ?? 'cossack:cache:';
    }

    private k(key: string): string {
        return `${this.namespace}${key}`;
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        const raw = (await this.kv.get(this.k(key), { type: 'text' })) as string | null;
        if (raw === null || raw === undefined) return undefined;
        try {
            return JSON.parse(raw) as T;
        } catch {
            await this.kv.delete(this.k(key));
            return undefined;
        }
    }

    async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const kvKey = this.k(key);
        if (value === undefined) {
            await this.kv.delete(kvKey);
            return;
        }
        const options: { expirationTtl?: number } = {};
        if (ttlSeconds !== undefined) {
            // KV requires a minimum TTL of 60s.
            options.expirationTtl = Math.max(60, Math.ceil(ttlSeconds));
        }
        await this.kv.put(kvKey, JSON.stringify(value), options);
    }

    async has(key: string): Promise<boolean> {
        const raw = (await this.kv.get(this.k(key), { type: 'text' })) as string | null;
        return raw !== null && raw !== undefined;
    }

    async delete(key: string): Promise<void> {
        await this.kv.delete(this.k(key));
    }

    async flush(): Promise<void> {
        throw new Error(
            '[Cossack] KvCacheStore.flush() is not supported — Cloudflare KV has no bulk-delete-by-prefix. ' +
                'Use a namespaced binding and recreate the namespace to clear it, or track keys explicitly.',
        );
    }

    async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        if (typeof this.kv.getMany === 'function') {
            const kvKeys = keys.map((k) => this.k(k));
            const raws = (await this.kv.getMany(kvKeys, { type: 'text' })) as (
                | string
                | null
                | undefined
            )[];
            return Promise.all(
                raws.map(async (raw, i) => {
                    if (raw === null || raw === undefined) return undefined;
                    try {
                        return JSON.parse(raw) as T;
                    } catch {
                        // Corrupt value — delete it so it doesn't keep failing.
                        await this.kv.delete(kvKeys[i]);
                        return undefined;
                    }
                }),
            );
        }
        return Promise.all(keys.map((k) => this.get<T>(k)));
    }

    async setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void> {
        await Promise.all(entries.map((e) => this.set(e.key, e.value, e.ttlSeconds)));
    }

    async deleteMany(keys: string[]): Promise<void> {
        if (typeof this.kv.deleteMany === 'function') {
            await this.kv.deleteMany(keys.map((k) => this.k(k)));
            return;
        }
        await Promise.all(keys.map((k) => this.delete(k)));
    }
}

// ---------------------------------------------------------------------------
// Durable Object store (strongly consistent)
// ---------------------------------------------------------------------------

/**
 * Structural subset of Cloudflare's `DurableObjectNamespace` (the methods we
 * use). Declared locally so the store doesn't depend on generated types.
 */
export interface CacheDurableObjectNamespace {
    idFromName(name: string): unknown;
    idFromString(id: string): unknown;
    get(
        id: unknown,
        options?: { locationHint?: string },
    ): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

/**
 * Durable Object holding the cache. **One instance holds the entire cache** —
 * the store routes every key to the same DO (`idFromName('default')`). Uses DO
 * transactional storage (`state.storage`) so entries persist across eviction.
 *
 * @example wrangler.jsonc
 * ```jsonc
 * {
 *   "durable_objects": {
 *     "bindings": [{ "name": "CACHE_DO", "class_name": "CacheDurableObject" }]
 *   },
 *   "migrations": [{ "tag": "v1", "new_sqlite_classes": ["CacheDurableObject"] }]
 * }
 * ```
 */
export class CacheDurableObject {
    state: DurableObjectState;
    env: any;

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = decodeURIComponent(url.pathname.replace(/^\//, ''));

        try {
            // Special-case RPC endpoints (POST only). These are matched on
            // method + path so they never collide with cache keys — e.g. a key
            // named "flush" is still GET/PUT/DELETE-able as a normal key.
            if (request.method === 'POST') {
                switch (path) {
                    case 'has': {
                        const keys = (await request.json()) as string[];
                        const results = await Promise.all(keys.map((k) => this.exists(k)));
                        return Response.json(results);
                    }
                    case 'get-many': {
                        const keys = (await request.json()) as string[];
                        const values = await Promise.all(keys.map((k) => this.read(k)));
                        return Response.json(values);
                    }
                    case 'set-many': {
                        const entries = (await request.json()) as {
                            key: string;
                            value: unknown;
                            ttlSeconds?: number;
                        }[];
                        await Promise.all(
                            entries.map((e) => this.write(e.key, e.value, e.ttlSeconds)),
                        );
                        return Response.json({ ok: true });
                    }
                    case 'delete-many': {
                        const keys = (await request.json()) as string[];
                        await Promise.all(keys.map((k) => this.state.storage.delete(k)));
                        return Response.json({ ok: true });
                    }
                    case 'flush': {
                        await this.state.storage.deleteAll();
                        return Response.json({ ok: true });
                    }
                }
            }

            if (path === '') {
                return new Response('Cossack CacheDurableObject', { status: 200 });
            }

            // Key-level REST: /<key>
            switch (request.method) {
                case 'GET': {
                    const value = await this.read(path);
                    if (value === null) return new Response(null, { status: 404 });
                    return Response.json(value);
                }
                case 'PUT': {
                    const ttlSeconds = url.searchParams.has('ttl')
                        ? Number(url.searchParams.get('ttl'))
                        : undefined;
                    const value = await request.json();
                    await this.write(path, value, ttlSeconds);
                    return Response.json({ ok: true });
                }
                case 'DELETE': {
                    await this.state.storage.delete(path);
                    return Response.json({ ok: true });
                }
                default:
                    return new Response('Method Not Allowed', { status: 405 });
            }
        } catch (err) {
            return Response.json(
                { error: err instanceof Error ? err.message : String(err) },
                { status: 500 },
            );
        }
    }

    private async read(key: string): Promise<unknown> {
        const entry = (await this.state.storage.get<{ value: unknown; expiresAt?: number }>(key));
        if (!entry) return null;
        if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
            await this.state.storage.delete(key);
            return null;
        }
        return entry.value;
    }

    private async exists(key: string): Promise<boolean> {
        return (await this.read(key)) !== null;
    }

    private async write(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
        if (value === undefined) {
            await this.state.storage.delete(key);
            return;
        }
        await this.state.storage.put(key, {
            value,
            expiresAt: expiryMs(ttlSeconds),
        });
    }
}

/**
 * Strongly-consistent cache store backed by a {@link CacheDurableObject}.
 * Every key is served by a single DO instance, so writes are linearized.
 */
export class DurableObjectCacheStore implements CacheStore {
    private readonly stub: ReturnType<CacheDurableObjectNamespace['get']>;

    constructor(ns: CacheDurableObjectNamespace) {
        this.stub = ns.get(ns.idFromName('default'));
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        const res = await this.stub.fetch(`https://cache/${encodeURIComponent(key)}`);
        if (res.status === 404) return undefined;
        if (!res.ok) throw new Error(`[Cossack] CacheDurableObject GET returned ${res.status}`);
        return (await res.json()) as T;
    }

    async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        const url = `https://cache/${encodeURIComponent(key)}`;
        // set(key, undefined) === delete(key) — the CacheStore contract. Must
        // short-circuit here because JSON.stringify(undefined) produces no body,
        // which would break request.json() in the DO handler.
        if (value === undefined) {
            const res = await this.stub.fetch(url, { method: 'DELETE' });
            await res.body?.cancel();
            if (!res.ok) throw new Error(`[Cossack] CacheDurableObject DELETE returned ${res.status}`);
            return;
        }
        const fullUrl = ttlSeconds !== undefined ? `${url}?ttl=${ttlSeconds}` : url;
        const res = await this.stub.fetch(fullUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value),
        });
        if (!res.ok) throw new Error(`[Cossack] CacheDurableObject PUT returned ${res.status}`);
    }

    async has(key: string): Promise<boolean> {
        const res = await this.stub.fetch(`https://cache/${encodeURIComponent(key)}`);
        // Drain the body so the DO-stub connection doesn't linger until GC.
        await res.body?.cancel();
        if (res.status === 404) return false;
        if (!res.ok) throw new Error(`[Cossack] CacheDurableObject HAS returned ${res.status}`);
        return true;
    }

    async delete(key: string): Promise<void> {
        const res = await this.stub.fetch(`https://cache/${encodeURIComponent(key)}`, {
            method: 'DELETE',
        });
        await res.body?.cancel();
        if (!res.ok) throw new Error(`[Cossack] CacheDurableObject DELETE returned ${res.status}`);
    }

    async flush(): Promise<void> {
        const res = await this.stub.fetch('https://cache/flush', { method: 'POST' });
        await res.body?.cancel();
        if (!res.ok) throw new Error(`[Cossack] CacheDurableObject flush returned ${res.status}`);
    }

    async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        const res = await this.stub.fetch('https://cache/get-many', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keys),
        });
        if (!res.ok) throw new Error(`[Cossack] CacheDurableObject get-many returned ${res.status}`);
        const values = (await res.json()) as (T | null)[];
        return values.map((v) => (v === null ? undefined : v));
    }

    async setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void> {
        const res = await this.stub.fetch('https://cache/set-many', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entries),
        });
        if (!res.ok) throw new Error(`[Cossack] CacheDurableObject set-many returned ${res.status}`);
    }

    async deleteMany(keys: string[]): Promise<void> {
        const res = await this.stub.fetch('https://cache/delete-many', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keys),
        });
        if (!res.ok) throw new Error(`[Cossack] CacheDurableObject delete-many returned ${res.status}`);
    }
}

// ---------------------------------------------------------------------------
// Store spec (config-driven store declarations)
// ---------------------------------------------------------------------------

/**
 * A cache store declared in `config/cache.ts`. The `driver` names which built-in
 * store to build; `binding` names a Worker binding (resolved from the request
 * env) for KV/DO stores. Unknown options are passed through to the store.
 */
export interface CacheStoreSpec {
    driver: 'memory' | 'kv' | 'durable-object' | 'database' | (string & {});
    /** Name of the Worker binding (KV/DO). Resolved from the request env. */
    binding?: string;
    /** KV key prefix. Default `'cossack:cache:'`. */
    namespace?: string;
    [option: string]: unknown;
}

/** Shape of the `config/cache.ts` file (without the factory wrapper). */
export interface CacheConfig {
    /** Name of the default store (a key in `stores`). */
    default: string;
    /** Named store declarations. */
    stores: Record<string, CacheStoreSpec>;
}

// ---------------------------------------------------------------------------
// CacheManager — per-isolate instance cache + per-request resolution
// ---------------------------------------------------------------------------

/** Factory that builds a {@link CacheStore} from a spec + env bindings. */
export type CacheStoreFactory = (spec: CacheStoreSpec, env: Record<string, any>) => CacheStore;

const driverFactories = new Map<string, CacheStoreFactory>();
const instanceCache = new Map<string, CacheStore>();
let defaultStoreOverride: CacheStore | null = null;

/**
 * Register a custom driver factory (e.g. for the database driver from
 * `@cossackframework/database/cossack`, Redis, or another backend). Once registered,
 * the driver name can be used in `config/cache.ts` store declarations.
 *
 * The default project template registers the `'database'` driver in
 * `src/middlewares/orm.ts`. If you removed that file or use a different
 * database client, register your own store here.
 *
 * @example
 * ```ts
 * import { extendCacheDriver } from '@cossackframework/framework/cache';
 * import { createDatabaseCacheStore } from '@cossackframework/database/cossack';
 * extendCacheDriver('database', () => createDatabaseCacheStore());
 * // or a custom backend:
 * extendCacheDriver('redis', (spec, env) => new RedisCacheStore(env.REDIS));
 * ```
 */
export function extendCacheDriver(driver: string, factory: CacheStoreFactory): void {
    driverFactories.set(driver, factory);
    // Invalidate any cached instance built from a previous factory for this driver.
    for (const key of instanceCache.keys()) {
        if (key.startsWith(`${driver}:`)) instanceCache.delete(key);
    }
}

/** @internal Reset all manager state — tests only. */
export function __resetCacheForTests(): void {
    driverFactories.clear();
    instanceCache.clear();
    defaultStoreOverride = null;
}

/** @internal: register built-in driver factories once. */
function ensureBuiltinDrivers(): void {
    if (driverFactories.has('memory')) return;
    driverFactories.set('memory', () => new InMemoryCacheStore());
    driverFactories.set('kv', (spec, env) => {
        const binding = resolveBinding(spec.binding ?? 'CACHE', env);
        if (!binding) throw missingBindingError(spec.binding ?? 'CACHE', 'kv');
        return new KvCacheStore(binding, spec.namespace ? { namespace: String(spec.namespace) } : {});
    });
    driverFactories.set('durable-object', (spec, env) => {
        const binding = resolveBinding(spec.binding ?? 'CACHE_DO', env);
        if (!binding) throw missingBindingError(spec.binding ?? 'CACHE_DO', 'durable-object');
        return new DurableObjectCacheStore(binding);
    });
    // The 'database' driver is not wired by the framework (which stays free of
    // a database-package dependency). It ships as a default in new projects —
    // `src/middlewares/orm.ts` registers it via `extendCacheDriver('database',
    // () => createDatabaseCacheStore())`.
    // Only set the stub if the user hasn't already registered a real driver.
    if (!driverFactories.has('database')) {
        driverFactories.set('database', () => {
            throw new Error(
                "[Cossack] Cache driver 'database' is not registered. " +
                    "The default project template registers it in src/middlewares/orm.ts — " +
                    'make sure that file is imported from src/bootstrap/middlewares.ts and that ' +
                    "@cossackframework/database is installed. To use a different cache backend, " +
                    "call extendCacheDriver('database', () => yourStore) or change CACHE_DRIVER.",
            );
        });
    }
}

function resolveBinding(name: string, env: Record<string, any>): any {
    return env?.[name];
}

function missingBindingError(binding: string, driver: string): Error {
    return new Error(
        `[Cossack] Cache driver "${driver}" requires a "${binding}" binding, but it was not found in the request env. ` +
            'Add it to wrangler.jsonc (kv_namespaces / durable_objects.bindings).',
    );
}

/**
 * Read `config('cache')` from the active per-request config scope. Returns
 * `undefined` when no config file is present (falls back to in-memory default).
 */
function readCacheConfig(): CacheConfig | undefined {
    const cfg = config('cache');
    if (!cfg || typeof cfg !== 'object') return undefined;
    return cfg as CacheConfig;
}

/**
 * Build (or fetch from cache) the named store. Instances are memoized per
 * isolate keyed by `driver:binding` (bindings are stable per deployment, so
 * reusing instances across requests is safe and efficient).
 */
function resolveNamedStore(name: string): CacheStore {
    const cfg = readCacheConfig();
    const spec = cfg?.stores?.[name];
    if (!spec) {
        throw new Error(
            `[Cossack] Cache store "${name}" is not defined. Declare it under \`stores\` in config/cache.ts. ` +
                (cfg ? `Available stores: ${Object.keys(cfg.stores).join(', ')}.` : 'No cache config found — add src/config/cache.ts.'),
        );
    }
    return buildStore(spec);
}

function buildStore(spec: CacheStoreSpec): CacheStore {
    ensureBuiltinDrivers();
    // Instance-cache key. Covers driver + binding + namespace — the built-in
    // fields that change store behavior — so e.g. two KV stores on the same
    // binding but different prefixes get separate instances. The separator is
    // always present so extendCacheDriver() invalidation (which keys on
    // `${driver}:`) works even for unbound drivers.
    //
    // NOTE: custom drivers that read additional spec fields (e.g. host, region,
    // prefix) are not reflected in this key. Two such stores sharing the same
    // driver/binding/namespace would reuse one instance. Call
    // `cache.setDefaultStore()` to bypass the cache when that matters, or keep
    // each distinct config under a different driver name.
    const cacheKey = `${spec.driver}:${spec.binding ?? ''}:${spec.namespace ?? ''}`;
    const cached = instanceCache.get(cacheKey);
    if (cached) return cached;

    const factory = driverFactories.get(spec.driver);
    if (!factory) {
        throw new Error(
            `[Cossack] Unknown cache driver "${spec.driver}". Registered drivers: ${[...driverFactories.keys()].join(', ')}. ` +
                'Register custom drivers with extendCacheDriver().',
        );
    }
    const env = getRequestContext()?.env as Record<string, any> | undefined;
    const store = factory(spec, env ?? {});
    instanceCache.set(cacheKey, store);
    return store;
}

/**
 * Resolve the default store for the current request. Reads
 * `config('cache.default')` per-request (so per-request config overrides work),
 * falling back to an in-memory store when no config is present.
 */
function resolveDefaultStore(): CacheStore {
    if (defaultStoreOverride) return defaultStoreOverride;
    const cfg = readCacheConfig();
    const defaultName = cfg?.default;
    if (defaultName) return resolveNamedStore(defaultName);
    // No config file → in-memory default (zero-config).
    return buildStore({ driver: 'memory' });
}

// ---------------------------------------------------------------------------
// Per-store facade (bound to one store)
// ---------------------------------------------------------------------------

/** A cache facade bound to a single store (the default, or a named one). */
export interface StoreBoundCache {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    forget(key: string): Promise<void>;
    flush(): Promise<void>;
    getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
    setMany<T = unknown>(entries: CacheEntry<T>[], defaultTtlSeconds?: number): Promise<void>;
    deleteMany(keys: string[]): Promise<void>;
    remember<T>(key: string, ttlSeconds: number, fn: () => T | Promise<T>): Promise<T>;
}

function bindToStore(getStore: () => CacheStore): StoreBoundCache {
    return {
        async get<T = unknown>(key: string): Promise<T | undefined> {
            return getStore().get<T>(key);
        },
        async set<T = unknown>(key: string, value: T, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<void> {
            await getStore().set(key, value, ttlSeconds);
        },
        async has(key: string): Promise<boolean> {
            return getStore().has(key);
        },
        async delete(key: string): Promise<void> {
            await getStore().delete(key);
        },
        async forget(key: string): Promise<void> {
            await getStore().delete(key);
        },
        async flush(): Promise<void> {
            await getStore().flush();
        },
        async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
            return getStore().getMany<T>(keys);
        },
        async setMany<T = unknown>(entries: CacheEntry<T>[], defaultTtlSeconds?: number): Promise<void> {
            const withTtl =
                defaultTtlSeconds === undefined
                    ? entries
                    : entries.map((e) => ({ ...e, ttlSeconds: e.ttlSeconds ?? defaultTtlSeconds }));
            await getStore().setMany(withTtl);
        },
        async deleteMany(keys: string[]): Promise<void> {
            await getStore().deleteMany(keys);
        },
        async remember<T>(key: string, ttlSeconds: number, fn: () => T | Promise<T>): Promise<T> {
            const store = getStore();
            const hit = await store.get<T>(key);
            if (hit !== undefined) return hit;
            const computed = await fn();
            await store.set(key, computed, ttlSeconds);
            return computed;
        },
    };
}

// ---------------------------------------------------------------------------
// `cache` facade
// ---------------------------------------------------------------------------

/**
 * Server-side cache facade, inspired by Laravel's `Cache`. The default store is
 * resolved per-request from `config('cache.default')`; named stores via
 * {@link cache.store}. Register custom/external drivers via
 * {@link extendCacheDriver}.
 *
 * TTLs are in **seconds**.
 *
 * @example
 * ```ts
 * import { cache } from '@cossackframework/framework/cache';
 *
 * await cache.set<User>('user:1', user, 300);          // default store
 * const u = await cache.get<User>('user:1');
 * const settings = await cache.remember('settings', 600, () => loadSettings());
 * await cache.store('kv').set('key', 'value', 60);     // named store
 * ```
 */
export const cache: StoreBoundCache & {
    /** Access a named store declared in `config/cache.ts`. */
    store(name: string): StoreBoundCache;
    /** Override the default store directly (advanced). */
    setDefaultStore(store: CacheStore): void;
} = {
    ...bindToStore(resolveDefaultStore),
    store(name: string): StoreBoundCache {
        return bindToStore(() => resolveNamedStore(name));
    },
    setDefaultStore(store: CacheStore): void {
        defaultStoreOverride = store;
    },
};
