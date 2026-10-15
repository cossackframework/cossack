// src/transports/websocket.ts
import type { Context } from 'hono';
import { getLocale, isOriginAllowed } from '@cossackframework/core';
import type { RouterContext } from '../route-ids.js';
import { withRuntimeRouteParams } from '../runtime-websocket.js';
import { realtimeConnectionScopeKey, realtimeInstanceName } from '../realtime-scope.js';
import { captureRealtimeIdentity } from '../realtime-identity.js';
import { resolveRealtimeConnection, type RealtimeTargetContext } from './realtime-target.js';

/** Internal assertions the proxy sets for the Durable Object. A client never supplies them. */
const INTERNAL_HEADERS = [
    'X-Component-Path', 'X-User-ID', 'X-User-Data',
    'X-Cossack-Realtime-Identity', 'X-Cossack-Realtime-Scope', 'X-Cossack-Realtime-Locale',
    'X-Cossack-Realtime-Target-Valid', 'X-Cossack-Realtime-Owner', 'X-Cossack-Realtime-Guard',
];

/**
 * WebSocket proxy handler: forwards an upgrade to the Durable Object of its
 * realtime owner (a page, a layout or a realtime component). The client names
 * the owner, the page it is on and the target; the proxy recomputes the
 * target from the owner and its scope and flags a mismatch, so the object
 * rejects the peer.
 */
export function handleWebSocketProxy(ctx: Pick<RouterContext, 'allowedOrigins'> & RealtimeTargetContext) {
    return async (c: Context) => {
        // SECURITY: validate Origin to prevent cross-site WebSocket hijacking
        // (CSWSH), where a malicious page opens a WS using the victim's cookies.
        if (!isOriginAllowed(c.req.header('origin'), c.req.url, ctx.allowedOrigins)) {
            return new Response('Origin not allowed', { status: 403 });
        }
        const user = c.get('user');
        const durableObjectId = c.req.param('id');
        const resolved = resolveRealtimeConnection(ctx, name => c.req.query(name));
        if ('error' in resolved) return new Response(resolved.message, { status: resolved.status });
        const { owner, guardPath, params } = resolved.target;
        // A scope function that throws or returns no key rejects the upgrade.
        const scopeKey = await realtimeConnectionScopeKey(withRuntimeRouteParams(c, params), owner);

        const doBinding = c.env.COSSACK_OBJECT;
        let id: unknown;
        let rejectAuthorization = false;
        try {
            // The client chooses the target id. Recompute it from the owner
            // (plus its scope key, or its route params) so a client cannot
            // join another owner's Durable Object.
            const expected = doBinding.idFromName(realtimeInstanceName(owner, owner.options?.scope ? scopeKey : undefined, params));
            if (expected.toString() !== durableObjectId) rejectAuthorization = true;
            id = doBinding.idFromString(durableObjectId);
        } catch { return new Response('Invalid WebSocket target', { status: 400 }); }
        const stub = doBinding.get(id);
        // The object reads the checked params, never the raw query value.
        const url = new URL(c.req.url);
        url.searchParams.set('params', JSON.stringify(params));
        const request = new Request(url, c.req.raw);

        // These are internal authentication assertions, never client input.
        for (const name of INTERNAL_HEADERS) request.headers.delete(name);
        // The registry key the object builds, and whose guard stack each
        // action runs again: the page for a page or a component, the layout
        // itself for a layout.
        request.headers.set('X-Component-Path', owner.id);
        request.headers.set('X-Cossack-Realtime-Owner', owner.kind);
        request.headers.set('X-Cossack-Realtime-Guard', guardPath);
        // Only the id crosses the hop. Ids and scope keys are percent-encoded
        // so any string (e.g. non-Latin-1) is a valid header value. The Durable Object re-runs middleware to resolve the
        // full user and rejects the peer if the fresh id differs.
        if (user) request.headers.set('X-User-ID', encodeURIComponent(String(user.id)));
        let identity: Awaited<ReturnType<typeof captureRealtimeIdentity>>;
        try { identity = await captureRealtimeIdentity(c); }
        catch { identity = null; rejectAuthorization = true; }
        if (identity) request.headers.set('X-Cossack-Realtime-Identity', JSON.stringify(identity));
        request.headers.set('X-Cossack-Realtime-Scope', encodeURIComponent(scopeKey));
        request.headers.set('X-Cossack-Realtime-Locale', getLocale());
        request.headers.set('X-Cossack-Realtime-Target-Valid', rejectAuthorization ? 'false' : 'true');

        return await stub.fetch(request);
    };
}
