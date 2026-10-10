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
import { setActionIdentityScope, setRequestContextGetter, type ActionIdentity } from '@cossackframework/core';

const ctxAls = new AsyncLocalStorage<Context>();
// Per-call identity of socket @Server actions. Streaming actions keep running
// after they release the component's action queue; this scope keeps
// `this.user`/`this.c` bound to the right caller across their awaits.
const actionIdentityAls = new AsyncLocalStorage<ActionIdentity>();

let wired = false;
/** One-time wiring of the ALS stores into core's request-context and action identity. */
export function ensureRequestContextAlsWired(): void {
    if (wired) return;
    setRequestContextGetter(() => ctxAls.getStore());
    setActionIdentityScope({
        run: (identity, fn) => actionIdentityAls.run(identity, fn),
        get: () => actionIdentityAls.getStore(),
    });
    wired = true;
}

/** Runs `fn` inside a request-Context scope. `cookie()` inside `fn` resolves `c`. */
export function runWithContext<T>(
    c: Context,
    fn: () => T | Promise<T>,
): T | Promise<T> {
    return ctxAls.run(c, fn as () => T);
}
