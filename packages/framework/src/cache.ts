// src/cache.ts
//
// Server-side cache, inspired by Laravel's cache system. A pluggable store
// interface with memory / KV / Durable Object drivers, driven by a Laravel-style
// config file (`src/config/cache.ts`). The `cache` facade resolves the default
// store per-request from the config system (`config('cache.default')`), while
// built-in stores use binding identity and custom stores belong to their request.
//
// Lives in `@cossackframework/framework` (not core) because it needs direct
// access to the config system, which is framework-owned. Bindings (KV/DO
// namespaces) are resolved from the request env via `getRequestContext().env`
// (the core injection point the framework wires once at startup).
//
// Public TTLs are integer milliseconds. KV retention converts to whole seconds;
// a stored epoch timestamp independently enforces logical cache expiration.

import { getRequestContext } from '@cossackframework/core';
import { config } from './config.js';
import { cacheKey, cacheKeys, cacheExpiry, cacheJson, cacheNamespace, cacheKvKey, prepareCacheEntries, CACHE_MAX_BATCH_BYTES } from './cache-policy.js';

/** Default maximum live entries in an in-memory store. */
const DEFAULT_MAX_ENTRIES = 10_000;

/** Default TTL (milliseconds) when none is given to facade `set`. */
const DEFAULT_TTL_MS = 3_600_000; // 1 hour

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
    set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
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
    ttlMs?: number;
}

// ---------------------------------------------------------------------------
// In-memory store (default)
// ---------------------------------------------------------------------------

interface MemoryEntry {
    raw: string;
    expiresAt?: number;
    bytes: number;
}

/**
 * Simple in-process cache backed by a `Map`. Expired entries are pruned before
 * evicting the least recently used entry at `maxEntries` (default 10 000).
 *
 * Per-process — a single Node.js instance or one Workers isolate. Not shared
 * across instances or regions. For shared/global cache data, use a KV, Durable
 * Object, or database store.
 */
export class InMemoryCacheStore implements CacheStore {
    private readonly entries = new Map<string, MemoryEntry>();
    private readonly maxEntries: number;
    private bytes = 0;

    constructor(maxEntries: number = DEFAULT_MAX_ENTRIES, private readonly maxBytes = 8 * 1024 * 1024) {
        if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000) {
            throw new Error('[Cossack] Cache maxEntries must be an integer between 1 and 100000.');
        }
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) {
            throw new Error('[Cossack] Cache maxBytes must be an integer between 1 and 67108864.');
        }
        this.maxEntries = maxEntries;
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        cacheKey(key);
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (isExpired(entry.expiresAt)) { this.remove(key); return undefined; }
        try {
            const value = JSON.parse(entry.raw) as T;
            // Refresh insertion order for least-recently-used eviction.
            this.entries.delete(key); this.entries.set(key, entry);
            return value;
        } catch { this.remove(key); return undefined; }
    }

    async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
        cacheKey(key);
        const expiresAt = cacheExpiry(ttlMs);
        const raw = cacheJson(value);
        this.write({ key, raw, expiresAt });
    }

    async has(key: string): Promise<boolean> { return (await this.get(key)) !== undefined; }
    async delete(key: string): Promise<void> { cacheKey(key); this.remove(key); }
    async flush(): Promise<void> { this.entries.clear(); this.bytes = 0; }
    async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        cacheKeys(keys); return Promise.all(keys.map(key => this.get<T>(key)));
    }
    async setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void> {
        const prepared = prepareCacheEntries(entries);
        for (const entry of prepared) this.entryBytes(entry);
        for (const entry of prepared) this.write(entry);
    }
    async deleteMany(keys: string[]): Promise<void> {
        cacheKeys(keys); for (const key of keys) this.remove(key);
    }

    private remove(key: string): void {
        const previous = this.entries.get(key);
        if (previous) this.bytes -= previous.bytes ?? 0;
        this.entries.delete(key);
    }

    private entryBytes(entry: { key: string; raw?: string }): number {
        if (entry.raw === undefined) return 0;
        const bytes = new TextEncoder().encode(entry.key).length + new TextEncoder().encode(entry.raw).length;
        if (bytes > this.maxBytes) throw new Error('[Cossack] Cache value exceeds this store maxBytes budget.');
        return bytes;
    }

    private write(entry: { key: string; raw?: string; expiresAt?: number }): void {
        const bytes = this.entryBytes(entry);
        this.remove(entry.key);
        if (entry.raw === undefined || isExpired(entry.expiresAt)) return;
        if (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
            for (const [key, value] of this.entries) if (isExpired(value.expiresAt)) this.remove(key);
            while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) this.remove(this.entries.keys().next().value!);
        }
        this.entries.set(entry.key, { raw: entry.raw, expiresAt: entry.expiresAt, bytes });
        this.bytes += bytes;
    }
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
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;

}

