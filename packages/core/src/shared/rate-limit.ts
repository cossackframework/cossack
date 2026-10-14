// src/shared/rate-limit.ts
import './metadata';
import { storageCapabilities, storageRequirements, readStorageCapabilities, assertStorageRequirements, type StorageCapabilities, type StorageRequirements } from './storage-capabilities';
import { assertRateLimitKey as assertKey, rateLimitNamespace, rateLimitStorageKey, redisEndpoint, redisToken } from './rate-limit-policy';
import type { Context } from 'hono';
import { assertRateLimitNotAborted, readRateLimitResponse, runRateLimitOperation, rateLimitTimeout, RATE_LIMIT_RESPONSE_MAX_BYTES, type RateLimitHitOptions } from './rate-limit-io';
export { RATE_LIMIT_RESPONSE_MAX_BYTES, type RateLimitHitOptions } from './rate-limit-io';

export const RATE_LIMIT_METADATA_KEY = 'cossack:rate-limit';

/**
 * Options for a rate limit. All fields are optional.
 *
 * @example
 * ```ts
 * { window: 60_000, max: 10 } // 10 requests per minute per key
 * ```
 */
export interface RateLimitOptions {
    /** Required provider guarantees. Unknown or unsupported traits reject before I/O. */
    requires?: StorageRequirements;
    /**
     * Positive safe-integer fixed-window milliseconds. Default `60_000`.
     */
    window?: number;
    /**
     * Non-negative safe-integer maximum per window/key. Default `60`; zero denies all.
     */
    max?: number;
    /**
     * Function returning the identity bucket to count against. Receives the
     * Hono `Context`. Default: the authenticated user id if present, otherwise
     * the client IP (so anonymous abuse is still bounded).
     */
    key?: (c: Context) => string;
    /**
     * Body of the `429` response. Default `'Too Many Requests'`.
     */
    message?: string;
    /** Counter decision deadline in milliseconds, including body EOF. Default 5000. */
    backendTimeoutMs?: number;
}

/**
 * Pluggable storage backend for rate-limit counters. The default
 * {@link InMemoryRateLimitStore} is per-process and therefore exact only for a
 * single instance (Node.js adapter, a single Durable Object replica, etc.).
 *
 * For multi-instance/edge deployments where a single attacker can land on
 * different instances, provide a shared store via {@link setRateLimitStore}
 * (e.g. backed by Durable Objects, KV, D1, or Upstash). Only `hit` is required.
 */
export interface RateLimitStore {
    readonly capabilities?: StorageCapabilities;
    /**
     * Increment the counter for `key`. If the window has elapsed since the last
     * reset, start a fresh window with count `1`. Must return the current count
     * and the epoch-millis timestamp at which the window resets.
     */
    hit(key: string, windowMs: number, options?: RateLimitHitOptions): Promise<{ count: number; resetAt: number }> | { count: number; resetAt: number };
}

const RATE_LIMIT_COUNTER_KEY = 'cossack:rate-limit:counter';
const MAX_ALARM_TIMESTAMP = 8_640_000_000_000_000;
type RateLimitCounter = { count: number; resetAt: number };

function validWindow(windowMs: number, now: number): boolean {
    return Number.isSafeInteger(windowMs) && windowMs > 0 && windowMs <= MAX_ALARM_TIMESTAMP - now;
}

function assertWindow(windowMs: number): void {
    if (!validWindow(windowMs, Date.now())) {
        throw new Error('[Cossack] Rate-limit window must be positive integer milliseconds within the timestamp range.');
    }
}

function assertRateLimitOptions(options: unknown): asserts options is RateLimitOptions {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
        Object.keys(options).some(key => !['window', 'max', 'key', 'message', 'backendTimeoutMs', 'requires'].includes(key))) {
        throw new Error('[Cossack] Rate-limit options must be an object with window (milliseconds), max, key, message, backendTimeoutMs or requires.');
    }
}

function hasMethod(value: unknown, method: string): boolean {
    return value !== null && (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as Record<string, unknown>)[method] === 'function';
}

function credential(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function readCounter(value: unknown): RateLimitCounter {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('[Cossack] Invalid rate-limit counter returned by storage.');
    }
    const { count, resetAt } = value as Partial<RateLimitCounter>;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0 ||
        typeof resetAt !== 'number' || !Number.isSafeInteger(resetAt) || resetAt <= 0 || resetAt > MAX_ALARM_TIMESTAMP) {
        throw new Error('[Cossack] Invalid rate-limit counter returned by storage.');
    }
    return { count, resetAt };
}

