// src/middlewares/flash.ts
//
// Global flash-data middleware. Owns the two-phase cookie lifecycle:
//
//   1. INCOMING (start of every request): read + delete the `cossack_flash`
//      cookie, verify its HMAC signature, and seed the per-request flash store's
//      `incoming` bucket so `flashed()` / `old()` work during this request.
//   2. OUTGOING (after the handler returns): if the handler wrote anything via
//      `flash()` / `flashInput()` (the `outgoing` bucket is non-empty), sign
//      it and set the `cossack_flash` cookie on the response. This is what
//      carries the data across the redirect to the next GET.
//
// Flash data is short-lived (maxAge ~30s — only needs to survive one redirect)
// and signed (HMAC-SHA256) so it can't be tampered with. Because flash
// messages render into HTML, signing is required, not optional.
//
// Requires a signing secret from the environment (`APP_SECRET`, with legacy
// fallbacks to `COSSACK_SECRET` and bare `SECRET`). The middleware throws a
// clear error only when flash is actually used (a cookie is present OR the
// handler wrote outgoing data) — apps that never use flash pay no cost and
// need no secret.

import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { signValue, verifyValue } from '@cossackframework/core';
import { ensureFlashAlsWired, runWithFlash } from '../flash-context.js';

const COOKIE_NAME = 'cossack_flash';
// Only needs to survive one redirect (POST -> GET). 30s is generous for the
// round-trip while keeping the window for replay tiny.
const DEFAULT_MAX_AGE = 30;

export interface FlashMiddlewareOptions {
    /** Env var name to read the signing secret from. Defaults to APP_SECRET. */
    secretEnvName?: string;
    /** Cookie max-age in seconds. Defaults to 30. */
    maxAge?: number;
}

/**
 * Resolve the signing secret from the request env. Returns undefined if not set.
 * We don't throw here — we throw only when flash is actually exercised, so
 * apps that never use flash aren't forced to configure a secret.
 */
function resolveSecret(c: any, envName: string): string | undefined {
    return c.env?.[envName] ?? c.env?.COSSACK_SECRET ?? c.env?.SECRET;
}

export function createFlashMiddleware(
    options: FlashMiddlewareOptions = {},
): MiddlewareHandler {
    const secretEnvName = options.secretEnvName ?? 'APP_SECRET';
    const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;

    return async (c, next) => {
        ensureFlashAlsWired();

        // 1. INCOMING: read + consume the flash cookie (single-use semantics).
        let incoming: Record<string, unknown> = {};
        const token = getCookie(c, COOKIE_NAME);
        if (token) {
            // Always delete on read so a refresh/back doesn't replay the flash.
            deleteCookie(c, COOKIE_NAME, { path: '/' });
            const secret = resolveSecret(c, secretEnvName);
            // If there's a cookie but no secret, we can't verify it — drop it
            // silently rather than crash the whole request. (A misconfigured
            // secret shouldn't take down unrelated pages.)
            if (secret) {
                incoming = (await verifyValue<Record<string, unknown>>(token, secret)) ?? {};
            }
        }

        // 2. Run the whole request inside the flash scope. Writes via flash()
        //    accumulate in `outgoing`; reads via flashed() pull from `incoming`.
        const store = { outgoing: {} as Record<string, unknown>, incoming };
        await runWithFlash(store, () => next());

        // 3. OUTGOING: if the handler flashed anything, sign + set the cookie
        //    so it survives the redirect to the next request.
        const outgoingKeys = Object.keys(store.outgoing);
        if (outgoingKeys.length > 0) {
            const secret = resolveSecret(c, secretEnvName);
            if (!secret) {
                throw new Error(
                    '[Cossack] Flash data requires a signing secret. Set APP_SECRET ' +
                        '(min 16 chars) in your wrangler env to use flash().',
                );
            }
            const signed = await signValue(store.outgoing, secret);
            setCookie(c, COOKIE_NAME, signed, {
                httpOnly: true,
                secure: c.req.url.startsWith('https://'),
                sameSite: 'Lax',
                path: '/',
                maxAge,
            });
        }
    };
}

export const flashMiddleware = createFlashMiddleware();
