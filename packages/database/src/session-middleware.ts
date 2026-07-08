// src/session-middleware.ts
//
// Per-request session middleware. Resolves the session ID (from an optional
// auth-cookie reader, else the anonymous `cossack_sid` cookie), creates one if
// missing, and scopes a `SessionStore` into AsyncLocalStorage so `session()`
// works context-free. Ensures the ID cookie is set on the response when a new
// anonymous session is issued.
//
// Register via `cossack add database` (same pattern as `dbMiddleware`):
//
//   // src/middlewares/session.ts
//   import { createSessionMiddleware } from '@cossackframework/database';
//   export const sessionMiddleware = createSessionMiddleware();
//
//   // src/config/middlewares.ts
//   import { sessionMiddleware } from '../middlewares/session';
//   export const middlewares = [sessionMiddleware];

import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { db } from './store';
import { SessionStore } from './session-store';
import { ensureSessionAlsWired, runWithSession } from './session-als';

export interface SessionMiddlewareOptions {
    /** Anonymous-session cookie name. Defaults to `cossack_sid`. */
    cookieName?: string;
    /** Session TTL in milliseconds. Defaults to 30 days. */
    ttl?: number;
    /**
     * Optional: read the session ID from auth's cookie instead of the anonymous
     * one. Return the auth session ID when the user is logged in; return
     * undefined to fall back to the anonymous cookie. This is the "ID bridge"
     * that lets an authenticated session reuse its existing ID.
     */
    authCookieReader?: (c: any) => string | undefined | Promise<string | undefined>;
    /**
     * Whether to set the anonymous cookie as `httpOnly`. Defaults to true.
     * (Auth-managed cookies set their own attributes via the auth module.)
     */
    httpOnly?: boolean;
}

const DEFAULT_COOKIE_NAME = 'cossack_sid';
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionMiddleware(
    options: SessionMiddlewareOptions = {},
): MiddlewareHandler {
    const cookieName = options.cookieName ?? DEFAULT_COOKIE_NAME;
    const ttl = options.ttl ?? DEFAULT_TTL_MS;
    const httpOnly = options.httpOnly ?? true;

    return async (c, next) => {
        ensureSessionAlsWired();
        const store = new SessionStore(db());

        // 1. Resolve an existing session ID: auth cookie first, then anonymous.
        //    `authProvidedId` tracks whether auth handed us an ID so we know
        //    not to set the anonymous cookie in that case (auth manages its own).
        let sessionId: string | undefined;
        let authProvidedId = false;
        if (options.authCookieReader) {
            sessionId = await options.authCookieReader(c);
            if (sessionId) authProvidedId = true;
        }
        if (!sessionId) {
            sessionId = getCookie(c, cookieName);
        }

        // 2. If neither auth nor the anonymous cookie gave us an ID, create a
        //    fresh anonymous session. We set its cookie after `next()` so it
        //    survives redirects.
        let issuedNewAnonymousId = false;
        if (!sessionId) {
            sessionId = await store.create(ttl);
            issuedNewAnonymousId = true;
        }

        // 3. Scope the session for downstream handlers.
        await runWithSession({ sessionId, store }, () => next());

        // 4. Persist a newly-issued ANONYMOUS ID as a cookie. We must NOT skip
        //    this when `authCookieReader` is configured but returned undefined
        //    (an unauthenticated request) — otherwise the new anonymous session
        //    is orphaned and lost on the next request. Only an auth-provided ID
        //    is excluded, because the auth module sets its own cookie.
        if (issuedNewAnonymousId && !authProvidedId) {
            setCookie(c, cookieName, sessionId, {
                httpOnly,
                secure: c.req.url.startsWith('https://'),
                sameSite: 'Lax',
                path: '/',
                maxAge: Math.floor(ttl / 1000),
            });
        }
    };
}