/** Minimum time between full expiry scans of a full in-memory store. */
const MEMORY_PRUNE_INTERVAL_MS = 1000;

/**
 * Simple in-memory fixed-window counter holding at most `maxEntries` buckets
 * (default 10 000). When full, expired buckets are dropped first (from the
 * oldest end, plus a full expiry scan at most once per second), then the
 * buckets whose window started earliest are evicted to admit the new caller.
 * Admitting a caller at capacity is amortized O(1), so a flood of distinct
 * keys cannot turn every insert into a full scan. Eviction forgets those
 * callers' spent quota, so size `maxEntries` above the expected live caller
 * count or use a shared provider for strict limits.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
    readonly capabilities = storageCapabilities('rate-limit', 'memory');
    private readonly entries = new Map<string, { count: number; resetAt: number }>();
    private readonly maxEntries: number;
    private nextPruneAt = 0;

    constructor(maxEntries = 10_000) {
        if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100000) {
            throw new Error('[Cossack] Rate-limit maxEntries must be an integer between 1 and 100000.');
        }
        this.maxEntries = maxEntries;
    }

    hit(key: string, windowMs: number, options: RateLimitHitOptions = {}): { count: number; resetAt: number } {
        assertStorageRequirements(this.capabilities, options.requires);
        assertKey(key); assertWindow(windowMs);
        rateLimitTimeout(options);
        assertRateLimitNotAborted(options.signal);
        const now = Date.now();
        const existing = this.entries.get(key);
        if (!existing || now >= existing.resetAt) {
            if (existing) this.entries.delete(key);
            else if (this.entries.size >= this.maxEntries) {
                // Map order tracks window start, so expired buckets cluster at
                // the head: dropping them there is O(1) per bucket. A full scan
                // (for long windows started before shorter, expired ones) runs
                // opportunistically, at most once per interval.
                for (const [oldest, bucket] of this.entries) {
                    if (now < bucket.resetAt) break;
                    this.entries.delete(oldest);
                }
                if (this.entries.size >= this.maxEntries && now >= this.nextPruneAt) {
                    this.nextPruneAt = now + MEMORY_PRUNE_INTERVAL_MS;
                    this.prune(now);
                }
                // Evict the oldest live windows rather than rejecting new callers:
                // throwing here would let a flood of distinct keys deny service to
                // every rate-limited endpoint until those windows expire.
                for (const oldest of this.entries.keys()) {
                    if (this.entries.size < this.maxEntries) break;
                    this.entries.delete(oldest);
                }
            }
            const resetAt = now + windowMs;
            // Re-insert so Map order tracks window start (oldest first).
            this.entries.set(key, { count: 1, resetAt });
            return { count: 1, resetAt };
        }
        existing.count = readCounter({ count: existing.count + 1, resetAt: existing.resetAt }).count;
        return { count: existing.count, resetAt: existing.resetAt };
    }

    /** Drop every expired entry. Exposed for testing/custom stores. */
    prune(now: number): void {
        for (const [k, v] of this.entries) {
            if (now >= v.resetAt) this.entries.delete(k);
        }
    }
}

/**
 * Structural subset of Cloudflare's `KVNamespace` (the `get`/`put` methods we
 * use). Declared locally so the store doesn't depend on the generated
 * `worker-configuration.d.ts`; a real `KVNamespace` binding is structurally
 * compatible and can be passed directly.
 */
export interface RateLimitKvNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface KvRateLimitStoreOptions {
    /** Prefix for KV keys. Default `'cossack:rl:'`. */
    namespace?: string;
}

/**
 * Rate-limit store backed by Cloudflare KV (or any KV-like namespace). Use it
 * via {@link setRateLimitStore} so limits hold across Worker instances/regions
 * (the default {@link InMemoryRateLimitStore} is per-process).
 *
 * KV storage TTL is rounded to seconds with a 60-second minimum. The stored
 * millisecond deadline controls logical expiry, including shorter windows.
 *
 * @example
 * ```ts
 * import { setRateLimitStore, KvRateLimitStore, type RateLimitKvNamespace } from '@cossackframework/core';
 *
 * // Call once during setup for a process with one fixed binding.
 * export function configureLimiter(bindings: { RATE_LIMITS: RateLimitKvNamespace }) {
 *   setRateLimitStore(new KvRateLimitStore(bindings.RATE_LIMITS));
 * }
 * ```
 *
 * > **Caveat — approximate, not exact.** KV is *eventually consistent* and has
 * > no atomic increment, so a concurrent burst from the same caller can
 * > under-count (two reads see the old value before either write lands). In
 * > There is no strict bound on under-counting across regions. KV also limits
 * > writes to one per key per second; write failures reject the action. For
 * > burst traffic or strict limits, use Durable Objects or Redis.
 */
