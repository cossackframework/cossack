// src/middlewares/request-context.ts
//
// The first middleware in the stack. Scopes the Hono `Context` into
// AsyncLocalStorage so `cookie()` / `session()` / `getRequestContext()` work
// context-free from anywhere downstream — including user middlewares (auth,
// db), locale/flash, SSR handlers, and /crpc.
//
// Must run BEFORE everything else so those downstream callers have the Context
// in scope. See `router.ts` (it's registered ahead of the configured-middlewares
// loop, locale, and flash).

import type { MiddlewareHandler } from 'hono';
import { ensureRequestContextAlsWired, runWithContext } from '../request-context-als';

export function createRequestContextMiddleware(): MiddlewareHandler {
    return async (c, next) => {
        ensureRequestContextAlsWired();
        return runWithContext(c, () => next());
    };
}

export const requestContextMiddleware = createRequestContextMiddleware();
