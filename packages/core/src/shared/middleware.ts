import type { MiddlewareHandler } from 'hono';
import { isServer } from './environment';

/**
 * Creates a middleware that only executes on the server.
 * On the client, it passes through without running the callback.
 */
export function defineServerMiddleware(handler: MiddlewareHandler): MiddlewareHandler {
    return async (c, next) => {
        if (isServer) {
            await handler(c, next);
        } else {
            await next();
        }
    };
}