export class KvRateLimitStore implements RateLimitStore {
    readonly capabilities = storageCapabilities('rate-limit', 'kv');
    private readonly namespace: string;

    constructor(
        private readonly kv: RateLimitKvNamespace,
        options: KvRateLimitStoreOptions = {},
    ) {
        if (!hasMethod(kv, 'get') || !hasMethod(kv, 'put')) {
            throw new Error('[Cossack] RATE_LIMITS requires a KV binding with get/put methods.');
        }
        this.namespace = options.namespace === undefined ? 'cossack:rl:' : options.namespace;
        rateLimitNamespace(this.namespace);
    }

    async hit(key: string, windowMs: number, options: RateLimitHitOptions = {}): Promise<{ count: number; resetAt: number }> {
        assertStorageRequirements(this.capabilities, options.requires);
        assertKey(key); assertWindow(windowMs);
        return runRateLimitOperation(options, async signal => {
            const kvKey = rateLimitStorageKey(this.namespace, key);
            const entry = await this.read(kvKey);
            assertRateLimitNotAborted(signal);
            const now = Date.now();
            assertWindow(windowMs);
            const next = readCounter(entry && now < entry.resetAt
                ? { count: entry.count + 1, resetAt: entry.resetAt }
                : { count: 1, resetAt: now + windowMs });
            // Storage retention must not expire the counter before its logical window.
            const ttl = Math.max(60, Math.ceil((next.resetAt - now) / 1000));
            await this.kv.put(kvKey, JSON.stringify(next), { expirationTtl: ttl });
            assertRateLimitNotAborted(signal);
            return next;
        });
    }

    private async read(kvKey: string): Promise<RateLimitCounter | undefined> {
        const raw = await this.kv.get(kvKey);
        if (raw === null) return undefined;
        try {
            if (typeof raw !== 'string' || raw.length > RATE_LIMIT_RESPONSE_MAX_BYTES ||
                new TextEncoder().encode(raw).byteLength > RATE_LIMIT_RESPONSE_MAX_BYTES) throw new Error();
            return readCounter(JSON.parse(raw));
        } catch {
            throw new Error('[Cossack] Invalid rate-limit counter returned by KV storage.');
        }
    }
}

// ---------------------------------------------------------------------------
// Durable Object store (strongly consistent — recommended for strict limits)
// ---------------------------------------------------------------------------

/**
 * Structural subset of Cloudflare's `DurableObjectNamespace` (just the methods
 * we use). Declared locally so the store doesn't depend on generated types; a
 * real binding is structurally compatible.
 */
export interface RateLimitDurableObjectNamespace {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

/**
 * Durable Object that holds a single rate-limit counter. Deploy one and bind it
 * in `wrangler.jsonc` (see {@link DurableObjectRateLimitStore}). Because the
 * store routes each key to its own DO via `idFromName(key)`, every bucket is
 * its own single-threaded consistency point — making this the **strictly
 * accurate** option (unlike the eventually-consistent KV store).
 *
 * The counter and fixed deadline are persisted together in a storage
 * transaction. Eviction does not restore a spent budget. An alarm removes the
 * expired record; the deadline, rather than alarm delivery, controls expiry.
 * Uses the transactional KV API, available on SQLite and legacy DO storage.
 *
 * @example wrangler.jsonc
 * ```jsonc
 * {
 *   "durable_objects": {
 *     "bindings": [{ "name": "RATE_LIMIT_DO", "class_name": "RateLimitDurableObject" }]
 *   },
 *   "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RateLimitDurableObject"] }]
 * }
 * ```
 */
export class RateLimitDurableObject {
    state: DurableObjectState;
    env: any;

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const windowMs = Number(url.searchParams.get('window') ?? '60000');
        if (!validWindow(windowMs, Date.now())) {
            return Response.json({ error: 'Rate-limit window must be positive integer milliseconds within the alarm range.',
                code: 'COSSACK_RATE_LIMIT_CONFIG_INVALID' }, { status: 400 });
        }
        const counter = await this.state.storage.transaction(async txn => {
            const stored = await txn.get<unknown>(RATE_LIMIT_COUNTER_KEY);
            const previous = stored === undefined ? undefined : readCounter(stored);
            const now = Date.now();
            if (!validWindow(windowMs, now)) {
                throw new Error('[Cossack] Rate-limit window exceeds the alarm range.');
            }
            const fresh = !previous || now >= previous.resetAt;
            const next = fresh ? { count: 1, resetAt: now + windowMs }
                : readCounter({ count: previous.count + 1, resetAt: previous.resetAt });
            await txn.put(RATE_LIMIT_COUNTER_KEY, next);
            if (fresh) await txn.setAlarm(next.resetAt);
            return next;
        });
        return Response.json(counter);
    }

