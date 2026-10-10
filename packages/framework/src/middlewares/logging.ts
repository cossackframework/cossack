import { defineServerMiddleware } from '@cossackframework/core';

const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']);
export const loggingMiddleware = defineServerMiddleware(async (c, next) => {
    try { await next(); }
    finally {
        const route = [...c.req.matchedRoutes].reverse().find(entry => entry.path !== '*')?.path ?? 'unknown';
        console.log({ event: 'cossack.request', method: methods.has(c.req.method) ? c.req.method : 'unknown',
            route: route.replace(/[^a-zA-Z0-9_.$/\[\]:*-]/g, '_').slice(0, 160) });
    }
});
