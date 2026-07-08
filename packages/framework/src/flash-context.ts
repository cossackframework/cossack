// src/flash-context.ts
//
// Per-request flash-data isolation for the server. Wraps each request in an
// AsyncLocalStorage scope so `flash()` / `flashed()` resolve the right store
// for the current request, even when a single Worker isolate serves many
// concurrent users.
//
// Mirrors `i18n-context.ts`. The framework owns the single AsyncLocalStorage
// instance and wires it into core's flash runtime via `setFlashStoreGetter`.
// `node:async_hooks` is available on Cloudflare Workers (via the
// `nodejs_compat` flag, already enabled) and Node ≥ 13.10.

import { AsyncLocalStorage } from 'node:async_hooks';
import { setFlashStoreGetter, type FlashStore } from '@cossackframework/core';

const flashAls = new AsyncLocalStorage<FlashStore>();

let wired = false;
/** One-time wiring of the ALS store-getter into core's flash runtime. */
export function ensureFlashAlsWired(): void {
    if (wired) return;
    setFlashStoreGetter(() => flashAls.getStore());
    wired = true;
}

/** Runs `fn` inside a flash scope. `flash()`/`flashed()` inside `fn` read/write `store`. */
export function runWithFlash<T>(
    store: FlashStore,
    fn: () => T | Promise<T>,
): T | Promise<T> {
    return flashAls.run(store, fn as () => T);
}