    async alarm(): Promise<void> {
        await this.state.storage.transaction(async txn => {
            const stored = await txn.get<unknown>(RATE_LIMIT_COUNTER_KEY);
            const counter = stored === undefined ? undefined : readCounter(stored);
            if (!counter || Date.now() >= counter.resetAt) {
                await txn.delete(RATE_LIMIT_COUNTER_KEY);
                await txn.deleteAlarm();
            } else {
                // A delayed alarm for the old window must leave a newer one intact.
                await txn.setAlarm(counter.resetAt);
            }
        });
    }
}

/**
 * Strongly-consistent rate-limit store backed by a {@link RateLimitDurableObject}.
 * Each key maps to its own DO (`idFromName(key)`), so limits are exact even
 * across Worker instances and regions. This is Cloudflare's recommended pattern
 * for precise rate limiting.
 *
 * @example
 * ```ts
 * import { setRateLimitStore, DurableObjectRateLimitStore, RateLimitDurableObject, type RateLimitDurableObjectNamespace } from '@cossackframework/core';
 *
 * export { RateLimitDurableObject };
 *
 * // Call once during setup for a process with one fixed binding.
 * export function configureLimiter(bindings: { RATE_LIMIT_DO: RateLimitDurableObjectNamespace }) {
 *   setRateLimitStore(new DurableObjectRateLimitStore(bindings.RATE_LIMIT_DO));
 * }
 * ```
 */
export class DurableObjectRateLimitStore implements RateLimitStore {
    readonly capabilities = storageCapabilities('rate-limit', 'durable-object');
    constructor(private readonly ns: RateLimitDurableObjectNamespace) {
        if (!hasMethod(ns, 'idFromName') || !hasMethod(ns, 'get')) {
            throw new Error('[Cossack] RATE_LIMIT_DO requires a Durable Object namespace binding.');
        }
    }

    async hit(key: string, windowMs: number, options: RateLimitHitOptions = {}): Promise<{ count: number; resetAt: number }> {
        assertStorageRequirements(this.capabilities, options.requires);
        assertKey(key); assertWindow(windowMs);
        return runRateLimitOperation(options, async signal => {
            const id = this.ns.idFromName(key);
            const stub = this.ns.get(id);
            const res = await stub.fetch(`https://rate-limit/?window=${windowMs}`, { signal });
            return readCounter(await readRateLimitResponse(res, signal));
        });
    }
}

// ---------------------------------------------------------------------------
// Redis store (zero-dependency, Upstash REST — works on Workers + Node)
// ---------------------------------------------------------------------------

/** Redis/Upstash connection details for {@link RedisRateLimitStore}. */
export interface RedisRateLimitStoreOptions {
    /** Upstash REST URL. Defaults to `UPSTASH_REDIS_REST_URL` env var. */
    url?: string;
    /** Upstash REST token. Defaults to `UPSTASH_REDIS_REST_TOKEN` env var. */
    token?: string;
    /** Key prefix. Default `'cossack:rl:'`. */
    namespace?: string;
    /** Custom fetch (testing). Defaults to the global `fetch`. */
    fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Atomic INCR + conditional PEXPIRE + PTTL in a single round-trip via EVAL.
 * Returns `{ count, pttlMs }`. PEXPIRE is only set on the first increment of a
 * window (count === 1), so the window is fixed, not sliding.
 */
const REDIS_RATE_LIMIT_SCRIPT =
    "local c=redis.call('INCR',KEYS[1]) if c==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end return {c,redis.call('PTTL',KEYS[1])}";

/**
 * Redis rate-limit store using Upstash REST on Cloudflare Workers and Node.js,
 * with zero external dependencies. Configure it from your Worker `env` (set in
 * `wrangler.jsonc`) using {@link redisRateLimitStoreFromEnv}, or pass the
 * URL/token directly.
 *
 * Counting uses a single atomic `EVAL` (`INCR` + conditional `PEXPIRE`), so it
 * is exact under concurrency (unlike the read-then-write KV store).
 *
 * @example wrangler.jsonc
 * ```jsonc
 * { "vars": { "UPSTASH_REDIS_REST_URL": "https://xxx.upstash.io" } }
 * // Set UPSTASH_REDIS_REST_TOKEN using wrangler secret put or local .dev.vars.
 * ```
 * @example
 * ```ts
 * import { redisRateLimitStoreFromEnv, setRateLimitStore } from '@cossackframework/core';
 *
 * // Call once during setup for a process with one fixed backend.
 * export function configureLimiter(env: Record<string, string | undefined>) {
 *   setRateLimitStore(redisRateLimitStoreFromEnv(env));
 * }
 * ```
 */
export class RedisRateLimitStore implements RateLimitStore {
    readonly capabilities = storageCapabilities('rate-limit', 'redis');
    private readonly url: string;
    private readonly token: string;
    private readonly namespace: string;
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response>;

