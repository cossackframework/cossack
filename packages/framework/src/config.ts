// src/config.ts
//
// Application configuration accessors backed by AsyncLocalStorage (ALS),
// plus the type-safe inference machinery for dotted-path lookups.
//
// The framework owns the single `AsyncLocalStorage<ConfigStore>` instance and
// wraps each request in a config scope (see the config middleware in
// `router.ts` and the SSG render path in `ssg-renderer.ts`). `config()` /
// `env()` read from the active scope so values resolve per-request, even when
// a single Worker isolate serves many concurrent users.
//
// Config files (`src/config/*.ts`) are server-only — they are never bundled
// into the client. On the client or outside a request scope, `config()` and
// `env()` return their defaults.

import { AsyncLocalStorage } from 'node:async_hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Type-safe inference machinery
// ---------------------------------------------------------------------------

/**
 * Users augment this interface via `declare module` in their config files to
 * register typed config shapes. Empty by default — when unpopulated,
 * `config()` returns `unknown` for every key (backward-compatible). When
 * populated, `config()` infers return types and auto-completes dotted paths.
 *
 * @example
 * ```ts
 * // src/config/app.ts
 * export interface AppConfig {
 *   name: string;
 *   env: 'production' | 'development';
 *   nested: { sub: { value: number } };
 * }
 *
 * declare module '@cossackframework/framework/config' {
 *   interface CossackConfigRegistry {
 *     app: AppConfig;
 *   }
 * }
 * ```
 */
export interface CossackConfigRegistry {}

/**
 * Recursively builds all valid dotted paths through a config tree type.
 * @example
 * type Paths = DottedPaths<{ app: { name: string } }>; // 'app.name'
 */
type DottedPaths<T, Prefix extends string = ''> = T extends object
    ? {
          [K in keyof T & string]: T[K] extends object
              ? DottedPaths<T[K], `${Prefix}${K}.`>
              : `${Prefix}${K}`;
      }[keyof T & string]
    : never;

/**
 * Extracts the value type at a dotted path within a config tree.
 * @example
 * type V = GetByPath<{ app: { name: string } }, 'app.name'>; // string
 */
type GetByPath<T, Path extends string> = Path extends `${infer Head}.${infer Rest}`
    ? Head extends keyof T
        ? GetByPath<T[Head], Rest>
        : unknown
    : Path extends keyof T
      ? T[Path]
      : unknown;

// ---------------------------------------------------------------------------
// ALS scope
// ---------------------------------------------------------------------------

const configAls = new AsyncLocalStorage<ConfigStore>();

/**
 * Returns the active per-request config store, or `undefined` when no scope is
 * active (client-side, outside a request).
 */
function requestStore(): ConfigStore | undefined {
    return configAls.getStore();
}

/**
 * Runs `fn` inside a config scope. Any call to `config()` / `env()` inside `fn`
 * (or its async descendants) reads from `store` (the request's env bindings and
 * the evaluated config tree).
 */
export function runWithConfig<T>(
    store: ConfigStore,
    fn: () => T | Promise<T>,
): T | Promise<T> {
    return configAls.run(store, fn as () => T);
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Reads a value from the per-request config tree using dotted notation.
 *
 * The key maps to the config file name + nested path, e.g. `config('app.name')`
 * resolves `src/config/app.ts`'s `{ name }` and `config('database.connections.mysql.host')`
 * walks into `src/config/database.ts`'s nested object.
 *
 * **Type safety:** when the `CossackConfigRegistry` interface is augmented
 * (via `declare module` in config files), `config()` auto-completes valid
 * paths and infers return types. Unknown paths are compile errors. Without
 * augmentation, every call returns `unknown` (backward-compatible).
 *
 * Returns `defaultValue` when the key is missing, when no request scope is
 * active (e.g. on the client or outside a request), or when an intermediate
 * segment is not an object.
 *
 * @example
 * ```ts
 * import { config } from '@cossackframework/framework/config';
 *
 * const appName = config('app.name');           // string (inferred)
 * const host = config('database.connections.mysql.host', 'localhost');
 * ```
 */
export function config<Path extends DottedPaths<CossackConfigRegistry>>(
    key: Path,
    defaultValue?: GetByPath<CossackConfigRegistry, Path>,
): GetByPath<CossackConfigRegistry, Path>;
export function config<T = unknown>(key: string, defaultValue?: T): T;
export function config(key: string, defaultValue?: unknown): unknown {
    const store = requestStore();
    if (!store) return defaultValue;

    const segments = key.split('.');
    let current: unknown = store.config;
    for (const segment of segments) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return defaultValue;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return current === undefined ? defaultValue : current;
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
 * import { env } from '@cossackframework/framework/config';
 *
 * const dbHost = env('DB_HOST', 'localhost');   // e.g. 'db.example.com'
 * ```
 */
export function env(key: string, defaultValue?: string): string {
    const store = requestStore();
    if (!store) return defaultValue ?? '';
    const value = store.env?.[key];
    return value === undefined || value === null ? (defaultValue ?? '') : String(value);
}
