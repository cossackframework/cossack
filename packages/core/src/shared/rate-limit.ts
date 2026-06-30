// src/shared/rate-limit.ts
import 'reflect-metadata';
import type { Context } from 'hono';

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
    /**
     * Fixed-window duration in milliseconds. Default `60_000` (1 minute).
     */
    window?: number;
    /**
     * Maximum allowed requests per window per key. Default `60`.
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
    /**
     * Increment the counter for `key`. If the window has elapsed since the last
     * reset, start a fresh window with count `1`. Must return the current count
     * and the epoch-millis timestamp at which the window resets.
     */
    hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> | { count: number; resetAt: number };
}

/**
 * Simple in-memory fixed-window counter. Entries are pruned lazily once the
 * store grows beyond `maxEntries` (default 10 000).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
    private readonly entries = new Map<string, { count: number; resetAt: number }>();
    private readonly maxEntries: number;

    constructor(maxEntries = 10_000) {
        this.maxEntries = maxEntries;
    }

    hit(key: string, windowMs: number): { count: number; resetAt: number } {
        const now = Date.now();
        const existing = this.entries.get(key);
        if (!existing || now >= existing.resetAt) {
            const resetAt = now + windowMs;
            this.entries.set(key, { count: 1, resetAt });
            if (this.entries.size > this.maxEntries) this.prune(now);
            return { count: 1, resetAt };
        }
        existing.count += 1;
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
 * Keys are written with a TTL equal to the window, so expired buckets are
 * garbage-collected by KV automatically — there is no unbounded growth.
 *
 * @example
 * ```ts
 * import { setRateLimitStore, KvRateLimitStore } from '@cossackframework/core';
 *
 * export default {
 *   async fetch(req, env) {
 *     setRateLimitStore(new KvRateLimitStore(env.RATE_LIMITS));
 *     // ...your app
 *   },
 * };
 * ```
 *
 * > **Caveat — approximate, not exact.** KV is *eventually consistent* and has
 * > no atomic increment, so a concurrent burst from the same caller can
 * > under-count (two reads see the old value before either write lands). In
 * > practice this means the limit may be exceeded by a small amount under load
 * > — acceptable for most abuse protection, but if you need **strict/accurate**
 * > limits, back the store with a Durable Object (strongly consistent) instead.
 */
export class KvRateLimitStore implements RateLimitStore {
    private readonly namespace: string;

    constructor(
        private readonly kv: RateLimitKvNamespace,
        options: KvRateLimitStoreOptions = {},
    ) {
        this.namespace = options.namespace ?? 'cossack:rl:';
    }

    async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
        const kvKey = `${this.namespace}${key}`;
        const now = Date.now();
        const ttl = Math.max(1, Math.ceil(windowMs / 1000));
        const windowEnd = now + windowMs;

        const entry = await this.read(kvKey);
        if (entry && now < entry.resetAt) {
            entry.count += 1;
        } else {
            entry.count = 1;
            entry.resetAt = windowEnd;
        }

        await this.kv.put(kvKey, JSON.stringify(entry), { expirationTtl: ttl });
        return { count: entry.count, resetAt: entry.resetAt };
    }

    private async read(kvKey: string): Promise<{ count: number; resetAt: number }> {
        const raw = await this.kv.get(kvKey);
        if (!raw) return { count: 0, resetAt: 0 };
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed?.count === 'number' && typeof parsed?.resetAt === 'number') {
                return { count: parsed.count, resetAt: parsed.resetAt };
            }
        } catch {
            /* corrupt entry — treat as fresh */
        }
        return { count: 0, resetAt: 0 };
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
 * The counter lives in memory; if the DO is evicted the window simply restarts
 * (count resets to 0). Reads/writes happen with no `await` between them, so each
 * `fetch` is atomic by the DO's single-threaded execution guarantee.
 *
 * @example wrangler.jsonc
 * ```jsonc
 * {
 *   "durable_objects": {
 *     "bindings": [{ "name": "RATE_LIMIT_DO", "class_name": "RateLimitDurableObject" }]
 *   },
 *   "migrations": [{ "tag": "v1", "new_classes": ["RateLimitDurableObject"] }]
 * }
 * ```
 */
export class RateLimitDurableObject {
    state: DurableObjectState;
    env: any;
    private count = 0;
    private resetAt = 0;