    constructor(options: RedisRateLimitStoreOptions = {}) {
        const env = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {};
        this.url = redisEndpoint(options.url === undefined ? env.UPSTASH_REDIS_REST_URL : options.url);
        this.token = options.token === undefined ? env.UPSTASH_REDIS_REST_TOKEN ?? '' : options.token;
        this.namespace = options.namespace === undefined ? 'cossack:rl:' : options.namespace;
        rateLimitNamespace(this.namespace);
        this.fetchFn = options.fetch === undefined ? globalThis.fetch.bind(globalThis) : options.fetch;
        redisToken(this.token);
        if (typeof this.fetchFn !== 'function') throw new Error('[Cossack] Redis fetch must be a function.');
        if (!credential(this.url) || !credential(this.token)) {
            throw new Error(
                '[Cossack] RedisRateLimitStore requires a Upstash REST url + token. ' +
                    'Pass them explicitly or set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.',
            );
        }
    }

    async hit(key: string, windowMs: number, options: RateLimitHitOptions = {}): Promise<{ count: number; resetAt: number }> {
        assertStorageRequirements(this.capabilities, options.requires);
        assertKey(key); assertWindow(windowMs);
        return runRateLimitOperation(options, async signal => {
            const kvKey = rateLimitStorageKey(this.namespace, key);
            const res = await this.fetchFn(this.url, {
                method: 'POST', signal, redirect: 'manual',
                headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(['EVAL', REDIS_RATE_LIMIT_SCRIPT, '1', kvKey, String(windowMs)]),
        });
        const data = await readRateLimitResponse(res, signal) as { result?: unknown; error?: unknown } | null;
        if (!data || typeof data !== 'object' || Array.isArray(data) || 'error' in data ||
            !Array.isArray(data.result) || data.result.length !== 2) {
            throw new Error('[Cossack] RedisRateLimitStore returned an invalid or error response.');
        }
        const [count, pttl] = data.result;
        if (typeof pttl !== 'number' || !Number.isSafeInteger(pttl) || pttl < 0) {
            throw new Error('[Cossack] RedisRateLimitStore returned an invalid counter TTL.');
        }
        return readCounter({ count, resetAt: Date.now() + pttl });
        });
    }
}

/**
 * Build a {@link RedisRateLimitStore} from a Worker `env` (the standard place
 * Upstash credentials are injected). Reads `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN`. Throws if they are not set.
 */
export function redisRateLimitStoreFromEnv(
    env: Record<string, string | undefined>,
    options: Omit<RedisRateLimitStoreOptions, 'url' | 'token'> = {},
): RedisRateLimitStore {
    if (!credential(env.UPSTASH_REDIS_REST_URL) || !credential(env.UPSTASH_REDIS_REST_TOKEN)) {
        throw new Error('[Cossack] Upstash credentials must be supplied by the selected environment.');
    }
    return new RedisRateLimitStore({
        ...options,
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
    });
}

let defaultStore: RateLimitStore | undefined;
const processDefaultStore = (): RateLimitStore => defaultStore ??= new InMemoryRateLimitStore();
let manualStore: RateLimitStore | undefined;
interface StoreSelection {
    mode: 'durable-object' | 'redis' | 'kv';
    binding?: unknown;
    url?: string;
    token?: string;
}
let configuredStores = new WeakMap<object, StoreSelection & { store: RateLimitStore }>();

/**
 * Set an intentional process-wide store override. This takes precedence over
 * environment selection. Do not set per-request stores here; use `rateLimit`
 * and bindings on the request environment for automatic selection instead.
 */
export function setRateLimitStore(store: RateLimitStore): void {
    if (!hasMethod(store, 'hit')) throw new Error('[Cossack] Rate-limit store requires a hit method.');
    manualStore = store;
}

/** @internal Resolve this environment's store, or the manual/process default. */
export function getRateLimitStore(env?: Record<string, unknown>): RateLimitStore {
    return configureRateLimitFromEnv(env);
}

/** @internal Reset all module state — tests only. */
export function __resetRateLimitForTests(): void {
    defaultStore = undefined;
    manualStore = undefined;
    configuredStores = new WeakMap();
}

/**
 * Resolve `rateLimit` (or `RATE_LIMIT`) from this request's environment.
 * `durable-object`/`do`, `redis`/`upstash`, and `kv` require their own bindings
 * or credentials. Unset configuration uses the process-local memory store.
 * Invalid explicit configuration throws; it never falls back to another store.
 * Unchanged environment/binding/credential selections reuse a store. Changes
 * are read on each call. The returned store belongs to this selection and does
 * not modify a process-wide "last configured store". Manual overrides win.
 * @internal — invoked automatically by `evaluateRateLimit`; exported for tests.
 */
export function configureRateLimitFromEnv(env: Record<string, unknown> | undefined): RateLimitStore {
    if (manualStore) return manualStore;
    if (env == null) return processDefaultStore();
    if (typeof env !== 'object' || Array.isArray(env)) {
        throw new Error('[Cossack] Rate-limit environment must be an object.');
    }
    const raw = env.rateLimit === undefined ? env.RATE_LIMIT : env.rateLimit;
    if (raw === undefined) return processDefaultStore();
    if (typeof raw !== 'string' || !raw.trim()) {
        throw new Error('[Cossack] rateLimit must name a supported backend.');
    }
    const mode = raw.trim().toLowerCase();
    let selection: StoreSelection;
    switch (mode) {
        case 'durable-object':
        case 'do':
            selection = { mode: 'durable-object', binding: env.RATE_LIMIT_DO };
            break;
        case 'kv':
            selection = { mode: 'kv', binding: env.RATE_LIMITS };
            break;
        case 'redis':
        case 'upstash': {
            const url = env.UPSTASH_REDIS_REST_URL;
            const token = env.UPSTASH_REDIS_REST_TOKEN;
            if (!credential(url) || !credential(token)) {
                throw new Error('[Cossack] Upstash requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in the selected environment.');
            }
            selection = { mode: 'redis', url, token };
            break;
        }
        default:
            throw new Error('[Cossack] Unknown rateLimit mode. Use durable-object, redis, or kv.');
    }
    const cached = configuredStores.get(env);
    if (cached && cached.mode === selection.mode && cached.binding === selection.binding &&
        cached.url === selection.url && cached.token === selection.token) return cached.store;
    const store = selection.mode === 'durable-object'
        ? new DurableObjectRateLimitStore(selection.binding as RateLimitDurableObjectNamespace)
        : selection.mode === 'kv' ? new KvRateLimitStore(selection.binding as RateLimitKvNamespace)
        : new RedisRateLimitStore({ url: selection.url, token: selection.token });
    configuredStores.set(env, { ...selection, store });
    return store;
}

const clientAddresses = new WeakMap<Request, string>();
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

/**
 * Record the transport peer address for `request` (the TCP socket's remote
 * address). Runtime adapters call this before dispatching so
 * {@link getClientIp} can bucket anonymous callers without trusting
 * client-controlled headers. Node entries pass
 * `incoming.socket.remoteAddress`.
 */
export function setClientAddress(request: Request, address: string | undefined | null): void {
    if (typeof address === 'string' && address) clientAddresses.set(request, address);
}

function isCloudflareWorkers(): boolean {
    return (globalThis as { navigator?: { userAgent?: unknown } }).navigator?.userAgent === 'Cloudflare-Workers';
}

function trustedProxyHeader(env: Record<string, unknown> | undefined): string | undefined {
    if (!env || typeof env !== 'object') return undefined;
    const raw = env.rateLimitTrustProxy === undefined ? env.RATE_LIMIT_TRUST_PROXY : env.rateLimitTrustProxy;
    if (raw === undefined || raw === '') return undefined;
    const header = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!HEADER_NAME.test(header)) {
        throw new Error('[Cossack] RATE_LIMIT_TRUST_PROXY must name the single header set by your trusted proxy (e.g. x-forwarded-for).');
    }
    return header;
}

