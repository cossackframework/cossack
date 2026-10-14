import { isOriginAllowed, RpcError } from '@cossackframework/core';
import type { MiddlewareHandler } from 'hono';
import type { RouterContext } from '../route-ids.js';
import { readRpcRequest, RPC_JSON_REQUEST_MAX_BYTES } from './http.js';
import { discardRequestBody } from '../request-body.js';

/** Apply the addressed page/layout guards before any transport can bootstrap it. */
export function protectTransport(ctx: RouterContext): MiddlewareHandler {
    return async (c, next) => {
        let componentPath: string | undefined;
        if (c.req.method === 'POST') {
            // Multipart and text/plain requests can be sent without a CORS preflight.
            // CORS response headers alone cannot prevent their side effects.
            if (!isOriginAllowed(c.req.header('origin'), c.req.url, ctx.allowedOrigins)) {
                // Drain (bounded) before rejecting so the connection stays usable.
                await discardRequestBody(c.req.raw, ctx.rpcBodyLimits?.jsonBytes ?? RPC_JSON_REQUEST_MAX_BYTES);
                return c.text('Origin not allowed', 403);
            }
            const suppliedId = c.req.header('X-Cossack-Request-Id');
            // Correlation is public data, never an identity or authorization key.
            // Bound accepted IDs to UUID v4; arbitrary/oversized values get a fresh ID.
            const requestId = suppliedId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId)
                ? suppliedId : crypto.randomUUID();
            c.res.headers.set('X-Cossack-Request-Id', requestId);
            try {
                const body = await readRpcRequest(c, ctx.rpcBodyLimits);
                if (!body || typeof body !== 'object' || Array.isArray(body)) {
                    return c.json({ error: 'Invalid transport body' }, 400);
                }
                const routeId = body.service?.ownerRouteId ?? body.componentRouteId;
                componentPath = typeof routeId === 'string' ? ctx.routeIdMap.get(routeId) : undefined;
            } catch (error) {
                if (error instanceof RpcError && error.code === 'COSSACK_RPC_REQUEST_TOO_LARGE') {
                    return c.json({ error: error.message, code: error.code, requestId }, 413);
                }
                return c.json({ error: error instanceof RpcError ? error.message : 'Invalid transport body',
                    code: 'COSSACK_RPC_REQUEST_INVALID', requestId }, 400);
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
