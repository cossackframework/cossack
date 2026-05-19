import type { MiddlewareHandler } from 'hono';

/**
 * Creates a server-only middleware.
 *
 * Middlewares passed to `@Page` are only ever invoked by the Hono router
 * (server-side), so this is a semantic wrapper that documents intent.
 * The handler runs directly without any runtime guard.
 */
export function defineServerMiddleware(handler: MiddlewareHandler): MiddlewareHandler {
    return handler;
}
