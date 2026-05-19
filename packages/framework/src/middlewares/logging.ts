import { defineServerMiddleware } from '@cossackframework/core';

export const loggingMiddleware = defineServerMiddleware(async (c, next) => {
    console.log(`[${c.req.method}] ${c.req.path}`);
    await next();
});
