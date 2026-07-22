// src/transports/websocket.ts
import type { Context } from 'hono';
import { isOriginAllowed } from '@cossackframework/core';
import type { RouterContext } from '../route-ids.js';

/** WebSocket proxy handler — forwards WebSocket upgrade requests to the appropriate Durable Object. */
export function handleWebSocketProxy(ctx: RouterContext) {
    return async (c: Context) => {
        // SECURITY: validate Origin to prevent cross-site WebSocket hijacking
        // (CSWSH), where a malicious page opens a WS using the victim's cookies.
        if (!isOriginAllowed(c.req.header('origin'), c.req.url, ctx.allowedOrigins)) {
            return new Response('Origin not allowed', { status: 403 });
        }
        const user = c.get('user');
        const { provider, id: durableObjectId } = c.req.param();
        const routePath = c.req.query('routePath');
        // Support both routePath (new) and componentPath (legacy) for backward compatibility
        const componentPathQuery = routePath || c.req.query('componentPath');
        if (!componentPathQuery) return new Response('routePath or componentPath query parameter is required', { status: 400 });

        // Convert route path to file path if needed
        const componentPath = ctx.routePathToFilePathMap.get(componentPathQuery) || componentPathQuery;

        const doBinding = c.env.COSSACK_OBJECT;
        const id = doBinding.idFromString(durableObjectId);
        const stub = doBinding.get(id);
        const request = new Request(c.req.raw);

        request.headers.set('X-Component-Path', componentPath);
        request.headers.set('X-Provider-Name', provider);
        if (user) {
            request.headers.set('X-User-ID', user.id);
            request.headers.set('X-User-Data', JSON.stringify(user));
        }

        return await stub.fetch(request);
    };
}