export interface KvCacheStoreOptions {
    /** Framed KV namespace. Default `'cossack:cache:'`. */
    namespace?: string;
}

/**
 * Cache store backed by Cloudflare KV (or any KV-like namespace).
 *
 * Values are JSON envelopes with an expiration timestamp. Native retention
 * is rounded up to whole seconds (minimum 60); reads enforce logical expiry.
 *
 * > **Eventually consistent.** KV reads can be stale across locations,
 * > and there is no atomic read-modify-write. Fine for most cache use cases; if
 * > you need strict consistency, use a Durable Object store instead.
 */
export class KvCacheStore implements CacheStore {
    private readonly namespace: string;

    constructor(private readonly kv: CacheKvNamespace, options: KvCacheStoreOptions = {}) {
        if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function' || typeof kv.delete !== 'function') {
            throw new Error('[Cossack] Invalid KV cache binding.');
        }
        this.namespace = options.namespace === undefined ? 'cossack:cache:' : options.namespace;
        cacheNamespace(this.namespace);
    }

    private k(key: string): string { return cacheKvKey(this.namespace, key); }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        const raw = await this.kv.get(this.k(key), { type: 'text' });
        if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > CACHE_MAX_BATCH_BYTES) return undefined;
        try {
            const entry = JSON.parse(raw);
            if (!entry || typeof entry !== 'object' || entry.version !== 1 || !Object.hasOwn(entry, 'value') ||
                (entry.expiresAt !== undefined && (!Number.isSafeInteger(entry.expiresAt) || entry.expiresAt < 0)) ||
                isExpired(entry.expiresAt)) return undefined;
            return entry.value as T;
        } catch { return undefined; }
        // KV reads may be stale. Never delete based on an expired/corrupt read:
        // a newer write could already exist at the owner. Native retention cleans up.
    }

    async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
        const kvKey = this.k(key);
        const expiresAt = cacheExpiry(ttlMs);
        const raw = cacheJson(value);
        await this.write(kvKey, raw, expiresAt, ttlMs);
    }

    private async write(key: string, raw?: string, expiresAt?: number, ttlMs?: number): Promise<void> {
        if (raw === undefined || isExpired(expiresAt)) { await this.kv.delete(key); return; }
        const options = ttlMs === undefined ? {} : { expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)) };
        await this.kv.put(key, JSON.stringify({ version: 1, value: JSON.parse(raw), expiresAt }), options);
    }

    async has(key: string): Promise<boolean> { return (await this.get(key)) !== undefined; }
    async delete(key: string): Promise<void> { await this.kv.delete(this.k(key)); }
    async flush(): Promise<void> {
        throw new Error('[Cossack] KvCacheStore.flush() is not supported: KV has no bulk-delete-by-prefix.');
    }
    async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        cacheKeys(keys);
        // Use the documented single-key API. Optional fake bulk methods are not
        // part of Cloudflare's KV contract and must not change reply semantics.
        for (const key of keys) this.k(key);
        return Promise.all(keys.map(key => this.get<T>(key)));
    }
    async setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void> {
        const prepared = prepareCacheEntries(entries).map(entry => ({ ...entry, key: this.k(entry.key) }));
        await Promise.all(prepared.map(entry => this.write(entry.key, entry.raw, entry.expiresAt, entry.ttlMs)));
    }
    async deleteMany(keys: string[]): Promise<void> {
        cacheKeys(keys); const framed = keys.map(key => this.k(key));
        await Promise.all(framed.map(key => this.kv.delete(key)));
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
    constructor(public state: DurableObjectState, public env: unknown) {}

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        let validated = false;
        try {
            if (request.method === 'POST') {
                switch (url.pathname) {
                    case '/has':
                    case '/get-many': {
                        const keys = await cacheIo(signal => readCacheJson(request.body, signal), request.signal);
                        cacheKeys(keys);
                        validated = true;
                        const values: unknown[] = [];
                        let bytes = 2;
                        for (const key of keys) {
                            const value = await this.read(key);
                            const result = url.pathname === '/has' ? value !== undefined
                                : value === undefined ? { found: false } : { found: true, value };
                            bytes += new TextEncoder().encode(JSON.stringify(result)).length + 1;
                            if (bytes > CACHE_MAX_BATCH_BYTES) throw new Error('Cache batch reply exceeds 2 MiB.');
                            values.push(result);
                        }
                        return Response.json(values);
                    }
                    case '/set-many': {
                        const entries = prepareCacheEntries(await cacheIo(signal => readCacheJson(request.body, signal), request.signal));
                        validated = true;
                        for (const entry of entries) await this.write(entry);
                        return Response.json({ ok: true });
                    }
                    case '/delete-many': {
                        const keys = await cacheIo(signal => readCacheJson(request.body, signal), request.signal);
                        cacheKeys(keys);
                        validated = true;
                        for (const key of keys) await this.state.storage.delete(key);
                        return Response.json({ ok: true });
                    }
                    case '/flush':
                        validated = true;
                        await this.state.storage.deleteAll();
                        return Response.json({ ok: true });
                }
            }
            if (url.pathname !== '/entry' || !url.searchParams.has('key')) return new Response(null, { status: 404 });
            const key = url.searchParams.get('key')!;
            cacheKey(key);
            switch (request.method) {
                case 'GET': {
                    validated = true;
                    const value = await this.read(key);
                    return value === undefined ? new Response(null, { status: 404 }) : Response.json(value);
                }
                case 'PUT': {
                    if (url.searchParams.has('ttl')) throw new Error('Use ttlMs.');
                    const ttlMs = url.searchParams.has('ttlMs') ? Number(url.searchParams.get('ttlMs')) : undefined;
                    if (url.searchParams.get('ttlMs') === '') throw new Error('Invalid ttlMs.');
                    const expiresAt = cacheExpiry(ttlMs);
                    const raw = cacheJson(await cacheIo(signal => readCacheJson(request.body, signal), request.signal));
                    validated = true;
                    await this.write({ key, raw, expiresAt });
                    return Response.json({ ok: true });
                }
                case 'DELETE':
                    validated = true;
                    await this.state.storage.delete(key);
                    return Response.json({ ok: true });
                default: return new Response(null, { status: 405 });
            }
        } catch {
            // Private wire errors never expose payloads, key values, or storage errors.
            return Response.json({ error: validated ? 'Cache storage operation failed.' : 'Cache request failed; check keys, JSON and ttlMs.' }, { status: validated ? 500 : 400 });
        }
    }

    private async read(key: string): Promise<unknown> {
        const entry = await this.state.storage.get<{ value: unknown; expiresAt?: number }>(key);
        if (!entry) return undefined;
        if (isExpired(entry.expiresAt)) {
            await this.state.storage.delete(key);
            return undefined;
        }
        return entry.value;
    }

    private async write(entry: { key: string; raw?: string; expiresAt?: number }): Promise<void> {
        if (entry.raw === undefined || isExpired(entry.expiresAt)) { await this.state.storage.delete(entry.key); return; }
        await this.state.storage.put(entry.key, { value: JSON.parse(entry.raw), expiresAt: entry.expiresAt });
    }
}

