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
import { assertResponseHeadersMutable, RESPONSE_HEADER_STATE_KEY, type ResponseHeaderState } from '@cossackframework/core';
import { ensureRequestContextAlsWired, runWithContext } from '../request-context-als.js';
import { RESPONSE_LIFETIME_KEY, ResponseLifetime } from '../response-lifetime.js';

export function createRequestContextMiddleware(): MiddlewareHandler {
    return async (c, next) => {
        ensureRequestContextAlsWired();
        c.set(RESPONSE_LIFETIME_KEY, new ResponseLifetime());
        const headers: ResponseHeaderState = { committed: false };
        c.set(RESPONSE_HEADER_STATE_KEY, headers);
        const writeHeader = c.header.bind(c);
        // Hono cookie/auth helpers also use c.header. Keep middleware's outgoing
        // header phase open, then reject writes from later stream pulls/cleanup.
        c.header = (name, value, options) => {
            assertResponseHeadersMutable(c);
            writeHeader(name, value, options);
        };
        return runWithContext(c, async () => {
            try { await next(); }
            finally { headers.committed = true; }
        });
    };
}

export const requestContextMiddleware = createRequestContextMiddleware();