function socketAddress(c: Context): string | undefined {
    const raw = c.req?.raw;
    const recorded = raw ? clientAddresses.get(raw) : undefined;
    if (recorded) return recorded;
    // @hono/node-server's default bindings: `{ incoming }` (or `{ server: { incoming } }`).
    const env = (c as unknown as { env?: Record<string, any> }).env;
    const incoming = env?.incoming ?? env?.server?.incoming;
    const address = incoming?.socket?.remoteAddress;
    return typeof address === 'string' && address ? address : undefined;
}

/**
 * Client IP used for anonymous rate-limit buckets. Client-supplied proxy
 * headers are ignored unless the deployment says who sets them:
 *
 * - `RATE_LIMIT_TRUST_PROXY` (or `rateLimitTrustProxy`) in the request
 *   environment names the one header your reverse proxy overwrites. For
 *   `x-forwarded-for` the right-most hop (appended by that proxy) is used.
 * - On Cloudflare Workers, `cf-connecting-ip` is set by Cloudflare and trusted.
 * - Otherwise the transport peer address recorded by the adapter
 *   ({@link setClientAddress}) or `@hono/node-server`'s `incoming` binding.
 *
 * Falls back to `'anonymous'` (one shared bucket) when none is available.
 */
export function getClientIp(c: Context): string {
    const header = (name: string) => (c.req.header?.(name) as string | undefined | null) || '';
    const trusted = trustedProxyHeader((c as unknown as { env?: Record<string, unknown> }).env);
    if (trusted) {
        const value = trusted === 'x-forwarded-for'
            ? header(trusted).split(',').map(part => part.trim()).filter(Boolean).pop()
            : header(trusted).trim();
        if (value) return value;
    } else if (isCloudflareWorkers()) {
        const value = header('cf-connecting-ip').trim();
        if (value) return value;
    }
    return socketAddress(c) || 'anonymous';
}