/** Strongly consistent storage owned by one Durable Object, with request-owned stubs. */
export class DurableObjectCacheStore implements CacheStore {
    constructor(private readonly ns: CacheDurableObjectNamespace) {
        if (!ns || typeof ns.idFromName !== 'function' || typeof ns.get !== 'function') {
            throw new Error('[Cossack] Invalid Durable Object cache binding.');
        }
    }

    private url(key: string): string {
        cacheKey(key);
        return `https://cache/entry?${new URLSearchParams({ key })}`;
    }

    private async request(path: string, init: RequestInit, operation: string, json: boolean, missing = false): Promise<unknown> {
        return cacheIo(async signal => {
            // Construct a fresh I/O stub in the current request, never in the constructor.
            const pending = Promise.resolve(this.ns.get(this.ns.idFromName('default')).fetch(path, { ...init, signal }));
            void pending.then(response => { if (signal.aborted && response instanceof Response) discardCacheBody(response.body); }, () => {}).catch(() => {});
            const response = await cacheAbortable(pending, signal);
            if (!(response instanceof Response)) throw new Error('[Cossack] Invalid cache provider response.');
            if (missing && response.status === 404) { discardCacheBody(response.body); return undefined; }
            if (!response.ok) {
                discardCacheBody(response.body);
                throw new Error(`[Cossack] CacheDurableObject ${operation} returned ${response.status}`);
            }
            if (!json) { discardCacheBody(response.body); return undefined; }
            return readCacheJson(response.body, signal);
        });
    }

