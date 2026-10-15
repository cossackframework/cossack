// src/transports/websocket.ts
import type { Context } from 'hono';
import { getLocale, isOriginAllowed } from '@cossackframework/core';
import type { RouterContext } from '../route-ids.js';
import { getModuleDefault } from '../module-default.js';
import { decodeRuntimeRouteParams, withRuntimeRouteParams } from '../runtime-websocket.js';
import { realtimeObjectName, resolveRealtimeScopeKey } from '../realtime-scope.js';
import { captureRealtimeIdentity } from '../realtime-identity.js';

/** WebSocket proxy handler — forwards WebSocket upgrade requests to the appropriate Durable Object. */
export function handleWebSocketProxy(ctx: RouterContext) {
    return async (c: Context) => {
        // SECURITY: validate Origin to prevent cross-site WebSocket hijacking
        // (CSWSH), where a malicious page opens a WS using the victim's cookies.
        if (!isOriginAllowed(c.req.header('origin'), c.req.url, ctx.allowedOrigins)) {
            return new Response('Origin not allowed', { status: 403 });
        }
        const user = c.get('user');
        const durableObjectId = c.req.param('id');
        const routePath = c.req.query('routePath');
        // Support both routePath (new) and componentPath (legacy) for backward compatibility
        const componentPathQuery = routePath || c.req.query('componentPath');
        if (!componentPathQuery) return new Response('routePath or componentPath query parameter is required', { status: 400 });

        // Convert route path to file path if needed
        const componentPath = ctx.routePathToFilePathMap.get(componentPathQuery) || componentPathQuery;
        const module = ctx.pages[componentPath] || ctx.layouts[componentPath];
        if (!module) {
            return new Response('Component not found', { status: 404 });
        }

        const Component = getModuleDefault(module as object) as new () => any;
        const pageOptions = Reflect.getMetadata('page:options', Component) as { scope?: unknown } | undefined;
        let params: Record<string, string>;
        try { params = decodeRuntimeRouteParams(c.req.query('params')); }
        catch { return new Response('Invalid WebSocket route params', { status: 400 }); }
        const scopeKey = await resolveRealtimeScopeKey(withRuntimeRouteParams(c, params), pageOptions as any);

        const doBinding = c.env.COSSACK_OBJECT;
        let id: unknown;
        let rejectAuthorization = false;
        try {
            // The client chooses the target id. Recompute it from the page
            // identity (custom scope key, or component + route params) so a
            // client cannot join another page's Durable Object.
            const expected = doBinding.idFromName(realtimeObjectName(pageOptions as any, scopeKey, componentPath, params));
            if (expected.toString() !== durableObjectId) rejectAuthorization = true;
            id = doBinding.idFromString(durableObjectId);
        } catch { return new Response('Invalid WebSocket target', { status: 400 }); }
        const stub = doBinding.get(id);
        const request = new Request(c.req.raw);

        request.headers.set('X-Component-Path', componentPath);
        // These are internal authentication assertions, never client input.
        request.headers.delete('X-User-ID');
        request.headers.delete('X-User-Data');
        request.headers.delete('X-Cossack-Realtime-Identity');
        request.headers.delete('X-Cossack-Realtime-Scope');
        request.headers.delete('X-Cossack-Realtime-Locale');
        request.headers.delete('X-Cossack-Realtime-Target-Valid');
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