/**
 * Default rate-limit key: the authenticated user's id if available, otherwise
 * the client IP. Pass {@link RateLimitOptions.key} to bucket by something else
 * (e.g. `c => getClientIp(c)` for anonymous-only, or a tenant id).
 */
export function defaultRateLimitKey(c: Context): string {
    const user = (c.get as (key: string) => unknown)('user') as { id?: string } | undefined;
    return user && user.id ? `user:${user.id}` : `ip:${getClientIp(c)}`;
}

/**
 * @internal Evaluate a rate limit against the selected request store. Returns a `429`
 * `Response` when the caller has exceeded the limit, or `null` when allowed.
 * `scopeKey` namespaces the counter (e.g. per route or per server method) so
 * limits on one endpoint don't consume another's budget.
 */
export async function enforceRateLimit(
    c: Context,
    scopeKey: string,
    options: RateLimitOptions,
): Promise<Response | null> {
    const blocked = await evaluateRateLimit(c, scopeKey, options);
    if (!blocked) return null;
    const requestId = c.res?.headers.get('X-Cossack-Request-Id');
    const response = c.json({ error: blocked.message, code: 'COSSACK_RPC_RATE_LIMITED',
        ...(requestId ? { requestId } : {}) }, 429);
    response.headers.set('Retry-After', String(blocked.retryAfter));
    return response;
}

/** @internal Shared counter decision for HTTP responses and socket frames. */
export async function evaluateRateLimit(
    c: Context,
    scopeKey: string,
    options: RateLimitOptions,
    signal: AbortSignal | undefined = c.req?.raw?.signal,
): Promise<{ message: string; retryAfter: number } | null> {
    assertRateLimitOptions(options);
    const store = configureRateLimitFromEnv((c as unknown as { env?: Record<string, unknown> }).env);
    const capabilities = readStorageCapabilities(store.capabilities, 'rate-limit');
    const requirements = storageRequirements(options.requires);
    assertStorageRequirements(capabilities, requirements);
    const windowMs = options.window === undefined ? 60_000 : options.window;
    const max = options.max === undefined ? 60 : options.max;
    assertWindow(windowMs);
    if (!Number.isSafeInteger(max) || max < 0) {
        throw new Error('[Cossack] Rate-limit max must be a non-negative safe integer.');
    }
    if (options.key !== undefined && typeof options.key !== 'function') {
        throw new Error('[Cossack] Rate-limit key must be a function.');
    }
    if (options.message !== undefined && typeof options.message !== 'string') {
        throw new Error('[Cossack] Rate-limit message must be a string.');
    }
    assertKey(scopeKey);
    const caller = options.key ? options.key(c) : defaultRateLimitKey(c);
    assertKey(caller);
    const { count, resetAt } = await runRateLimitOperation({ signal, timeoutMs: options.backendTimeoutMs },
        async operationSignal => readCounter(await store.hit(JSON.stringify([scopeKey, caller]), windowMs,
            { signal: operationSignal, timeoutMs: options.backendTimeoutMs, requires: requirements })));
    if (count <= max) return null;

    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    return { message: options.message ?? 'Too Many Requests', retryAfter };
}

/**
 * Read the `@RateLimit` options registered for `action` on a class (or any of
 * its ancestors via the prototype chain). Returns `undefined` when the method
 * has no limit. Mirrors the chain walk in `isRpcCallableAction`.
 */