    async get<T = unknown>(key: string): Promise<T | undefined> {
        return await this.request(this.url(key), {}, 'GET', true, true) as T | undefined;
    }
    async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
        let url = this.url(key);
        cacheExpiry(ttlMs);
        const raw = cacheJson(value);
        if (raw === undefined || ttlMs === 0) { await this.delete(key); return; }
        if (ttlMs !== undefined) url += `&ttlMs=${ttlMs}`;
        await this.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: raw }, 'PUT', false);
    }
    async has(key: string): Promise<boolean> {
        cacheKey(key);
        const values = await this.request('https://cache/has', { method: 'POST', body: JSON.stringify([key]) }, 'HAS', true);
        if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'boolean') throw new Error('[Cossack] Invalid cache has reply.');
        return values[0];
    }
    async delete(key: string): Promise<void> { await this.request(this.url(key), { method: 'DELETE' }, 'DELETE', false); }
    async flush(): Promise<void> { await this.request('https://cache/flush', { method: 'POST' }, 'flush', false); }
    async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        cacheKeys(keys);
        const values = await this.request('https://cache/get-many', { method: 'POST', body: JSON.stringify(keys) }, 'get-many', true);
        if (!Array.isArray(values) || values.length !== keys.length || values.some(value => !value || typeof value !== 'object' ||
            typeof value.found !== 'boolean' || (value.found && !Object.hasOwn(value, 'value')))) throw new Error('[Cossack] Invalid cache batch reply.');
        return values.map(value => value.found ? value.value as T : undefined);
    }
    async setMany<T = unknown>(entries: CacheEntry<T>[]): Promise<void> {
        const prepared = prepareCacheEntries(entries).map(entry => ({ key: entry.key,
            value: entry.raw === undefined ? undefined : JSON.parse(entry.raw), ttlMs: entry.ttlMs }));
        const body = JSON.stringify(prepared);
        if (new TextEncoder().encode(body).length > CACHE_MAX_BATCH_BYTES) throw new Error('[Cossack] Cache batch JSON exceeds 2 MiB.');
        await this.request('https://cache/set-many', { method: 'POST', body }, 'set-many', false);
    }
    async deleteMany(keys: string[]): Promise<void> {
        cacheKeys(keys);
        await this.request('https://cache/delete-many', { method: 'POST', body: JSON.stringify(keys) }, 'delete-many', false);
    }
}

function discardCacheBody(body: ReadableStream | null): void {
    if (body) { try { void body.cancel().catch(() => {}); } catch { /* Detached cleanup. */ } }
}

function cacheAbortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('[Cossack] Cache operation aborted or timed out.')); };
        if (signal.aborted) { void pending.catch(() => {}); abort(); return; }
        signal.addEventListener('abort', abort, { once: true });
        void pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
}