    constructor(state: DurableObjectState, env: any) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const windowMs = Number(url.searchParams.get('window') ?? '60000');
        const now = Date.now();
        if (now >= this.resetAt) {
            this.count = 1;
            this.resetAt = now + windowMs;
        } else {
            this.count += 1;
        }
        return Response.json({ count: this.count, resetAt: this.resetAt });
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
 * import { setRateLimitStore, DurableObjectRateLimitStore, RateLimitDurableObject } from '@cossackframework/core';
 *
 * export { RateLimitDurableObject };
 *
 * export default {
 *   async fetch(req, env) {
 *     setRateLimitStore(new DurableObjectRateLimitStore(env.RATE_LIMIT_DO));
 *     return app.fetch(req, env);
 *   },
 * };
 * ```
 */
export class DurableObjectRateLimitStore implements RateLimitStore {
    constructor(private readonly ns: RateLimitDurableObjectNamespace) {}

    async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
        const id = this.ns.idFromName(key);
        const stub = this.ns.get(id);
        const res = await stub.fetch(`https://rate-limit/?window=${windowMs}`);
        if (!res.ok) {
            throw new Error(`[Cossack] RateLimitDurableObject returned ${res.status}`);
        }
        const data = (await res.json()) as { count: number; resetAt: number };
        return { count: data.count, resetAt: data.resetAt };
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
 * Atomic INCR + conditional EXPIRE + PTTL in a single round-trip via EVAL.
 * Returns `{ count, pttlMs }`. EXPIRE is only set on the first increment of a
 * window (count === 1), so the window is fixed, not sliding.
 */
const REDIS_RATE_LIMIT_SCRIPT =
    "local c=redis.call('INCR',KEYS[1]) if c==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end return {c,redis.call('PTTL',KEYS[1])}";

/**
 * Rate-limit store backed by **Redis via Upstash REST** — the only Redis client
 * shape that runs on both Cloudflare Workers (no TCP sockets) and Node.js, with
 * zero external dependencies. Configure it from your Worker `env` (set in
 * `wrangler.jsonc`) using {@link redisRateLimitStoreFromEnv}, or pass the
 * URL/token directly.
 *
 * Counting uses a single atomic `EVAL` (`INCR` + conditional `EXPIRE`), so it
 * is exact under concurrency (unlike the read-then-write KV store).
 *
 * @example wrangler.jsonc
 * ```jsonc
 * { "vars": { "UPSTASH_REDIS_REST_URL": "https://xxx.upstash.io", "UPSTASH_REDIS_REST_TOKEN": "..." } }
 * ```
 * @example
 * ```ts
 * import { redisRateLimitStoreFromEnv, setRateLimitStore } from '@cossackframework/core';
 *
 * export default {
 *   async fetch(req, env) {
 *     setRateLimitStore(redisRateLimitStoreFromEnv(env));
 *     return app.fetch(req, env);
 *   },
 * };
 * ```
 */
export class RedisRateLimitStore implements RateLimitStore {
    private readonly url: string;
    private readonly token: string;
    private readonly namespace: string;
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response>;

    constructor(options: RedisRateLimitStoreOptions = {}) {
        const env = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {};
        this.url = options.url ?? env.UPSTASH_REDIS_REST_URL ?? '';
        this.token = options.token ?? env.UPSTASH_REDIS_REST_TOKEN ?? '';
        this.namespace = options.namespace ?? 'cossack:rl:';
        this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
        if (!this.url || !this.token) {
            throw new Error(
                '[Cossack] RedisRateLimitStore requires a Upstash REST url + token. ' +
                    'Pass them explicitly or set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.',
            );
        }
    }

    async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
        const kvKey = `${this.namespace}${key}`;
        const ttl = Math.max(1, Math.ceil(windowMs / 1000));
        const res = await this.fetchFn(this.url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(['EVAL', REDIS_RATE_LIMIT_SCRIPT, '1', kvKey, String(ttl)]),
        });
        if (!res.ok) {
            throw new Error(`[Cossack] RedisRateLimitStore Upstash HTTP ${res.status}`);
        }
        const data = (await res.json()) as { result?: [number, number]; error?: string };
        if (data.error) {
            throw new Error(`[Cossack] RedisRateLimitStore: ${data.error}`);
        }
        const [count, pttl] = data.result ?? [0, 0];
        const remaining = typeof pttl === 'number' && pttl > 0 ? pttl : windowMs;
        return { count: Number(count), resetAt: Date.now() + remaining };
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
    return new RedisRateLimitStore({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
        ...options,
    });
}

let globalStore: RateLimitStore = new InMemoryRateLimitStore();
let manualOverride = false;
let autoConfigured = false;

/**
 * Override the global rate-limit store (advanced). Use this to back the limiter
 * with shared storage so limits hold across instances. An explicit call here
 * takes precedence over {@link configureRateLimitFromEnv} / the `rateLimit`
 * env-var config — the auto-config will not overwrite a store you set manually.
 */
export function setRateLimitStore(store: RateLimitStore): void {
    globalStore = store;
    manualOverride = true;
}

/** @internal Current global store. */
export function getRateLimitStore(): RateLimitStore {
    return globalStore;
}

/** @internal Reset all module state — tests only. */
export function __resetRateLimitForTests(): void {
    globalStore = new InMemoryRateLimitStore();
    manualOverride = false;
    autoConfigured = false;
}

