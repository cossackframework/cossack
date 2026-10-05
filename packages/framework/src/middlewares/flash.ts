// src/middlewares/flash.ts
//
// Global flash-data middleware. Owns the two-phase cookie lifecycle:
//
//   1. INCOMING: verify the `cossack_flash` cookie and seed the per-request
//      `incoming` bucket. Page requests consume it; background transports
//      preserve valid data for the next page.
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
import { assertResponseHeadersMutable, signValue, verifyValue } from '@cossackframework/core';
import { ensureFlashAlsWired, runWithFlash } from '../flash-context.js';
import { getSseCoordinator, isCloudflareRuntime } from '../transports/sse.js';

const COOKIE_NAME = 'cossack_flash';
// Only needs to survive one redirect (POST -> GET). The same duration is
// signed into the payload and checked by the server, not only by the browser.
const DEFAULT_MAX_AGE = 30;

interface SignedFlashPayload {
    format: 'cossack-flash';
    expiresAt: number;
    nonce: string;
    data: Record<string, unknown>;
}

const DEFAULT_PROCESS_FLASH_CLAIM_CAPACITY = 10_000;
type FlashClaimExpiry = { nonce: string; expiresAt: number };
const processFlashClaims = new Map<string, number>();
const processFlashClaimExpiries: FlashClaimExpiry[] = [];
let processFlashClaimCapacity = DEFAULT_PROCESS_FLASH_CLAIM_CAPACITY;

function pushFlashClaimExpiry(entry: FlashClaimExpiry): void {
    const heap = processFlashClaimExpiries;
    let index = heap.push(entry) - 1;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (heap[parent].expiresAt <= entry.expiresAt) break;
        heap[index] = heap[parent];
        index = parent;
    }
    heap[index] = entry;
}

function popFlashClaimExpiry(): FlashClaimExpiry | undefined {
    const heap = processFlashClaimExpiries;
    const first = heap[0];
    const last = heap.pop();
    if (!first || !last || heap.length === 0) return first;

    let index = 0;
    while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && heap[right].expiresAt < heap[left].expiresAt ? right : left;
        if (heap[child].expiresAt >= last.expiresAt) break;
        heap[index] = heap[child];
        index = child;
    }
    heap[index] = last;
    return first;
}

function purgeExpiredProcessFlashClaims(now: number): void {
    while (processFlashClaimExpiries[0]?.expiresAt <= now) {
        const expired = popFlashClaimExpiry()!;
        if (processFlashClaims.get(expired.nonce) === expired.expiresAt) {
            processFlashClaims.delete(expired.nonce);
        }
    }
}

/** Process/isolate-local replay guard for Node and Deno when no durable store is configured. */
function claimProcessFlash(nonce: string, expiresAt: number): 'claimed' | 'replayed' | 'full' {
    const now = Date.now();
    purgeExpiredProcessFlashClaims(now);
    if (expiresAt <= now) return 'replayed';
    if (processFlashClaims.has(nonce)) return 'replayed';
    if (processFlashClaims.size >= processFlashClaimCapacity) return 'full';

    // This check-and-insert is synchronous, so overlapping requests in this
    // JavaScript isolate have exactly one winner before either can yield again.
    processFlashClaims.set(nonce, expiresAt);
    pushFlashClaimExpiry({ nonce, expiresAt });
    return 'claimed';
}

/** @internal Reset the module-local replay guard in focused tests. */
export function __resetProcessFlashClaimsForTests(capacity = DEFAULT_PROCESS_FLASH_CLAIM_CAPACITY): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Flash claim capacity must be positive.');
    processFlashClaims.clear();
    processFlashClaimExpiries.length = 0;
    processFlashClaimCapacity = capacity;
}

