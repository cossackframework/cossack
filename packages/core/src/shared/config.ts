// src/shared/config.ts
//
// Application configuration accessors backed by AsyncLocalStorage (ALS).
//
// The framework owns a single `AsyncLocalStorage<ConfigStore>` instance and
// wires it into this module via {@link setConfigStoreGetter} (see the
// framework's `config-context.ts`). Each request is wrapped in an ALS scope so
// `config()` / `env()` resolve values scoped to the current request's bindings
// (`c.env`), even when a single Worker isolate serves many concurrent users.
//
// This mirrors the established i18n pattern (`setLocaleStoreGetter`) and the
// database pattern (`setDbStoreGetter`): a leaf module in core exposes a store
// getter, and the framework injects the ALS-backed implementation.

import { isServer } from './environment';

/**
 * Function passed to config factories to read per-request environment bindings.
 * Coerces the binding value to a string and falls back to `defaultValue` when
 * the binding is unset — matching the Laravel `env()` helper's ergonomics.
 */
export type EnvFunction = (key: string, defaultValue?: string) => string;

/**
 * A config file's default export. Evaluated per request with an {@link
 * EnvFunction} so it can read request-scoped bindings (Workers-correct: env
 * bindings are only available inside the request handler, not at module load).
 *
 * @example
 * ```ts
 * // src/config/app.ts
 * export default ({ env }) => ({
 *   name: 'My App',
 *   env: env('APP_ENV', 'production'),
 * });
 * ```
 */
export type ConfigFactory = (ctx: { env: EnvFunction }) => Record<string, unknown>;

/**
 * The per-request store: the request's env bindings (`c.env`) and the already
 * evaluated config tree (`{ app: {...}, database: {...}, ... }`).
 */
export interface ConfigStore {
    /** The request's bindings (e.g. Cloudflare `c.env`). */
    env: Record<string, unknown>;
    /** The evaluated config tree, keyed by config file name (sans extension). */
    config: Record<string, unknown>;
}

let configStoreGetter: (() => ConfigStore | undefined) | null = null;

/**
 * @internal Framework injects a per-request store getter backed by
 * AsyncLocalStorage so server-side `config()` / `env()` read the right values
 * for each request. Mirrors `setLocaleStoreGetter`.
 */
export function setConfigStoreGetter(
    getter: (() => ConfigStore | undefined) | null,
): void {
    configStoreGetter = getter;
}

/** Returns the active per-request store on the server, otherwise undefined. */
function requestStore(): ConfigStore | undefined {
    if (isServer && configStoreGetter) return configStoreGetter();
    return undefined;
}

/**
 * Reads a value from the per-request config tree using dotted notation.
 *
 * The key maps to the config file name + nested path, e.g. `config('app.name')`
 * resolves `src/config/app.ts`'s `{ name }` and `config('database.connections.mysql.host')`
 * walks into `src/config/database.ts`'s nested object.
 *
 * Returns `defaultValue` when the key is missing, when no request scope is
 * active (e.g. on the client or outside a request), or when an intermediate
 * segment is not an object.
 *
 * @example
 * ```ts
 * import { config } from '@cossackframework/core';
 *
 * const appName = config('app.name');           // 'My App'
 * const host = config('database.connections.mysql.host', 'localhost');
 * ```
 */
export function config<T = unknown>(key: string, defaultValue?: T): T {
    const store = requestStore();
    if (!store) return defaultValue as T;

    const segments = key.split('.');
    let current: unknown = store.config;
    for (const segment of segments) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return defaultValue as T;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return current === undefined ? (defaultValue as T) : (current as T);
}

/**
 * Reads a flat binding from the per-request environment (`c.env`), coerced to a
 * string, falling back to `defaultValue` when the binding is unset.
 *
 * Returns `defaultValue` (or `''` when none is given) when no request scope is
 * active (e.g. on the client or outside a request).
 *
 * @example
 * ```ts
 * import { env } from '@cossackframework/core';
 *
 * const dbHost = env('DB_HOST', 'localhost');   // e.g. 'db.example.com'
 * ```
 */
export function env(key: string, defaultValue?: string): string {
    const store = requestStore();
    if (!store) return defaultValue ?? '';
    const value = store.env?.[key];
    return value === undefined || value === null ? defaultValue ?? '' : String(value);
}