/**
 * Configure the rate-limit store from a Worker `env`, driven by the `rateLimit`
 * (or `RATE_LIMIT`) var. This is the **zero-code** path: set the var plus the
 * relevant binding in `wrangler.jsonc` and the framework picks the store
 * automatically — no `setRateLimitStore()` call in your entry.
 *
 * Accepted values:
 * - `"durable-object"` (aliases `"do"`) → uses the `RATE_LIMIT_DO` binding.
 * - `"redis"` (alias `"upstash"`) → uses `UPSTASH_REDIS_REST_URL` / `_TOKEN`.
 * - `"kv"` → uses the `RATE_LIMITS` binding.
 * - unset → the default in-memory store is kept.
 *
 * Idempotent: builds the store once on the first call that sees a config value,
 * and is a cheap no-op afterwards. A manual `setRateLimitStore()` call wins.
 * @internal — invoked automatically by `enforceRateLimit`; export for testing.
 */
export function configureRateLimitFromEnv(env: Record<string, any> | undefined): void {
    if (manualOverride || autoConfigured) return;
    if (!env) return;
    const raw = env.rateLimit ?? env.RATE_LIMIT;
    if (!raw) return;
    const mode = String(raw).trim().toLowerCase();
    const store = buildRateLimitStore(mode, env);
    if (store) {
        globalStore = store;
        autoConfigured = true;
    }
}

/** @internal Maps a config string + env to a concrete store. */
function buildRateLimitStore(mode: string, env: Record<string, any>): RateLimitStore | null {
    switch (mode) {
        case 'durable-object':
        case 'do': {
            const ns = env.RATE_LIMIT_DO;
            if (!ns) {
                console.error(
                    '[Cossack] rateLimit="durable-object" but no "RATE_LIMIT_DO" binding was found. ' +
                        'Add it to durable_objects.bindings (and migrations) in wrangler.jsonc.',
                );
                return null;
            }
            return new DurableObjectRateLimitStore(ns);
        }
        case 'redis':
        case 'upstash': {
            const url = env.UPSTASH_REDIS_REST_URL;
            const token = env.UPSTASH_REDIS_REST_TOKEN;
            if (!url || !token) {
                console.error(
                    '[Cossack] rateLimit="redis" but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. ' +
                        'Add them to vars in wrangler.jsonc.',
                );
                return null;
            }
            return new RedisRateLimitStore({ url, token });
        }
        case 'kv': {
            const kv = env.RATE_LIMITS;
            if (!kv) {
                console.error(
                    '[Cossack] rateLimit="kv" but no "RATE_LIMITS" binding was found. ' +
                        'Add a KV namespace binding in wrangler.jsonc.',
                );
                return null;
            }
            return new KvRateLimitStore(kv);
        }
        default:
            console.error(
                `[Cossack] Unknown rateLimit mode "${mode}". Use "durable-object", "redis", or "kv".`,
            );
            return null;
    }
}

/**
 * Best-effort client IP extraction. Checks Cloudflare (`cf-connecting-ip`),
 * the conventional `x-real-ip`, then the first hop of `x-forwarded-for`.
 * Falls back to `'anonymous'` when no proxy header is present (e.g. local dev).
 */
export function getClientIp(c: Context): string {
    return (
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-real-ip') ||
        (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
        'anonymous'
    );
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
 * @internal Evaluate a rate limit against the global store. Returns a `429`
 * `Response` when the caller has exceeded the limit, or `null` when allowed.
 * `scopeKey` namespaces the counter (e.g. per route or per server method) so
 * limits on one endpoint don't consume another's budget.
 */
export async function enforceRateLimit(
    c: Context,
    scopeKey: string,
    options: RateLimitOptions,
): Promise<Response | null> {
    // Zero-code store config: lazily read `env.rateLimit` once, on first use.
    configureRateLimitFromEnv((c as unknown as { env?: Record<string, any> }).env);

    const windowMs = options.window ?? 60_000;
    const max = options.max ?? 60;
    const caller = options.key ? options.key(c) : defaultRateLimitKey(c);
    const { count, resetAt } = await globalStore.hit(`${scopeKey}:${caller}`, windowMs);
    if (count <= max) return null;

    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    const response = c.json({ error: options.message ?? 'Too Many Requests' }, 429);
    response.headers.set('Retry-After', String(retryAfter));
    return response;
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
    if (!options) return null;
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
 * directly. Both use the same global {@link RateLimitStore}.
 *
 * > Decorators cannot legally be applied to a standalone `const` export in
 * > TypeScript, so functional API routes use the wrapper forms (2/3) rather than
 * > `@RateLimit`.
 */
export function RateLimit(options: RateLimitOptions): MethodDecorator;
export function RateLimit<T extends HonoHandler>(handler: T): T;
export function RateLimit<T extends HonoHandler>(options: RateLimitOptions, handler: T): T;
export function RateLimit(first: RateLimitOptions | HonoHandler, second?: HonoHandler): any {
    // Form 3: RateLimit(options, handler)
    if (typeof second === 'function') {
        return wrapHandler((first as RateLimitOptions) ?? {}, second);
    }
    // Form 2: RateLimit(handler)
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

function wrapHandler(options: RateLimitOptions, handler: HonoHandler): HonoHandler {
    return async (c: Context) => {
        const blocked = await enforceRateLimit(c, `route:${c.req.method}:${c.req.path}`, options);
        if (blocked) return blocked;
        return handler(c);
    };
}
