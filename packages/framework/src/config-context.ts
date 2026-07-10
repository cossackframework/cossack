// src/config-context.ts
//
// Per-request application config isolation for the server. Wraps each request
// in an AsyncLocalStorage scope so `config()` / `env()` resolve values scoped
// to the current request's bindings (`c.env`), even when a single Worker
// isolate serves many concurrent users.
//
// `node:async_hooks` is available on Cloudflare Workers (via the
// `nodejs_compat` flag, already enabled) and Node ≥ 13.10. The framework
// owns the single `AsyncLocalStorage` instance and wires it into core's
// config runtime via `setConfigStoreGetter`.
//
// This mirrors `i18n-context.ts` (locale ALS) and `database/src/als.ts`
// (database client ALS): the leaf accessors (`config()` / `env()`) live in
// `@cossackframework/core`, and the framework injects the ALS-backed store
// getter here.

import { AsyncLocalStorage } from 'node:async_hooks';
import { setConfigStoreGetter, type ConfigStore } from '@cossackframework/core';

const configAls = new AsyncLocalStorage<ConfigStore>();

let wired = false;
/** One-time wiring of the ALS store-getter into core's config runtime. */
export function ensureConfigAlsWired(): void {
    if (wired) return;
    setConfigStoreGetter(() => configAls.getStore());
    wired = true;
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
