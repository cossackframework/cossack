// src/i18n-context.ts
//
// Per-request locale isolation for the server. Wraps each request in an
// AsyncLocalStorage scope so `__()` / `getLocale()` resolve the right locale
// for the current request, even when a single Worker isolate serves many
// concurrent users.
//
// `node:async_hooks` is available on Cloudflare Workers (via the
// `nodejs_compat` flag, already enabled) and Node ≥ 13.10. The framework
// owns the single `AsyncLocalStorage` instance and wires it into core's
// i18n runtime via `setLocaleStoreGetter`.

import { AsyncLocalStorage } from 'node:async_hooks';
import { setLocaleStoreGetter, type LocaleStore } from '@cossackframework/core';

const localeAls = new AsyncLocalStorage<LocaleStore>();

let wired = false;
/** One-time wiring of the ALS store-getter into core's i18n runtime. */
export function ensureLocaleAlsWired(): void {
    if (wired) return;
    setLocaleStoreGetter(() => localeAls.getStore());
    wired = true;
}

/** Runs `fn` inside a locale scope. `__()` inside `fn` reads `store.locale`. */
export function runWithLocale<T>(
    store: LocaleStore,
    fn: () => T | Promise<T>,
): T | Promise<T> {
    return localeAls.run(store, fn as () => T);
}
