// src/shared/cookie.ts
//
// Context-free cookie access: `cookie()` reads/writes cookies on the active
// request without an explicit Hono `Context` argument. It resolves the Context
// from the per-request AsyncLocalStorage (seeded by the framework's request-
// context middleware) and delegates to Hono's `hono/cookie` helpers under the
// hood.
//
//   const theme = cookie().get('theme')          // read
//   cookie().set('lang', 'fr', { maxAge: 3600 })  // write
//   cookie().delete('old_session')                // delete
//
// Throws a clear `[Cossack]` error if called outside a request scope (client,
// scripts, or before the middleware is registered) — same request-scope stance
// as other context-free server helpers.

import type { Context } from 'hono';
import {
    getCookie,
    getSignedCookie,
    setCookie,
    deleteCookie,
} from 'hono/cookie';
import { getRequestContext } from './request-context';

/** Cookie options as Hono accepts them (re-exported for ergonomics). */
export type CookieOptions = Parameters<typeof setCookie>[3];

function requireContext(): Context {
    const c = getRequestContext();
    if (!c) {
        throw new Error(
            '[Cossack] No request context in scope. `cookie()` must be called within a ' +
                'request handler (the request-context middleware wraps every request).',
        );
    }
    return c;
}

/**
 * Context-free cookie access for the active request. Mirrors Hono's
 * `hono/cookie` API, just without the leading `c` argument.
 *
 *   cookie().get('theme')                       // string | undefined
 *   cookie().get('theme', { prefix: 'host-' })  // with options
 *   cookie().set('lang', 'fr', { maxAge: 3600 })
 *   cookie().delete('old')
 */
export function cookie() {
    const c = requireContext();
    return {
        /** Read a cookie value. */
        get(name: string): string | undefined {
            return getCookie(c, name);
        },
        /**
         * Read a signed (HMAC-verified) cookie value. Returns undefined if the
         * cookie is missing OR its signature failed verification (tampered).
         * Requires a `Secret` binding.
         */
        async getSigned(secret: string, name: string): Promise<string | undefined> {
            // Hono returns `string | undefined | false`; `false` means the
            // signature check failed (tampered cookie). Collapse to undefined
            // so callers see "not present" rather than a truthy `false`.
            const value = await getSignedCookie(c, secret, name);
            return value === false ? undefined : value;
        },
        /** Set a cookie on the response. */
        set(name: string, value: string, options?: CookieOptions): void {
            setCookie(c, name, value, options);
        },
        /** Delete a cookie (sets an expired empty value). */
        delete(name: string, options?: Pick<NonNullable<CookieOptions>, 'path' | 'domain' | 'secure' | 'sameSite' | 'prefix'>): void {
            deleteCookie(c, name, options);
        },
    };
}
