import { isOriginAllowed } from '@cossackframework/core';
import type { MiddlewareHandler } from 'hono';
import type { RouterContext } from '../route-ids.js';

/** Apply the addressed page/layout guards before any transport can bootstrap it. */
export function protectTransport(ctx: RouterContext): MiddlewareHandler {
    return async (c, next) => {
        let componentPath: string | undefined;
        if (c.req.method === 'POST') {
            // Multipart and text/plain requests can be sent without a CORS preflight.
            // CORS response headers alone cannot prevent their side effects.
            if (!isOriginAllowed(c.req.header('origin'), c.req.url, ctx.allowedOrigins)) {
                return c.text('Origin not allowed', 403);
            }
            try {
                const body = c.req.path === '/upload'
                    ? await c.req.parseBody({ all: true })
                    : await c.req.json();
                if (!body || typeof body !== 'object' || Array.isArray(body)) {
                    return c.json({ error: 'Invalid transport body' }, 400);
                }
                const routeId = body.service?.ownerRouteId ?? body.componentRouteId;
                componentPath = typeof routeId === 'string' ? ctx.routeIdMap.get(routeId) : undefined;
            } catch {
                return c.json({ error: 'Invalid transport body' }, 400);
            }
        } else if (c.req.path.startsWith('/sse/')) {
            componentPath = ctx.routeIdMap.get(c.req.param('componentRouteId') ?? '');
        } else {
            const route = c.req.query('routePath') || c.req.query('componentPath');
            componentPath = route ? ctx.routePathToFilePathMap.get(route) || route : undefined;
        }
        if (!componentPath) return c.json({ error: 'Invalid component ID' }, 400);
        const middlewares = ctx.getMiddlewares?.(componentPath) ?? [];
        // Preserve short-circuit responses and after-next headers without
        // replacing Hono's route index (which resolves transport params).
        let index = -1;
        const dispatch = async (position: number): Promise<void> => {
            if (position <= index) throw new Error('next() called multiple times');
            index = position;
            const middleware = middlewares[position];
            if (!middleware) return next();
            const response = await middleware(c, () => dispatch(position + 1));
            if (response) c.res = response;
        };
        await dispatch(0);
        const location = c.res.headers.get('Location');
        if (c.req.method === 'POST' && c.res.status >= 300 && c.res.status < 400 && location) {
            c.res.headers.delete('Location');
            c.res = c.json({ _cossack_redirect: location }, 200);
        }
        return c.res;
    };
}
