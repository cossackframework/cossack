// src/transports/websocket.ts
import type { Context } from 'hono';

export interface RouterContext {
    routeIdMap: Map<string, string>;
    routePathToIdMap: Map<string, string>;
    routePathToFilePathMap: Map<string, string>;
    pages: Record<string, any>;
    layouts: Record<string, any>;
}

/** WebSocket proxy handler — forwards WebSocket upgrade requests to the appropriate Durable Object. */
export function handleWebSocketProxy(ctx: RouterContext) {
    return async (c: Context) => {
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