function isSignedFlashPayload(value: unknown): value is SignedFlashPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const payload = value as Record<string, unknown>;
    return payload.format === 'cossack-flash' &&
        Number.isSafeInteger(payload.expiresAt) && (payload.expiresAt as number) > Date.now() &&
        typeof payload.nonce === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.nonce) &&
        !!payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data);
}

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
    if (!Number.isSafeInteger(maxAge) || maxAge <= 0) {
        throw new RangeError('[Cossack] Flash maxAge must be a positive whole number of seconds.');
    }

    return async (c, next) => {
        ensureFlashAlsWired();
        const transport = c.req.path === '/crpc' || c.req.path === '/upload' ||
            c.req.path === '/sse' || c.req.path.startsWith('/ws/');

        // 1. INCOMING: verify; consume only outside background transports.
        let incoming: Record<string, unknown> = {};
        const token = getCookie(c, COOKIE_NAME);
        if (token) {
            const secret = resolveSecret(c, secretEnvName);
            // If there's a cookie but no secret, we can't verify it — drop it
            // silently rather than crash the whole request. (A misconfigured
            // secret shouldn't take down unrelated pages.)
            if (secret) {
                const payload = await verifyValue<unknown>(token, secret);
                if (isSignedFlashPayload(payload)) {
                    if (transport) {
                        incoming = payload.data;
                    } else {
                        const coordinator = getSseCoordinator(c.env);
                        if (!coordinator && isCloudflareRuntime()) {
                            deleteCookie(c, COOKIE_NAME, { path: '/' });
                            return c.json({ code: 'COSSACK_FLASH_REPLAY_UNAVAILABLE',
                                error: 'Flash data is temporarily unavailable.' }, 503);
                        }
                        if (coordinator) {
                            try {
                                const accepted = await coordinator.getByName(`cossack.flash.v1:${payload.nonce}`)
                                    .claimFlash(payload.nonce, payload.expiresAt);
                                if (accepted) incoming = payload.data;
                            } catch {
                                deleteCookie(c, COOKIE_NAME, { path: '/' });
                                return c.json({ code: 'COSSACK_FLASH_REPLAY_UNAVAILABLE',
                                    error: 'Flash data is temporarily unavailable.' }, 503);
                            }
                        } else {
                            const claimed = claimProcessFlash(payload.nonce, payload.expiresAt);
                            if (claimed === 'full') {
                                deleteCookie(c, COOKIE_NAME, { path: '/' });
                                return c.json({ code: 'COSSACK_FLASH_REPLAY_UNAVAILABLE',
                                    error: 'Flash data is temporarily unavailable.' }, 503);
                            }
                            if (claimed === 'claimed') incoming = payload.data;
                        }
                    }
                }
            }
            // Background RPC/realtime requests must not consume a message meant
            // for the next page. Invalid tokens still get removed immediately.
            if (!transport || !Object.keys(incoming).length) deleteCookie(c, COOKIE_NAME, { path: '/' });
        }

        // 2. Run the whole request inside the flash scope. Writes via flash()
        //    accumulate in `outgoing`; reads via flashed() pull from `incoming`.
        const store = { outgoing: {} as Record<string, unknown>, incoming,
            assertWritable: () => {
                assertResponseHeadersMutable(c, 'write flash data');
                if (isCloudflareRuntime() && !getSseCoordinator(c.env)) {
                    throw new Error('[Cossack] Flash data on Cloudflare requires the COSSACK_SSE Durable Object binding.');
                }
            } };
        await runWithFlash(store, () => next());

        // 3. OUTGOING: if the handler flashed anything, sign + set the cookie
        //    so it survives the redirect to the next request.
        const outgoingKeys = Object.keys(store.outgoing);
        // An RPC validation/application failure must not replace unrelated
        // incoming flash data with partially accumulated outgoing state.
        if (transport && c.res.status >= 400) return;
        if (outgoingKeys.length > 0) {
            const secret = resolveSecret(c, secretEnvName);
            if (!secret) {
                throw new Error(
                    '[Cossack] Flash data requires a signing secret. Set APP_SECRET ' +
                        '(min 16 chars) in your wrangler env to use flash().',
                );
            }
            const expiresAt = Date.now() + maxAge * 1000;
            if (!Number.isSafeInteger(expiresAt)) {
                throw new RangeError('[Cossack] Flash maxAge exceeds the supported expiry range.');
            }
            const signed = await signValue<SignedFlashPayload>({
                format: 'cossack-flash',
                expiresAt,
                nonce: crypto.randomUUID(),
                data: store.outgoing,
            }, secret);
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