async function cacheIo<T>(operation: (signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const caller = callerSignal ?? getRequestContext()?.req?.raw?.signal;
    const abort = () => controller.abort();
    caller?.addEventListener('abort', abort, { once: true });
    if (caller?.aborted) controller.abort();
    const timer = setTimeout(abort, 5000);
    try {
        if (controller.signal.aborted) throw new Error('[Cossack] Cache operation aborted or timed out.');
        return await cacheAbortable(operation(controller.signal), controller.signal);
    } finally { clearTimeout(timer); caller?.removeEventListener('abort', abort); }
}

async function readCacheJson(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): Promise<unknown> {
    if (!body) throw new Error('[Cossack] Cache JSON body is required.');
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    try {
        while (true) {
            const chunk = await cacheAbortable(reader.read(), signal);
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > CACHE_MAX_BATCH_BYTES) throw new Error('[Cossack] Cache JSON exceeds 2 MiB.');
            text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        try { return JSON.parse(text); } catch { throw new Error('[Cossack] Invalid cache JSON reply.'); }
    } finally {
        try { void reader.cancel().catch(() => {}); } catch { /* Detached cleanup. */ }
        try { reader.releaseLock(); } catch { /* Pending producer read owns the lock. */ }
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
    /** Framed KV namespace. Default `'cossack:cache:'`. */
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
// CacheManager — binding-owned built-ins and request-owned custom selections
// ---------------------------------------------------------------------------

/** Factory that builds a {@link CacheStore} from a spec + env bindings. */
export type CacheStoreFactory = (spec: CacheStoreSpec, env: Record<string, any>) => CacheStore;

type Selection = { factory: CacheStoreFactory; specKey: string; envFields: [string, unknown][]; store: CacheStore };
const driverFactories = new Map<string, CacheStoreFactory>();
const builtinFactories = new Map<string, CacheStoreFactory>();
const memoryStores = new Map<string, CacheStore>();
let bindingStores = new WeakMap<object, Map<string, CacheStore>>();
let requestStores = new WeakMap<object, Map<string, Selection>>();
let defaultStoreOverride: CacheStore | null = null;

function cacheConfigError(field: string): Error {
    return new Error(`[Cossack] Invalid cache configuration at ${field}; check config/cache.ts.`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}
function validName(value: unknown): value is string {
    return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value);
}

/** Custom options are bounded JSON data, never credentials in diagnostic output. */
function snapshotSpec(input: unknown): CacheStoreSpec {
    let nodes = 0;
    const visit = (value: unknown, depth: number): unknown => {
        if (++nodes > 4096 || depth > 16) throw cacheConfigError('stores.options');
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (Array.isArray(value)) return Object.freeze(value.map(item => visit(item, depth + 1)));
        if (!isRecord(value)) throw cacheConfigError('stores.options');
        const result: Record<string, unknown> = Object.create(null);
        for (const key of Object.keys(value).sort()) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
            if (!('value' in descriptor)) throw cacheConfigError('stores.options');
            if (descriptor.value === undefined) continue;
            result[key] = visit(descriptor.value, depth + 1);
        }
        return Object.freeze(result);
    };
    if (!isRecord(input)) throw cacheConfigError('stores');
    const spec = visit(input, 0) as CacheStoreSpec;
    if (!validName(spec.driver)) throw cacheConfigError('stores.driver');
    if (spec.binding !== undefined && !validName(spec.binding)) throw cacheConfigError('stores.binding');
    if (spec.namespace !== undefined && (typeof spec.namespace !== 'string' ||
        new TextEncoder().encode(spec.namespace).length > 512)) throw cacheConfigError('stores.namespace');
    if (new TextEncoder().encode(JSON.stringify(spec)).length > 16384) throw cacheConfigError('stores.options');
    return spec;
}

function validateStore(store: CacheStore): CacheStore {
    for (const method of ['get', 'set', 'has', 'delete', 'flush', 'getMany', 'setMany', 'deleteMany'] as const) {
        if (!store || typeof store[method] !== 'function') throw new Error('[Cossack] Invalid cache store: all CacheStore methods are required.');
    }
    return store;
}

/** Register a custom factory. Custom selections belong to the current request. */
export function extendCacheDriver(driver: string, factory: CacheStoreFactory): void {
    if (!validName(driver) || typeof factory !== 'function') throw cacheConfigError('driver factory');
    driverFactories.set(driver, factory);
    // Factory identity in a request selection invalidates only that driver.
}

/** @internal Reset all manager state — tests only. */
export function __resetCacheForTests(): void {
    driverFactories.clear(); builtinFactories.clear(); memoryStores.clear();
    bindingStores = new WeakMap(); requestStores = new WeakMap(); defaultStoreOverride = null;
}

function ensureBuiltinDrivers(): void {
    if (builtinFactories.size === 0) {
        builtinFactories.set('memory', spec => new InMemoryCacheStore(spec.maxEntries as number | undefined, spec.maxBytes as number | undefined));
        builtinFactories.set('kv', (spec, env) => new KvCacheStore(resolveBinding(spec.binding ?? 'CACHE', env, 'kv') as CacheKvNamespace,
            spec.namespace === undefined ? {} : { namespace: spec.namespace }));
        builtinFactories.set('durable-object', (spec, env) => new DurableObjectCacheStore(resolveBinding(spec.binding ?? 'CACHE_DO', env, 'durable-object') as CacheDurableObjectNamespace));
        builtinFactories.set('database', () => { throw new Error(
            "[Cossack] Cache driver 'database' is not registered. Register extendCacheDriver('database', () => createDatabaseCacheStore()) in src/middlewares/orm.ts and import it from src/bootstrap/middlewares.ts."); });
    }
    for (const [driver, factory] of builtinFactories) if (!driverFactories.has(driver)) driverFactories.set(driver, factory);
}

function resolveBinding(name: string, env: Record<string, any>, driver: 'kv' | 'durable-object'): object {
    const binding = env[name];
    const methods = driver === 'kv' ? ['get', 'put', 'delete'] : ['idFromName', 'get'];
    if (!binding || (typeof binding !== 'object' && typeof binding !== 'function') ||
        methods.some(method => typeof binding[method] !== 'function')) throw new Error(
            `[Cossack] Cache driver ${driver} requires a valid ${name} binding in the request env; check wrangler.jsonc.`);
    return binding;
}

/** Only a genuinely absent config selects the process-local default. */
function readCacheConfig(): CacheConfig | undefined {
    const cfg: unknown = config('cache');
    if (cfg === undefined) return undefined;
    if (!isRecord(cfg) || !validName(cfg.default) || !isRecord(cfg.stores)) throw cacheConfigError('cache');
    return cfg as unknown as CacheConfig;
}

function resolveNamedStore(name: string): CacheStore {
    if (!validName(name)) throw cacheConfigError('store name');
    const cfg = readCacheConfig();
    if (!cfg || !Object.hasOwn(cfg.stores, name)) throw new Error(
        '[Cossack] Cache store is not defined. Declare it under stores in config/cache.ts.');
    return buildStore(cfg.stores[name], name);
}

function sameEnv(a: [string, unknown][], b: [string, unknown][]): boolean {
    return a.length === b.length && a.every(([key, value], index) => key === b[index][0] && Object.is(value, b[index][1]));
}

function buildStore(input: CacheStoreSpec, name: string): CacheStore {
    ensureBuiltinDrivers();
    const spec = snapshotSpec(input);
    const factory = driverFactories.get(spec.driver);
    if (!factory) throw new Error('[Cossack] Unknown cache driver in config/cache.ts. Register it with extendCacheDriver().');
    const context = getRequestContext();
    const env = (context?.env ?? {}) as Record<string, any>;
    const specKey = JSON.stringify(spec);
    if (factory === builtinFactories.get(spec.driver) && ['memory', 'kv', 'durable-object'].includes(spec.driver)) {
        let bucket = memoryStores;
        if (spec.driver !== 'memory') {
            // Inspect actual binding and its shape BEFORE reading a memoized store.
            const binding = resolveBinding(spec.binding ?? (spec.driver === 'kv' ? 'CACHE' : 'CACHE_DO'), env, spec.driver as 'kv' | 'durable-object');
            bucket = bindingStores.get(binding) ?? new Map();
            bindingStores.set(binding, bucket);
        }
        const key = JSON.stringify([name, specKey]);
        const cached = bucket.get(key);
        if (cached) return cached;
        if (bucket.size >= 256) throw new Error('[Cossack] Cache configuration exceeds 256 store selections; use stable store declarations.');
        const store = validateStore(factory(spec, env));
        bucket.set(key, store); return store;
    }
    // Custom factories may read every spec field and request binding/credential.
    // Never reuse their constructed store across requests. Same-request mutable
    // selections rebuild; remember() still captures its provider before await.
    const fields = Object.keys(env).sort().map(key => [key, env[key]] as [string, unknown]);
    const bucket = context ? requestStores.get(context) ?? new Map<string, Selection>() : undefined;
    const cached = bucket?.get(name);
    if (cached && cached.factory === factory && cached.specKey === specKey && sameEnv(cached.envFields, fields)) return cached.store;
    const store = validateStore(factory(spec, env));
    if (bucket && context) {
        bucket.set(name, { factory, specKey, envFields: fields, store }); requestStores.set(context, bucket);
    }
    return store;
}

function resolveDefaultStore(): CacheStore {
    if (defaultStoreOverride) return defaultStoreOverride;
    const cfg = readCacheConfig();
    return cfg ? resolveNamedStore(cfg.default) : buildStore({ driver: 'memory' }, '__default');
}

// ---------------------------------------------------------------------------
// Per-store facade (bound to one store)
// ---------------------------------------------------------------------------

/** A cache facade bound to a single store (the default, or a named one). */
export interface StoreBoundCache {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    forget(key: string): Promise<void>;
    flush(): Promise<void>;
    getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
    setMany<T = unknown>(entries: CacheEntry<T>[], defaultTtlMs?: number): Promise<void>;
    deleteMany(keys: string[]): Promise<void>;
    remember<T>(key: string, ttlMs: number, fn: () => T | Promise<T>): Promise<T>;
}

function bindToStore(getStore: () => CacheStore): StoreBoundCache {
    return {
        async get<T = unknown>(key: string): Promise<T | undefined> {
            cacheKey(key);
            return getStore().get<T>(key);
        },
        async set<T = unknown>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
            cacheKey(key); cacheExpiry(ttlMs);
            const raw = cacheJson(value);
            await getStore().set(key, raw === undefined ? undefined : JSON.parse(raw), ttlMs);
        },
        async has(key: string): Promise<boolean> {
            cacheKey(key);
            return getStore().has(key);
        },
        async delete(key: string): Promise<void> {
            cacheKey(key);
            await getStore().delete(key);
        },
        async forget(key: string): Promise<void> {
            cacheKey(key);
            await getStore().delete(key);
        },
        async flush(): Promise<void> {
            await getStore().flush();
        },
        async getMany<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
            cacheKeys(keys);
            return getStore().getMany<T>(keys);
        },
        async setMany<T = unknown>(entries: CacheEntry<T>[], defaultTtlMs?: number): Promise<void> {
            cacheExpiry(defaultTtlMs);
            if (!Array.isArray(entries)) throw new Error('[Cossack] Cache batches require an array.');
            const withTtl =
                defaultTtlMs === undefined
                    ? entries
                    : entries.map((e) => ({ ...e, ttlMs: e.ttlMs === undefined ? defaultTtlMs : e.ttlMs }));
            const prepared = prepareCacheEntries(withTtl);
            await getStore().setMany(prepared.map(entry => ({ key: entry.key, value: entry.raw === undefined ? undefined : JSON.parse(entry.raw), ttlMs: entry.ttlMs })));
        },
        async deleteMany(keys: string[]): Promise<void> {
            cacheKeys(keys);
            await getStore().deleteMany(keys);
        },
        async remember<T>(key: string, ttlMs: number, fn: () => T | Promise<T>): Promise<T> {
            cacheKey(key); cacheExpiry(ttlMs);
            const store = getStore();
            const hit = await store.get<T>(key);
            if (hit !== undefined) return hit;
            const computed = await fn();
            const raw = cacheJson(computed);
            await store.set(key, raw === undefined ? undefined : JSON.parse(raw), ttlMs);
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
 * TTLs are in **milliseconds**.
 *
 * @example
 * ```ts
 * import { cache } from '@cossackframework/framework/cache';
 *
 * await cache.set<User>('user:1', user, 300_000);          // default store
 * const u = await cache.get<User>('user:1');
 * const settings = await cache.remember('settings', 600_000, () => loadSettings());
 * await cache.store('kv').set('key', 'value', 60_000);     // named store
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
        defaultStoreOverride = validateStore(store);
    },
};