export function getRateLimitForAction(constructor: unknown, action: string): RateLimitOptions | undefined {
    if (!action) return undefined;
    let proto: object | null = typeof constructor === 'function' ? constructor : null;
    while (proto !== null && proto !== Function.prototype) {
        const store = Reflect.getOwnMetadata(RATE_LIMIT_METADATA_KEY, proto) as
            | Record<string, RateLimitOptions>
            | undefined;
        if (store && Object.prototype.hasOwnProperty.call(store, action)) {
            assertRateLimitOptions(store[action]);
            return store[action];
        }
        proto = Object.getPrototypeOf(proto);
    }
    return undefined;
}

/**
 * @internal Enforce the `@RateLimit` declared on a server method (or class-based
 * API handler). Looks up the options via {@link getRateLimitForAction}; returns a
 * `429` response or `null`. Used by the `/crpc`, `/upload`, and class-based API
 * dispatch paths.
 */
export async function enforceMethodRateLimit(
    c: Context,
    constructor: unknown,
    action: string,
    scopePrefix: string,
): Promise<Response | null> {
    const options = getRateLimitForAction(constructor, action);
    if (options === undefined) return null;
    return enforceRateLimit(c, `${scopePrefix}:${action}`, options);
}

type HonoHandler = (c: Context) => unknown;

/**
 * Rate-limit a handler or method. Three call styles:
 *
 * 1. **Method decorator** (for `@Server` methods and class-based API handlers):
 *    ```ts
 *    @Server()
 *    @RateLimit({ window: 60_000, max: 10 })
 *    save() { ... }
 *    ```
 *
 * 2. **Handler wrapper with options** (functional API routes):
 *    ```ts
 *    export const GET = RateLimit({ window: 60_000, max: 10 }, (c) => c.json([...]));
 *    ```
 *
 * 3. **Handler wrapper with defaults** (`window: 60s`, `max: 60`):
 *    ```ts
 *    export const GET = RateLimit((c) => c.json([...]));
 *    ```
 *
 * The decorator form stores metadata (`cossack:rate-limit`) which the framework
 * enforces at the RPC/API dispatch boundary. The wrapper forms guard the handler
 * directly. Both resolve the same request-environment {@link RateLimitStore}.
 *
 * > Decorators cannot legally be applied to a standalone `const` export in
 * > TypeScript, so functional API routes use the wrapper forms (2/3) rather than
 * > `@RateLimit`.
 */
export function RateLimit(options: RateLimitOptions): MethodDecorator;
export function RateLimit<T extends HonoHandler>(handler: T): T;
export function RateLimit<T extends HonoHandler>(options: RateLimitOptions, handler: T): T;
export function RateLimit(first: RateLimitOptions | HonoHandler, second?: HonoHandler): any {
    // Form 2: RateLimit(options, handler)
    if (typeof second === 'function') {
        return wrapHandler(first as RateLimitOptions, second);
    }
    // Form 3: RateLimit(handler)
    if (typeof first === 'function') {
        return wrapHandler({}, first);
    }
    // Form 1: RateLimit(options) -> method decorator
    const opts = first as RateLimitOptions;
    return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
        const store: Record<string, RateLimitOptions> = Reflect.hasOwnMetadata(RATE_LIMIT_METADATA_KEY, target.constructor)
            ? Reflect.getOwnMetadata(RATE_LIMIT_METADATA_KEY, target.constructor)
            : {};
        store[String(propertyKey)] = opts;
        Reflect.defineMetadata(RATE_LIMIT_METADATA_KEY, store, target.constructor);
        return descriptor;
    };
}

/**
 * The matched route template (`/api/items/:id`), so every concrete path of one
 * route shares a budget. Falls back to the concrete path outside a Hono router.
 */
function rateLimitRoute(c: Context): string {
    try {
        const template = (c.req as { routePath?: unknown }).routePath;
        if (typeof template === 'string' && template) return template;
    } catch { /* not routed through Hono */ }
    return c.req.path;
}

function wrapHandler(options: RateLimitOptions, handler: HonoHandler): HonoHandler {
    return async (c: Context) => {
        const blocked = await enforceRateLimit(c, `route:${c.req.method}:${rateLimitRoute(c)}`, options);
        if (blocked) return blocked;
        assertRateLimitNotAborted(c.req?.raw?.signal);
        return handler(c);
    };
}

/** Inspect a request-selected store without charging any counter. */
export function inspectRateLimitStore(env?: Record<string, unknown>): StorageCapabilities {
    return readStorageCapabilities(configureRateLimitFromEnv(env).capabilities, 'rate-limit');
}
