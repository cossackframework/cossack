// src/request-context-als.ts
//
// Per-request Hono `Context` isolation. Wraps each request in an
// AsyncLocalStorage scope so `cookie()` / `session()` (and `getRequestContext()`)
// resolve the right Context for the current request, even when a single Worker
// isolate serves many concurrent users.
//
// Registered FIRST in the middleware stack (before user middlewares, locale,
// and flash) so `cookie()` is usable inside auth/db/custom middlewares too.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from 'hono';
import { setRequestContextGetter } from '@cossackframework/core';

const ctxAls = new AsyncLocalStorage<Context>();

let wired = false;
/** One-time wiring of the ALS store-getter into core's request-context. */
export function ensureRequestContextAlsWired(): void {
    if (wired) return;
    setRequestContextGetter(() => ctxAls.getStore());
    wired = true;
}

/** Runs `fn` inside a request-Context scope. `cookie()` inside `fn` resolves `c`. */
export function runWithContext<T>(
    c: Context,
    fn: () => T | Promise<T>,
): T | Promise<T> {
    return ctxAls.run(c, fn as () => T);
}
